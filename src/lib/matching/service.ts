import "server-only";

import { prisma } from "../db";
import { getSetting, type ScoringWeights } from "../settings";
import { recordAudit } from "../audit";
import { persistMatching } from "./persist";

/**
 * Lance le matching d'une affaire et enregistre le résultat.
 *
 * Le calcul reste déterministe et local. Il est relancé à chaque fois qu'une
 * donnée d'entrée change : analyse du DCE, modification du catalogue,
 * changement de pondération.
 *
 * Le calcul lui-même vit dans `persist.ts`, que les scripts d'exploitation
 * partagent. Ce service y ajoute ce qui n'a de sens que dans l'application :
 * la pondération issue des réglages, et la trace au journal d'audit.
 */
export async function recomputeMatching(
  tenderId: string,
  options: { userId?: string | null; weights?: ScoringWeights; reason?: string } = {},
) {
  const weights = options.weights ?? (await getSetting("scoring"));
  const outcome = await persistMatching(prisma, tenderId, { weights, reason: options.reason });

  // Null : un score ajusté à la main, que le recalcul a respecté.
  if (!outcome) return null;

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
