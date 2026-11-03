import { NextResponse } from "next/server";

import { autoriserMaintenance } from "@/lib/maintenance-auth";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { connectorRegistry } from "@/lib/veille/registry";

export const maxDuration = 30;

/**
 * Resynchronise un connecteur avec sa définition dans le code.
 *
 * Le seed met à jour le statut d'un connecteur à chaque déploiement, mais
 * laisse son activation et sa configuration tranquilles : ce sont des choix
 * d'exploitation, et les écraser à chaque livraison serait insupportable.
 *
 * Il existe une exception, la mise en service — un connecteur qui passe de
 * « à implémenter » à « opérationnel » n'avait aucun choix à préserver. Mais
 * cette transition ne se produit qu'une fois : un déploiement intermédiaire
 * peut la consommer avant que le correctif n'existe, et le connecteur reste
 * alors opérationnel, correctement décrit, et silencieusement éteint avec la
 * configuration de ses débuts. C'est arrivé à TED, dont la fenêtre de
 * recherche était restée à sept jours.
 *
 * Cette route répare ce cas, et seulement sur demande explicite : elle
 * réapplique au connecteur désigné son statut, son activation et sa
 * configuration d'origine. Ce n'est pas automatique, parce que cela écrase un
 * réglage que quelqu'un a peut-être voulu.
 *
 *     POST /api/maintenance/connecteur?cle=ted
 *     POST /api/maintenance/connecteur?cle=ted&jours=60
 */
export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;
  const { par } = autorisation;

  const url = new URL(request.url);

  const cle = url.searchParams.get("cle");
  const connecteur = connectorRegistry.find((entry) => entry.key === cle);
  if (!connecteur) {
    return NextResponse.json(
      { erreur: `Connecteur « ${cle} » inconnu.`, connus: connectorRegistry.map((c) => c.key) },
      { status: 400 },
    );
  }

  const existant = await prisma.sourceConnector.findUnique({ where: { key: connecteur.key } });
  if (!existant) {
    return NextResponse.json({ erreur: "Ce connecteur n'est pas encore enregistré en base." }, { status: 404 });
  }

  // Fenêtre de recherche : seul réglage qu'on accepte de surcharger ici, parce
  // qu'il dépend de la profondeur d'historique voulue, pas du code.
  const joursParam = url.searchParams.get("jours");
  const jours = joursParam ? Number(joursParam) : null;
  if (joursParam && (!Number.isFinite(jours) || jours! < 1 || jours! > 365)) {
    return NextResponse.json({ erreur: "« jours » doit être compris entre 1 et 365." }, { status: 400 });
  }

  const config = {
    ...(connecteur.defaultConfig ?? {}),
    ...(jours ? { lookbackDays: jours } : {}),
  } as Prisma.InputJsonValue;

  const avant = {
    statut: existant.status,
    actif: existant.enabled,
    config: existant.config,
  };

  const apres = await prisma.sourceConnector.update({
    where: { key: connecteur.key },
    data: {
      status: connecteur.status,
      enabled: connecteur.enabledByDefault,
      requirement: connecteur.requirement,
      config,
    },
    select: { key: true, status: true, enabled: true, config: true },
  });

  await recordAudit({
    action: "connecteur.resynchronise",
    entity: "SourceConnector",
    entityId: existant.id,
    actor: par.acteur,
    userId: par.userId ?? undefined,
    summary:
      `Connecteur ${connecteur.key} resynchronisé : ${avant.statut}/${avant.actif ? "actif" : "inactif"} ` +
      `→ ${apres.status}/${apres.enabled ? "actif" : "inactif"}.`,
    payload: { avant, apres },
  });

  return NextResponse.json({ avant, apres });
}

/** GET : l'état enregistré de chaque connecteur, face à sa définition. */
export async function GET() {
  const enregistres = await prisma.sourceConnector.findMany({
    select: { key: true, status: true, enabled: true, config: true },
    orderBy: { key: "asc" },
  });
  const parCle = new Map(enregistres.map((row) => [row.key, row]));

  return NextResponse.json({
    connecteurs: connectorRegistry.map((entry) => {
      const row = parCle.get(entry.key);
      return {
        cle: entry.key,
        code: { statut: entry.status, actifParDefaut: entry.enabledByDefault },
        base: row ? { statut: row.status, actif: row.enabled, config: row.config } : null,
        ecart: row ? row.status !== entry.status || row.enabled !== entry.enabledByDefault : true,
      };
    }),
  });
}
