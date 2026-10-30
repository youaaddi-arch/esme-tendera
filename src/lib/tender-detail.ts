import { Prisma } from "@prisma/client";

/**
 * Chargement complet d'une affaire pour sa fiche.
 *
 * L'`include` est défini une seule fois et partagé entre la page et les
 * composants d'onglet : le type dérivé garantit qu'un onglet ne peut pas lire
 * une relation que la requête ne charge pas.
 */
export const tenderDetailInclude = {
  owner: { select: { id: true, name: true } },
  parent: { select: { id: true, reference: true, title: true } },
  children: { select: { id: true, reference: true, lotLabel: true } },
  sourceConnector: { select: { name: true, key: true } },
  lots: { orderBy: { number: "asc" } },
  analysis: true,
  requirements: { orderBy: [{ level: "asc" }, { createdAt: "asc" }] },
  documents: { orderBy: { uploadedAt: "asc" } },
  matchResult: {
    include: {
      matches: {
        orderBy: { score: "desc" },
        include: {
          training: {
            select: {
              id: true, code: true, title: true, origin: true, duration: true,
              modality: true, catalogPage: true, objective: true, skills: true,
              domain: { select: { name: true } },
              institution: { select: { name: true, shortName: true, cooperation: true } },
            },
          },
        },
      },
    },
  },
  decisions: { orderBy: { decidedAt: "desc" }, include: { decidedBy: { select: { name: true } } } },
  tasks: { orderBy: { position: "asc" }, include: { assignee: { select: { id: true, name: true } } } },
  checklistItems: { orderBy: [{ category: "asc" }, { position: "asc" }] },
  responseDocs: { orderBy: { createdAt: "asc" } },
  pricingLines: { orderBy: { position: "asc" } },
  qualityReviews: { orderBy: { createdAt: "desc" }, take: 5 },
  submission: true,
  negotiationItems: { orderBy: { createdAt: "desc" }, include: { assignee: { select: { name: true } } } },
  result: true,
  auditEvents: {
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { user: { select: { name: true } } },
  },
} satisfies Prisma.TenderInclude;

export type TenderDetail = Prisma.TenderGetPayload<{ include: typeof tenderDetailInclude }>;

/** Collaborateurs proposés dans les listes d'affectation. */
export type AssignableUser = { id: string; name: string; role: string };

/** Critères d'attribution, tels que stockés dans l'analyse. */
export type Critere = { label: string; weight: number | null; source?: { fileName: string; page: number } | null };

export function readCriteres(analysis: TenderDetail["analysis"]): Critere[] {
  if (!analysis?.criteres) return [];
  return Array.isArray(analysis.criteres) ? (analysis.criteres as unknown as Critere[]) : [];
}

export type Contradiction = { sujet: string; piecesConcernees: string[]; detail: string };

export function readContradictions(analysis: TenderDetail["analysis"]): Contradiction[] {
  if (!analysis?.contradictions) return [];
  return Array.isArray(analysis.contradictions) ? (analysis.contradictions as unknown as Contradiction[]) : [];
}

export type MemoireContent = {
  frameworkNote?: string;
  sections?: { id: string; heading: string; body: string; origin: string; weight: number | null; todo: string[] }[];
  note?: string;
  fields?: Record<string, string>;
};

export function readContent(document: { content: Prisma.JsonValue | null }): MemoireContent {
  if (!document.content || typeof document.content !== "object" || Array.isArray(document.content)) return {};
  return document.content as unknown as MemoireContent;
}
