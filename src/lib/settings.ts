import "server-only";

import { prisma } from "./db";

/**
 * Réglages d'administration.
 *
 * Chaque réglage a une valeur par défaut codée ici ; la table `Setting` ne
 * contient que ce qui a été modifié. Les clés de marque permettent de changer
 * le nom et la signature du produit sans toucher au code.
 */

export type BrandSettings = {
  productName: string;
  signature: string;
  institution: string;
  group: string;
  /** Chemin du logo sous /public. */
  logoLight: string;
  logoDark: string;
  primaryColor: string;
  accentColor: string;
};

export type ScoringWeights = {
  catalogue: number;
  voisines: number;
  ionis: number;
};

export type ReminderSettings = {
  /** Jours avant la date limite déclenchant un rappel. */
  daysBefore: number[];
  /** Score global à partir duquel une nouvelle consultation est signalée. */
  highRelevanceScore: number;
};

export type VeilleSettings = {
  /** Heure de la synchronisation quotidienne, fuseau Europe/Paris. */
  dailyHour: number;
  timezone: string;
  /** Mots-clés métier utilisés par les connecteurs. */
  keywords: string[];
  cpvCodes: string[];
};

const DEFAULTS = {
  brand: {
    productName: "ESME TENDERA",
    signature: "L'intelligence des appels d'offres",
    institution: "ESME Executive Education",
    group: "Groupe IONIS",
    logoLight: "/brand/esme-exed-bleu.png",
    logoDark: "/brand/esme-exed-blanc.png",
    primaryColor: "#174290",
    accentColor: "#EB63A0",
  } satisfies BrandSettings,

  // Pondération initiale demandée au cahier des charges, modifiable ici.
  scoring: { catalogue: 60, voisines: 25, ionis: 15 } satisfies ScoringWeights,

  reminders: {
    daysBefore: [15, 7, 3, 1, 0],
    highRelevanceScore: 70,
  } satisfies ReminderSettings,

  veille: {
    dailyHour: 7,
    timezone: "Europe/Paris",
    // Un seul terme, volontairement large.
    //
    // Une liste de mots-clés par domaine (photovoltaïque, smart grid, IA…)
    // fait deux dégâts : elle rate les marchés de formation dont l'intitulé
    // n'emploie aucun de ces mots, et elle ramène des marchés de travaux qui
    // n'ont rien à voir parce qu'ils contiennent « innovation » ou « données ».
    //
    // On ratisse donc sur « formation », et c'est le moteur de matching qui
    // juge la pertinence — affichée sur chaque affaire. Aucun avis n'est écarté
    // en silence : tous sont visibles, avec leur score et leur appréciation.
    keywords: ["formation"],
    // CPV du champ « services de formation ». Non utilisés pour filtrer la
    // requête — le BOAMP n'expose pas de colonne CPV — mais conservés comme
    // référence pour les connecteurs qui le permettront.
    cpvCodes: ["80000000", "80500000", "80510000", "80511000", "80530000", "80532000", "79632000"],
  } satisfies VeilleSettings,
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return DEFAULTS[key];
  // Les valeurs stockées peuvent être partielles : on complète avec les défauts.
  return { ...DEFAULTS[key], ...(row.value as object) } as (typeof DEFAULTS)[K];
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: Partial<(typeof DEFAULTS)[K]>,
  updatedBy?: string,
): Promise<(typeof DEFAULTS)[K]> {
  const merged = { ...(await getSetting(key)), ...value };
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: merged, updatedBy },
    update: { value: merged, updatedBy },
  });
  return merged as (typeof DEFAULTS)[K];
}

export function defaultSetting<K extends SettingKey>(key: K): (typeof DEFAULTS)[K] {
  return DEFAULTS[key];
}

/** Normalise une pondération pour qu'elle totalise 100. */
export function normalizeWeights(weights: ScoringWeights): ScoringWeights {
  const total = weights.catalogue + weights.voisines + weights.ionis;
  if (total <= 0) return DEFAULTS.scoring;
  return {
    catalogue: (weights.catalogue / total) * 100,
    voisines: (weights.voisines / total) * 100,
    ionis: (weights.ionis / total) * 100,
  };
}
