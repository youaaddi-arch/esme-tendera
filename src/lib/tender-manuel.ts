import "server-only";

/**
 * Création manuelle d'une affaire.
 *
 * C'est la voie de secours, et elle est légitime : un marché peut être réel
 * sans figurer dans aucune source ouverte. Une procédure adaptée n'a pas
 * d'obligation de publication au BOAMP, et son avis ne vit alors que sur le
 * profil d'acheteur. La veille ne la verra jamais ; quelqu'un l'a vue.
 *
 * La fiche porte exactement ce qu'on lui donne, et rien de plus. Pas de CPV
 * déduits, pas de montant supposé, pas de lots inventés : une affaire créée à
 * la main est maigre, et il vaut mieux qu'elle le paraisse. Elle est rattachée
 * au connecteur « import-manuel », qui existe pour dire d'où elle vient.
 *
 * Extrait de l'action du formulaire parce que deux chemins y mènent — le
 * formulaire, et la reprise d'un tri fait ailleurs — et qu'une règle recopiée
 * finit par exister en deux versions.
 */
import { prisma } from "./db";
import { recordAudit } from "./audit";
import { recomputeMatching } from "./matching/service";
import { nextManualReference } from "./tenders";

export type TenderManuelInput = {
  title: string;
  buyer: string;
  consultationRef?: string | null;
  objectSummary?: string | null;
  procedure?: string | null;
  deadlineAt?: Date | null;
  publishedAt?: Date | null;
  sourceUrl?: string | null;
  dceSourceUrl?: string | null;
  region?: string | null;
  cpvCodes?: string[];
  amountKind?: "ESTIME" | "MAXIMUM" | "PAR_LOT" | "GLOBAL" | "NON_COMMUNIQUE";
  amountMaxEur?: number | null;
  /** Qui saisit. Obligatoire : une fiche manuelle a un auteur. */
  userId: string;
  /** D'où vient l'information, en clair, pour la trace. */
  provenance?: string | null;
};

export async function createManualTender(
  input: TenderManuelInput,
): Promise<{ id: string; reference: string }> {
  const connector = await prisma.sourceConnector.findUnique({ where: { key: "import-manuel" } });
  const reference = await nextManualReference();

  const tender = await prisma.tender.create({
    data: {
      reference,
      title: input.title.trim(),
      buyer: input.buyer.trim(),
      consultationRef: input.consultationRef?.trim() || null,
      objectSummary: input.objectSummary?.trim() || null,
      procedure: input.procedure?.trim() || null,
      deadlineAt: input.deadlineAt ?? null,
      publishedAt: input.publishedAt ?? null,
      sourceUrl: input.sourceUrl?.trim() || null,
      dceSourceUrl: input.dceSourceUrl?.trim() || null,
      region: input.region?.trim() || null,
      cpvCodes: input.cpvCodes ?? [],
      // « Non communiqué » par défaut, et non zéro : une absence de montant
      // n'est pas un montant nul.
      amountKind: input.amountKind ?? "NON_COMMUNIQUE",
      amountMaxEur: input.amountMaxEur ?? null,
      sourceConnectorId: connector?.id ?? null,
      ownerId: input.userId,
      stage: "AO_IDENTIFIES",
    },
    select: { id: true, reference: true },
  });

  await recordAudit({
    action: "tender.create",
    entity: "Tender",
    entityId: tender.id,
    tenderId: tender.id,
    userId: input.userId,
    summary:
      `Affaire ${reference} créée manuellement.` +
      (input.provenance ? ` Provenance : ${input.provenance}` : ""),
  });

  await recomputeMatching(tender.id, { userId: input.userId, reason: "création manuelle" });

  return tender;
}
