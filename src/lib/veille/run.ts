import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { getSetting } from "../settings";
import { recordAudit } from "../audit";
import { notify, refreshDeadlineReminders } from "../notifications";
import { recomputeMatching } from "../matching/service";
import { boampConnector } from "./boamp";
import { tedConnector } from "./ted";
import { ingestNotice } from "./ingest";
import { ConnectorUnavailableError, type Connector } from "./types";

/**
 * Moteur de veille.
 *
 * Déroulé d'une synchronisation, pour un connecteur :
 *
 *   interroger la source → écarter les doublons → rattacher les rectificatifs
 *   → créer ou mettre à jour l'affaire → enregistrer les lots → lancer le
 *   matching → produire les alertes.
 *
 * Une source injoignable produit une exécution en échec, avec sa raison. Elle
 * ne produit jamais d'affaire : TENDERA n'invente aucune consultation.
 */

const CONNECTORS: Record<string, Connector> = {
  boamp: boampConnector,
  ted: tedConnector,
};

export type RunOutcome = {
  runId: string;
  connector: string;
  status: "SUCCES" | "PARTIEL" | "ECHEC";
  fetched: number;
  created: number;
  updated: number;
  duplicates: number;
  rectificatifs: number;
  errors: string[];
  /** Message lisible, affiché dans l'interface. */
  message: string;
};

export async function runConnector(
  connectorKey: string,
  options: { trigger?: "manuelle" | "planifiee"; userId?: string | null } = {},
): Promise<RunOutcome> {
  const record = await prisma.sourceConnector.findUnique({ where: { key: connectorKey } });
  if (!record) throw new Error(`Connecteur inconnu : ${connectorKey}`);

  // Une exécution interrompue (redémarrage du serveur, délai dépassé) resterait
  // « en cours » indéfiniment et masquerait le dernier résultat réel.
  await prisma.veilleRun.updateMany({
    where: {
      connectorId: record.id,
      status: "EN_COURS",
      startedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
    },
    data: {
      status: "ECHEC",
      finishedAt: new Date(),
      errors: ["Exécution interrompue : aucun résultat n'a été enregistré."],
    },
  });

  const implementation = CONNECTORS[connectorKey];
  const run = await prisma.veilleRun.create({
    data: { connectorId: record.id, trigger: options.trigger ?? "manuelle", status: "EN_COURS" },
  });

  const finish = async (
    status: RunOutcome["status"],
    counters: { fetched: number; created: number; updated: number; duplicates: number; rectificatifs: number },
    errors: string[],
    log: Prisma.InputJsonValue,
    message: string,
  ): Promise<RunOutcome> => {
    await prisma.veilleRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), ...counters, errors, log },
    });
    await prisma.sourceConnector.update({
      where: { id: record.id },
      data: { lastRunAt: new Date(), lastError: status === "ECHEC" ? errors[0] ?? message : null },
    });
    await recordAudit({
      action: "veille.run",
      entity: "SourceConnector",
      entityId: record.id,
      userId: options.userId ?? null,
      actor: options.userId ? "utilisateur" : "veille",
      summary: `${record.name} — ${message}`,
      payload: { statut: status, ...counters, erreurs: errors },
    });
    return { runId: run.id, connector: record.key, status, ...counters, errors, message };
  };

  const empty = { fetched: 0, created: 0, updated: 0, duplicates: 0, rectificatifs: 0 };

  if (!implementation) {
    return finish(
      "ECHEC",
      empty,
      [record.requirement ?? "Connecteur non implémenté."],
      { raison: "non_implemente" },
      `Connecteur non implémenté. ${record.requirement ?? ""}`.trim(),
    );
  }
  if (!record.enabled) {
    return finish("ECHEC", empty, ["Connecteur désactivé."], { raison: "desactive" }, "Connecteur désactivé dans les paramètres.");
  }

  const veille = await getSetting("veille");
  const config = (record.config as Record<string, unknown> | null) ?? {};

  let fetched;
  try {
    fetched = await implementation.fetchNotices({
      lookbackDays: Number(config.lookbackDays ?? 7),
      keywords: veille.keywords,
      cpvCodes: veille.cpvCodes,
      pageSize: Number(config.pageSize ?? 100),
      maxPages: Number(config.maxPages ?? 5),
      config: { ...config, baseUrl: record.baseUrl },
    });
  } catch (error) {
    const unavailable = error instanceof ConnectorUnavailableError;
    const message = unavailable
      ? `${(error as ConnectorUnavailableError).message} ${(error as ConnectorUnavailableError).remedy}`
      : `Erreur du connecteur : ${(error as Error).message}`;
    if (unavailable) {
      await prisma.sourceConnector.update({ where: { id: record.id }, data: { status: "INDISPONIBLE" } });
    }
    return finish("ECHEC", empty, [message], { raison: unavailable ? "injoignable" : "erreur" }, message);
  }

  const counters = { fetched: fetched.notices.length, created: 0, updated: 0, duplicates: 0, rectificatifs: 0 };
  const errors = [...fetched.errors];
  const { highRelevanceScore } = await getSetting("reminders");

  for (const notice of fetched.notices) {
    try {
      const result = await ingestNotice(notice, record);
      if (result.kind === "created") counters.created += 1;
      else if (result.kind === "updated") counters.updated += 1;
      else counters.duplicates += 1;
      if (result.rectificatif) counters.rectificatifs += 1;

      if (result.tenderId && result.kind !== "duplicate") {
        const outcome = await recomputeMatching(result.tenderId, { reason: "veille" });
        if (outcome && outcome.scoreGlobal >= highRelevanceScore) {
          await notify({
            kind: "NOUVELLE_CONSULTATION",
            severity: "IMPORTANT",
            title: `Consultation fortement pertinente — score ${outcome.scoreGlobal}/100`,
            body: `${notice.title} — ${notice.buyer}.`,
            tenderId: result.tenderId,
          });
        }
      }
    } catch (error) {
      errors.push(`Avis ${notice.sourceNoticeId} : ${(error as Error).message}`);
    }
  }

  await refreshDeadlineReminders();

  const status: RunOutcome["status"] =
    errors.length === 0 ? "SUCCES" : counters.created + counters.updated > 0 ? "PARTIEL" : "ECHEC";

  const awards = Number((fetched.log as Record<string, unknown>).avisAttributionIgnores ?? 0);
  const message =
    `${counters.fetched} avis retenus, ${counters.created} affaires créées, ` +
    `${counters.updated} mises à jour, ${counters.duplicates} doublons écartés` +
    (awards > 0 ? `, ${awards} avis d'attribution ignorés` : "") +
    ".";

  return finish(status, counters, errors, fetched.log as Prisma.InputJsonValue, message);
}

/** Synchronisation de tous les connecteurs actifs — appelée par la tâche quotidienne. */
export async function runAllConnectors(trigger: "manuelle" | "planifiee" = "planifiee"): Promise<RunOutcome[]> {
  const connectors = await prisma.sourceConnector.findMany({
    where: { enabled: true, status: { in: ["OPERATIONNEL", "INDISPONIBLE"] } },
    select: { key: true },
  });

  const outcomes: RunOutcome[] = [];
  for (const connector of connectors) {
    if (connector.key === "import-manuel") continue;
    try {
      outcomes.push(await runConnector(connector.key, { trigger }));
    } catch (error) {
      console.error(`[veille] ${connector.key}`, error);
    }
  }
  return outcomes;
}
