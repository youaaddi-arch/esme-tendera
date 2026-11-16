/**
 * Intégration d'un avis en affaire.
 *
 * Séparé du moteur de veille pour une raison précise : le moteur est marqué
 * `server-only`, et ce marquage l'empêche d'être importé par un script en
 * ligne de commande. Or l'intégration sert aux deux — à la synchronisation
 * quotidienne comme à la reprise manuelle d'une sélection d'affaires.
 *
 * Dupliquer le code aurait suffi à faire tourner le script. C'est précisément
 * ce qui est arrivé au matching, où la copie du script et celle de
 * l'application ont divergé sans que personne le voie : le script ne faisait
 * plus avancer l'étape du pipeline. Une règle d'intégration qui existe en deux
 * exemplaires finit par exister en deux versions.
 */
import type { Prisma, SourceConnector } from "@prisma/client";

import { prisma } from "../db";
import { recordAudit } from "../audit";
import { notify } from "../notifications";
import { type NormalizedNotice } from "./types";

export type IngestResult = {
  kind: "created" | "updated" | "duplicate";
  tenderId: string | null;
  rectificatif: boolean;
};

/**
 * Intègre un avis.
 *
 * Trois cas : avis déjà connu et inchangé (doublon), avis rectificatif d'une
 * affaire existante (mise à jour + alerte), avis nouveau (création).
 */
export async function ingestNotice(notice: NormalizedNotice, connector: SourceConnector): Promise<IngestResult> {
  const existing = await prisma.tender.findFirst({
    where: { sourceConnectorId: connector.id, sourceNoticeId: notice.sourceNoticeId },
  });

  // Avis rectificatif : on met à jour l'affaire initiale plutôt que d'en créer une seconde.
  const target =
    existing ??
    (notice.rectifiesNoticeId
      ? await prisma.tender.findFirst({
          where: { sourceConnectorId: connector.id, sourceNoticeId: notice.rectifiesNoticeId },
        })
      : null);

  if (target) {
    const deadlineChanged =
      notice.deadlineAt &&
      target.deadlineAt &&
      new Date(notice.deadlineAt).getTime() !== new Date(target.deadlineAt).getTime();

    const isRectificatif = Boolean(notice.rectifiesNoticeId) || deadlineChanged;
    if (!isRectificatif && existing) {
      return { kind: "duplicate", tenderId: target.id, rectificatif: false };
    }

    const history = Array.isArray(target.rectificatifs) ? (target.rectificatifs as unknown[]) : [];
    await prisma.tender.update({
      where: { id: target.id },
      data: {
        deadlineAt: notice.deadlineAt ?? target.deadlineAt,
        objectSummary: notice.objectSummary ?? target.objectSummary,
        procedure: notice.procedure ?? target.procedure,
        rectificatifs: [
          ...history,
          {
            avis: notice.sourceNoticeId,
            type: notice.noticeType,
            recuLe: new Date().toISOString(),
            nouvelleDateLimite: notice.deadlineAt?.toISOString() ?? null,
          },
        ] as unknown as Prisma.InputJsonValue,
      },
    });

    await notify({
      kind: deadlineChanged ? "DATE_LIMITE_MODIFIEE" : "AVIS_RECTIFICATIF",
      severity: "IMPORTANT",
      title: deadlineChanged
        ? `Date limite modifiée — ${target.reference}`
        : `Avis rectificatif — ${target.reference}`,
      body: deadlineChanged
        ? `Nouvelle date limite : ${notice.deadlineAt?.toLocaleDateString("fr-FR")}.`
        : `Un avis rectificatif a été publié sur ${target.title}.`,
      tenderId: target.id,
    });

    await recordAudit({
      action: "veille.rectificatif",
      entity: "Tender",
      entityId: target.id,
      tenderId: target.id,
      actor: "veille",
      summary: deadlineChanged ? "Date limite actualisée par un avis rectificatif." : "Avis rectificatif rattaché.",
      payload: { avis: notice.sourceNoticeId },
    });

    return { kind: "updated", tenderId: target.id, rectificatif: true };
  }

  // Déduplication inter-sources : un même marché peut être publié au BOAMP et
  // sur un profil d'acheteur. On recoupe sur l'acheteur et l'intitulé.
  const crossSource = await prisma.tender.findFirst({
    where: {
      buyer: notice.buyer,
      title: notice.title,
      deadlineAt: notice.deadlineAt ?? undefined,
    },
    select: { id: true },
  });
  if (crossSource) return { kind: "duplicate", tenderId: crossSource.id, rectificatif: false };

  const reference = await nextReference();
  const created = await prisma.tender.create({
    data: {
      reference,
      title: notice.title,
      buyer: notice.buyer,
      buyerSiret: notice.buyerSiret ?? null,
      consultationRef: notice.consultationRef ?? null,
      objectSummary: notice.objectSummary ?? null,
      procedure: notice.procedure ?? null,
      cpvCodes: notice.cpvCodes,
      marketTypes: notice.marketTypes,
      publishedAt: notice.publishedAt ?? null,
      deadlineAt: notice.deadlineAt ?? null,
      contractDuration: notice.contractDuration ?? null,
      executionPlace: notice.executionPlace ?? null,
      region: notice.region ?? null,
      department: notice.department ?? null,
      responseTerms: notice.responseTerms ?? null,
      amountKind: notice.amountKind,
      amountMinEur: notice.amountMinEur ?? null,
      amountMaxEur: notice.amountMaxEur ?? null,
      amountNote: notice.amountNote ?? null,
      sourceConnectorId: connector.id,
      sourceNoticeId: notice.sourceNoticeId,
      sourceUrl: notice.sourceUrl ?? null,
      dceSourceUrl: notice.dceUrl ?? null,
      depotUrl: notice.depotUrl ?? null,
      // La récupération automatique du DCE n'est pas tentée ici : elle dépend
      // de l'accès au profil d'acheteur, souvent nominatif.
      dceStatus: "NON_TENTE",
      stage: "AO_IDENTIFIES",
      lots: {
        create: notice.lots.map((lot) => ({
          number: lot.number,
          title: lot.title,
          description: lot.description ?? null,
          cpvCodes: lot.cpvCodes ?? [],
          amountKind: lot.amountKind ?? "NON_COMMUNIQUE",
          amountMinEur: lot.amountMinEur ?? null,
          amountMaxEur: lot.amountMaxEur ?? null,
        })),
      },
    },
  });

  await recordAudit({
    action: "veille.creation",
    entity: "Tender",
    entityId: created.id,
    tenderId: created.id,
    actor: "veille",
    summary: `Affaire ${reference} créée depuis ${connector.name}.`,
    payload: { avis: notice.sourceNoticeId, source: connector.key, url: notice.sourceUrl },
  });

  if (notice.dceUrl) {
    await notify({
      kind: "DCE_DISPONIBLE",
      title: `Lien DCE publié — ${reference}`,
      body: "Le dossier de consultation est accessible depuis l'avis. Téléchargez-le puis importez-le dans l'onglet DCE.",
      tenderId: created.id,
    });
  }

  return { kind: "created", tenderId: created.id, rectificatif: false };
}

/** Référence interne séquentielle : AO-2026-0001. */
async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `AO-${year}-`;
  const last = await prisma.tender.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const sequence = last ? Number.parseInt(last.reference.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}
