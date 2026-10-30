import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { getSetting, type ScoringWeights } from "../settings";
import { recordAudit } from "../audit";
import { runMatching, type MatchingInput } from "./engine";

/**
 * Lance le matching d'une affaire et enregistre le résultat.
 *
 * Le calcul reste déterministe et local. Il est relancé à chaque fois qu'une
 * donnée d'entrée change : analyse du DCE, modification du catalogue,
 * changement de pondération.
 */
export async function recomputeMatching(
  tenderId: string,
  options: { userId?: string | null; weights?: ScoringWeights; reason?: string } = {},
) {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      lots: true,
      analysis: true,
      documents: {
        where: { scope: "DCE", extractionStatus: "termine" },
        select: { extractedPages: true, kind: true },
        take: 12,
      },
      matchResult: { select: { manualOverride: true } },
    },
  });
  if (!tender) throw new Error("Affaire introuvable");

  // Un score ajusté à la main n'est jamais écrasé sans demande explicite.
  if (tender.matchResult?.manualOverride && !options.reason?.includes("force")) {
    return null;
  }

  const trainings = await prisma.training.findMany({ where: { archived: false } });
  const weights = options.weights ?? (await getSetting("scoring"));

  // On privilégie le CCTP et le RC : ce sont eux qui décrivent le besoin.
  const ordered = [...tender.documents].sort((a, b) => rank(a.kind) - rank(b.kind));
  const excerpts = ordered.flatMap((document) => {
    const pages = (document.extractedPages ?? []) as { page: number; text: string }[];
    return pages.slice(0, 40).map((page) => page.text);
  });

  const input: MatchingInput = {
    title: tender.title,
    objectSummary: tender.objectSummary,
    buyer: tender.buyer,
    cpvCodes: tender.cpvCodes,
    lots: tender.lots.map((lot) => ({ number: lot.number, title: lot.title, description: lot.description })),
    analysis: tender.analysis
      ? {
          objet: tender.analysis.objet,
          besoin: tender.analysis.besoin,
          publics: tender.analysis.publics,
          modalites: tender.analysis.modalites,
          certifications: tender.analysis.certifications,
          volumeHoraire: tender.analysis.volumeHoraire,
        }
      : null,
    documentExcerpts: excerpts,
  };

  const outcome = runMatching(input, trainings, weights);

  const result = await prisma.matchResult.upsert({
    where: { tenderId },
    create: {
      tenderId,
      scoreCatalogue: outcome.scoreCatalogue,
      scoreVoisines: outcome.scoreVoisines,
      scoreIonis: outcome.scoreIonis,
      scoreGlobal: outcome.scoreGlobal,
      weights: outcome.weights as unknown as Prisma.InputJsonValue,
      engine: outcome.engine,
      coveredSkills: outcome.coveredSkills,
      missingSkills: outcome.missingSkills,
      adaptableNote: outcome.adaptableNote,
      ionisNote: outcome.ionisNote,
      extraResources: outcome.extraResources,
      constraints: outcome.constraints,
      recommendation: outcome.recommendation,
      caveats: outcome.caveats,
    },
    update: {
      scoreCatalogue: outcome.scoreCatalogue,
      scoreVoisines: outcome.scoreVoisines,
      scoreIonis: outcome.scoreIonis,
      scoreGlobal: outcome.scoreGlobal,
      weights: outcome.weights as unknown as Prisma.InputJsonValue,
      engine: outcome.engine,
      coveredSkills: outcome.coveredSkills,
      missingSkills: outcome.missingSkills,
      adaptableNote: outcome.adaptableNote,
      ionisNote: outcome.ionisNote,
      extraResources: outcome.extraResources,
      constraints: outcome.constraints,
      recommendation: outcome.recommendation,
      caveats: outcome.caveats,
      manualOverride: false,
      computedAt: new Date(),
    },
  });

  await prisma.trainingMatch.deleteMany({ where: { matchResultId: result.id } });
  if (outcome.matches.length > 0) {
    await prisma.trainingMatch.createMany({
      data: outcome.matches.map((match) => ({
        matchResultId: result.id,
        trainingId: match.trainingId,
        score: match.score,
        signals: match.signals,
        covered: match.covered,
        rationale: match.rationale,
      })),
    });
  }

  await recordAudit({
    action: "matching.recompute",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId: options.userId ?? null,
    actor: options.userId ? "utilisateur" : "moteur-ia",
    summary: `Matching recalculé : ESME ${outcome.scoreCatalogue}, voisines ${outcome.scoreVoisines}, IONIS ${outcome.scoreIonis}, global ${outcome.scoreGlobal}.`,
    payload: {
      scores: {
        catalogue: outcome.scoreCatalogue,
        voisines: outcome.scoreVoisines,
        ionis: outcome.scoreIonis,
        global: outcome.scoreGlobal,
      },
      moteur: outcome.engine,
      raison: options.reason ?? "demande",
    },
  });

  return outcome;
}

/** Les pièces qui décrivent le besoin passent devant les pièces administratives. */
function rank(kind: string): number {
  const order = ["CCTP", "RC", "CADRE_MEMOIRE", "CCAP", "AE", "BPU", "DQE", "DPGF"];
  const index = order.indexOf(kind);
  return index === -1 ? order.length : index;
}

/** Recalcule le matching de toutes les affaires actives — après édition du catalogue. */
export async function recomputeActiveMatchings(userId?: string | null): Promise<number> {
  const tenders = await prisma.tender.findMany({
    where: {
      archived: false,
      stage: { in: ["AO_IDENTIFIES", "MATCHING", "GO_NO_GO", "PREPARATION"] },
    },
    select: { id: true },
  });

  let count = 0;
  for (const tender of tenders) {
    try {
      const result = await recomputeMatching(tender.id, { userId, reason: "catalogue modifié" });
      if (result) count += 1;
    } catch (error) {
      console.error(`[matching] échec sur ${tender.id}`, error);
    }
  }
  return count;
}
