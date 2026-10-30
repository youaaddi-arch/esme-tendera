import "server-only";

import type { PipelineStage } from "@prisma/client";

import { prisma } from "./db";
import { getSetting } from "./settings";

/**
 * Indicateurs de pilotage.
 *
 * Trois natures de montant sont tenues séparées, parce qu'elles ne disent pas
 * la même chose et qu'on ne les additionne pas :
 *
 *   - potentiel : somme des montants publiés des affaires encore en jeu ;
 *   - remporté  : montants des marchés attribués ;
 *   - réalisé   : chiffre d'affaires effectivement exécuté — non suivi par
 *                 TENDERA, qui ne dispose pas des données de facturation.
 */

export type DashboardFilters = {
  from?: Date;
  to?: Date;
  ownerId?: string;
  domain?: string;
  buyer?: string;
};

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

export async function getDashboardStats(filters: DashboardFilters = {}) {
  // Le seuil de « consultation pertinente » est celui des paramètres : afficher
  // un compteur fondé sur une autre valeur que celle qui déclenche les alertes
  // donnerait deux vérités différentes.
  const { highRelevanceScore } = await getSetting("reminders");
  const where = {
    archived: false,
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.buyer ? { buyer: { contains: filters.buyer, mode: "insensitive" as const } } : {}),
    ...(filters.from || filters.to
      ? { publishedAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));

  const [
    byStage, detectedToday, detectedThisWeek, goCount, noGoCount, toDecide,
    deadlinesSoon, submitted, awarded, rejected, totalActive, relevant,
  ] = await Promise.all([
    prisma.tender.groupBy({ by: ["stage"], where, _count: { _all: true } }),
    prisma.tender.count({ where: { ...where, createdAt: { gte: startOfDay } } }),
    prisma.tender.count({ where: { ...where, createdAt: { gte: startOfWeek } } }),
    prisma.tender.count({ where: { ...where, goNoGo: "GO" } }),
    prisma.tender.count({ where: { ...where, goNoGo: "NO_GO" } }),
    prisma.tender.count({ where: { ...where, goNoGo: "A_DECIDER", stage: { in: ["MATCHING", "GO_NO_GO"] } } }),
    prisma.tender.count({
      where: {
        ...where,
        deadlineAt: { gte: new Date(), lte: new Date(Date.now() + 15 * 86_400_000) },
        stage: { in: ["PREPARATION", "CONTROLE_QUALITE", "PRET_AU_DEPOT"] },
      },
    }),
    prisma.tender.count({ where: { ...where, stage: { in: ["DEPOT_EFFECTUE", "NEGOCIATION", "ATTENTE_RESULTAT", "MARCHE_ATTRIBUE"] } } }),
    prisma.tender.count({ where: { ...where, outcome: "ATTRIBUE" } }),
    prisma.tender.count({ where: { ...where, outcome: "REJETE" } }),
    prisma.tender.count({ where }),
    prisma.matchResult.count({ where: { scoreGlobal: { gte: highRelevanceScore }, tender: where } }),
  ]);

  const stageCounts = Object.fromEntries(byStage.map((row) => [row.stage, row._count._all])) as Record<PipelineStage, number>;

  // Montants : on ne somme que ce qui est publié. Une affaire sans montant
  // n'est pas comptée pour zéro, elle est comptée à part.
  const [potentialAgg, awardedAgg, unknownAmount] = await Promise.all([
    prisma.tender.aggregate({
      where: { ...where, stage: { notIn: ["REJETE_NON_POURSUIVI"] }, amountMaxEur: { not: null } },
      _sum: { amountMaxEur: true },
    }),
    prisma.tenderResult.aggregate({
      where: { status: "ATTRIBUE", tender: where },
      _sum: { awardedAmountEur: true },
    }),
    prisma.tender.count({ where: { ...where, amountKind: "NON_COMMUNIQUE" } }),
  ]);

  // Taux de transformation : marchés attribués rapportés aux dossiers déposés
  // dont le résultat est connu. Les dossiers en attente sont exclus du
  // dénominateur, sans quoi le taux serait mécaniquement sous-évalué.
  const decided = awarded + rejected;
  const winRate = decided > 0 ? Math.round((awarded / decided) * 100) : null;

  const [byDomain, byBuyer, byInstitution] = await Promise.all([
    topDomains(where),
    topBuyers(where),
    topInstitutions(),
  ]);

  const weekly = await weeklyDetections(filters.ownerId);
  const averageResponseDays = await averageResponseTime();

  return {
    stageCounts,
    detectedToday,
    detectedThisWeek,
    relevant,
    goCount,
    noGoCount,
    toDecide,
    inDrafting: stageCounts.PREPARATION ?? 0,
    toReview: stageCounts.CONTROLE_QUALITE ?? 0,
    deadlinesSoon,
    submitted,
    awarded,
    rejected,
    totalActive,
    winRate,
    relevanceThreshold: highRelevanceScore,
    amounts: {
      potential: Number(potentialAgg._sum.amountMaxEur ?? 0),
      won: Number(awardedAgg._sum.awardedAmountEur ?? 0),
      unknownCount: unknownAmount,
    },
    byDomain,
    byBuyer,
    byInstitution,
    weekly,
    averageResponseDays,
  };
}

/**
 * Répartition des consultations par domaine.
 *
 * Le domaine vient de la meilleure correspondance du matching. Toutes les
 * fiches du référentiel — catalogue, voisines et compétences IONIS — portent un
 * domaine : une consultation est donc toujours classée par son sujet, jamais
 * par la famille de la fiche qui l'a fait ressortir. « Groupe IONIS » est un
 * groupe d'établissements, pas un domaine de formation.
 */
async function topDomains(where: object) {
  const rows = await prisma.trainingMatch.findMany({
    where: { matchResult: { tender: where } },
    select: {
      score: true,
      matchResultId: true,
      training: { select: { domain: { select: { name: true } } } },
    },
    orderBy: { score: "desc" },
  });

  // Une affaire est comptée une fois, pour le domaine de sa meilleure fiche
  // qui en porte un.
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (seen.has(row.matchResultId)) continue;
    const name = row.training.domain?.name;
    if (!name) continue;
    seen.add(row.matchResultId);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

async function topBuyers(where: object) {
  const rows = await prisma.tender.groupBy({
    by: ["buyer"],
    where: where as never,
    _count: { _all: true },
    orderBy: { _count: { buyer: "desc" } },
    take: 8,
  });
  return rows.map((row) => ({ label: row.buyer, value: row._count._all }));
}

async function topInstitutions() {
  const rows = await prisma.training.groupBy({
    by: ["institutionId"],
    where: { origin: "IONIS", matches: { some: { score: { gte: 45 } } } },
    _count: { _all: true },
  });
  if (rows.length === 0) return [];
  const institutions = await prisma.institution.findMany({
    where: { id: { in: rows.map((row) => row.institutionId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, shortName: true, name: true },
  });
  const byId = new Map(institutions.map((item) => [item.id, item.shortName ?? item.name]));
  return rows
    .filter((row) => row.institutionId)
    .map((row) => ({ label: byId.get(row.institutionId!) ?? "Établissement", value: row._count._all }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Détections des douze dernières semaines.
 *
 * Les intervalles sont calés sur les lundis et se terminent sur la semaine en
 * cours : sans cela, les affaires créées aujourd'hui tombent hors des
 * intervalles et la courbe reste plate alors que la veille tourne.
 */
async function weeklyDetections(ownerId?: string) {
  const currentMonday = new Date();
  currentMonday.setHours(0, 0, 0, 0);
  currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));

  const since = new Date(currentMonday);
  since.setDate(since.getDate() - 11 * 7);

  const tenders = await prisma.tender.findMany({
    where: { createdAt: { gte: since }, archived: false, ...(ownerId ? { ownerId } : {}) },
    select: { createdAt: true },
  });

  const buckets = new Map<string, number>();
  for (let index = 0; index < 12; index += 1) {
    const start = new Date(since);
    start.setDate(start.getDate() + index * 7);
    buckets.set(weekKey(start), 0);
  }
  for (const tender of tenders) {
    const key = weekKey(tender.createdAt);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

function weekKey(date: Date): string {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/** Délai moyen entre la création d'une affaire et le dépôt confirmé. */
async function averageResponseTime(): Promise<number | null> {
  const submissions = await prisma.submission.findMany({
    where: { confirmed: true, submittedAt: { not: null } },
    select: { submittedAt: true, tender: { select: { createdAt: true } } },
    take: 200,
  });
  if (submissions.length === 0) return null;
  const total = submissions.reduce((sum, item) => {
    if (!item.submittedAt) return sum;
    return sum + (item.submittedAt.getTime() - item.tender.createdAt.getTime()) / 86_400_000;
  }, 0);
  return Math.round(total / submissions.length);
}
