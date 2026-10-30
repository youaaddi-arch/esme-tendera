import "server-only";

import type { PipelineStage, Prisma } from "@prisma/client";

import { prisma } from "./db";
import { recordAudit } from "./audit";
import { notify } from "./notifications";
import { allowedTransitions, stageLabels } from "./labels";

/** Erreur métier : message destiné à être affiché tel quel à l'utilisateur. */
export class TenderRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenderRuleError";
  }
}

/**
 * Déplace une affaire dans le pipeline.
 *
 * Deux garde-fous que le glisser-déposer ne peut pas contourner :
 *
 *  - on n'entre en préparation de réponse qu'après une décision GO explicite ;
 *  - on n'atteint « Dépôt effectué » qu'avec un dépôt confirmé depuis la fiche,
 *    parce qu'un dépôt est un fait, pas un statut qu'on se donne.
 */
export async function moveTenderStage(
  tenderId: string,
  target: PipelineStage,
  userId: string,
): Promise<{ stage: PipelineStage }> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: { submission: { select: { confirmed: true } } },
  });
  if (!tender) throw new TenderRuleError("Affaire introuvable.");
  if (tender.stage === target) return { stage: target };

  const permitted = allowedTransitions[tender.stage] ?? [];
  if (!permitted.includes(target)) {
    throw new TenderRuleError(
      `Transition non autorisée : « ${stageLabels[tender.stage]} » vers « ${stageLabels[target]} ». ` +
        `Étapes accessibles : ${permitted.map((stage) => stageLabels[stage]).join(", ") || "aucune"}.`,
    );
  }

  if (target === "PREPARATION" && tender.goNoGo !== "GO") {
    throw new TenderRuleError(
      "Enregistrez d'abord une décision GO depuis l'onglet Go / No Go de la fiche.",
    );
  }

  if (target === "DEPOT_EFFECTUE" && !tender.submission?.confirmed) {
    throw new TenderRuleError(
      "Le dépôt doit être confirmé depuis la fiche : plateforme, date, responsable et accusé de réception. " +
        "TENDERA ne marque jamais une affaire comme déposée sans cette confirmation.",
    );
  }

  await prisma.tender.update({ where: { id: tenderId }, data: { stage: target } });

  await recordAudit({
    action: "tender.stage",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId,
    summary: `Étape : « ${stageLabels[tender.stage]} » → « ${stageLabels[target]} ».`,
    payload: { avant: tender.stage, apres: target },
  });

  if (target === "GO_NO_GO") {
    await notify({
      kind: "GO_NO_GO_A_DECIDER",
      severity: "IMPORTANT",
      title: `Décision attendue — ${tender.reference}`,
      body: tender.title,
      tenderId,
    });
  }

  return { stage: target };
}

/** Champs qu'un utilisateur habilité peut modifier sur la fiche. */
export const EDITABLE_TENDER_FIELDS = [
  "title", "buyer", "buyerSiret", "consultationRef", "objectSummary", "procedure",
  "lotLabel", "contractDuration", "renewals", "executionPlace", "region", "department",
  "responseTerms", "amountNote", "sourceUrl", "dceSourceUrl",
] as const;

export type EditableTenderField = (typeof EDITABLE_TENDER_FIELDS)[number];

/** Crée une affaire distincte pour un lot, en reprenant le contexte de la consultation mère. */
export async function spawnLotTender(lotId: string, userId: string) {
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: { tender: true } });
  if (!lot) throw new TenderRuleError("Lot introuvable.");
  if (lot.spawnedTenderId) {
    throw new TenderRuleError("Une affaire existe déjà pour ce lot.");
  }

  const parent = lot.tender;
  const reference = `${parent.reference}-L${lot.number}`;
  const existing = await prisma.tender.findUnique({ where: { reference } });
  if (existing) throw new TenderRuleError(`La référence ${reference} est déjà utilisée.`);

  const created = await prisma.tender.create({
    data: {
      reference,
      title: `${parent.title} — lot ${lot.number} : ${lot.title}`,
      buyer: parent.buyer,
      buyerSiret: parent.buyerSiret,
      consultationRef: parent.consultationRef,
      objectSummary: lot.description ?? parent.objectSummary,
      procedure: parent.procedure,
      cpvCodes: lot.cpvCodes.length > 0 ? lot.cpvCodes : parent.cpvCodes,
      lotLabel: `Lot ${lot.number}`,
      publishedAt: parent.publishedAt,
      deadlineAt: parent.deadlineAt,
      contractDuration: parent.contractDuration,
      executionPlace: parent.executionPlace,
      region: parent.region,
      department: parent.department,
      responseTerms: parent.responseTerms,
      amountKind: lot.amountKind,
      amountMinEur: lot.amountMinEur,
      amountMaxEur: lot.amountMaxEur,
      sourceConnectorId: parent.sourceConnectorId,
      sourceNoticeId: parent.sourceNoticeId ? `${parent.sourceNoticeId}#lot${lot.number}` : null,
      sourceUrl: parent.sourceUrl,
      dceSourceUrl: parent.dceSourceUrl,
      dceStatus: parent.dceStatus,
      isDemo: parent.isDemo,
      ownerId: parent.ownerId,
      parentId: parent.id,
      stage: "AO_IDENTIFIES",
    },
  });

  await prisma.lot.update({ where: { id: lotId }, data: { spawnedTenderId: created.id } });

  await recordAudit({
    action: "tender.lotSpawn",
    entity: "Tender",
    entityId: created.id,
    tenderId: created.id,
    userId,
    summary: `Affaire créée pour le lot ${lot.number} de ${parent.reference}.`,
    payload: { parent: parent.reference, lot: lot.number },
  });

  return created;
}

/** Référence interne séquentielle pour une création manuelle. */
export async function nextManualReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `AO-${year}-`;
  const last = await prisma.tender.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const sequence = last ? Number.parseInt(last.reference.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(Number.isNaN(sequence) ? 1 : sequence).padStart(4, "0")}`;
}

export type TenderCardData = Prisma.TenderGetPayload<{
  select: {
    id: true; reference: true; title: true; buyer: true; consultationRef: true;
    lotLabel: true; amountKind: true; amountMinEur: true; amountMaxEur: true;
    publishedAt: true; deadlineAt: true; stage: true; goNoGo: true; outcome: true;
    dceStatus: true; isDemo: true;
    owner: { select: { id: true; name: true } };
    matchResult: { select: { scoreGlobal: true; scoreCatalogue: true } };
    _count: { select: { lots: true; documents: true } };
  };
}>;

export const TENDER_CARD_SELECT = {
  id: true, reference: true, title: true, buyer: true, consultationRef: true,
  lotLabel: true, amountKind: true, amountMinEur: true, amountMaxEur: true,
  publishedAt: true, deadlineAt: true, stage: true, goNoGo: true, outcome: true,
  dceStatus: true, isDemo: true,
  owner: { select: { id: true, name: true } },
  matchResult: { select: { scoreGlobal: true, scoreCatalogue: true } },
  _count: { select: { lots: true, documents: true } },
} satisfies Prisma.TenderSelect;
