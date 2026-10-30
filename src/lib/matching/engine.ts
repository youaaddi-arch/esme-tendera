import type { Training, TrainingOrigin } from "@prisma/client";

import { conceptLabel, detectConcepts, expandWithConcepts } from "./synonyms";
import { buildIdf, cosine, coverage, termVector, tokenizeWithBigrams } from "./text";
import type { ScoringWeights } from "../settings";

/**
 * Moteur de matching pédagogique.
 *
 * Il répond à une question : « ce que l'acheteur demande, savons-nous le
 * faire ? » — et à aucune autre. Les scores mesurent l'adéquation pédagogique
 * et opérationnelle ; ils ne prédisent pas la probabilité de remporter le
 * marché, qui dépend du prix, de la concurrence et des références.
 *
 * Le moteur est entièrement déterministe et local : aucune clé d'API n'est
 * nécessaire, et deux exécutions sur les mêmes données donnent le même
 * résultat. Un moteur IA peut ensuite enrichir la restitution, jamais la
 * remplacer silencieusement.
 */

export type MatchingInput = {
  title: string;
  objectSummary?: string | null;
  buyer?: string | null;
  cpvCodes?: string[];
  lots?: { number: string; title: string; description?: string | null }[];
  /** Éléments issus de l'analyse du DCE, quand elle a eu lieu. */
  analysis?: {
    objet?: string | null;
    besoin?: string | null;
    publics?: string[];
    modalites?: string[];
    certifications?: string[];
    volumeHoraire?: string | null;
  } | null;
  /** Extraits de texte des pièces du DCE, pour affiner. */
  documentExcerpts?: string[];
};

export type TrainingScore = {
  trainingId: string;
  code: string;
  title: string;
  origin: TrainingOrigin;
  /** Score de la fiche, sur 100. */
  score: number;
  /** Concepts partagés, en clair. */
  signals: string[];
  covered: string[];
  rationale: string;
};

export type MatchingOutcome = {
  scoreCatalogue: number;
  scoreVoisines: number;
  scoreIonis: number;
  scoreGlobal: number;
  weights: ScoringWeights;
  matches: TrainingScore[];
  coveredSkills: string[];
  missingSkills: string[];
  adaptableNote: string | null;
  ionisNote: string | null;
  extraResources: string[];
  constraints: string[];
  recommendation: string;
  caveats: string[];
  engine: "deterministe";
};

/** Profil textuel d'une fiche : ce à quoi la demande est comparée. */
function trainingProfile(training: Training): string {
  const programme = Array.isArray(training.programme)
    ? (training.programme as { heading?: string; items?: string[] }[])
        .map((block) => `${block.heading ?? ""} ${(block.items ?? []).join(" ")}`)
        .join(" ")
    : "";
  return [
    training.title,
    training.theme ?? "",
    training.subTheme ?? "",
    training.objective ?? "",
    training.audience ?? "",
    training.objectives.join(" "),
    training.skills.join(" "),
    training.relatedSkills.join(" "),
    training.keywords.join(" "),
    training.highlights.join(" "),
    programme,
  ].join(" ");
}

function queryText(input: MatchingInput): string {
  return [
    input.title,
    input.objectSummary ?? "",
    (input.lots ?? []).map((lot) => `${lot.title} ${lot.description ?? ""}`).join(" "),
    input.analysis?.objet ?? "",
    input.analysis?.besoin ?? "",
    (input.analysis?.publics ?? []).join(" "),
    (input.analysis?.modalites ?? []).join(" "),
    (input.analysis?.certifications ?? []).join(" "),
    // Les extraits de DCE sont bornés : au-delà, le bruit administratif
    // (clauses de résiliation, assurances) dilue le signal pédagogique.
    (input.documentExcerpts ?? []).join(" ").slice(0, 24_000),
  ].join(" ");
}

/**
 * Convertit une similarité brute en note sur 100.
 *
 * Les similarités cosinus utiles se situent entre 0,05 et 0,45 sur ce corpus :
 * une transformation saturante les étale sur une échelle lisible sans jamais
 * atteindre 100, qui signifierait une certitude que le moteur ne peut pas
 * avoir.
 */
function calibrate(raw: number): number {
  const scaled = 100 * (1 - Math.exp(-3.2 * raw));
  return Math.max(0, Math.min(97, scaled));
}

/** Note agrégée d'une famille : la meilleure fiche pèse, la profondeur aussi. */
function aggregate(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => b - a);
  const best = sorted[0];
  const depth = sorted.slice(0, 3).reduce((sum, value) => sum + value, 0) / Math.min(3, sorted.length);
  // Une seule fiche très proche vaut mieux que trois fiches tièdes, mais la
  // profondeur de l'offre compte : elle conditionne la capacité à couvrir
  // plusieurs lots ou plusieurs publics.
  return Math.round(best * 0.68 + depth * 0.32);
}

export function runMatching(
  input: MatchingInput,
  trainings: Training[],
  weights: ScoringWeights,
): MatchingOutcome {
  const caveats: string[] = [];
  const active = trainings.filter((training) => !training.archived);

  if (active.length === 0) {
    return {
      scoreCatalogue: 0, scoreVoisines: 0, scoreIonis: 0, scoreGlobal: 0,
      weights, matches: [], coveredSkills: [], missingSkills: [],
      adaptableNote: null, ionisNote: null, extraResources: [], constraints: [],
      recommendation: "Référentiel pédagogique vide : importez le catalogue avant de lancer le matching.",
      caveats: ["Aucune formation active dans le référentiel."],
      engine: "deterministe",
    };
  }

  const query = queryText(input);
  if (!input.analysis && (input.documentExcerpts ?? []).length === 0) {
    caveats.push(
      "Calcul fondé sur l'avis seul : aucune pièce du DCE n'a été analysée. Le score peut évoluer après récupération du dossier.",
    );
  }
  if (query.trim().length < 80) {
    caveats.push("Les éléments descriptifs de la consultation sont très courts : le score est peu fiable.");
  }

  const profiles = active.map((training) => tokenizeWithBigrams(trainingProfile(training)));
  const idf = buildIdf(profiles);

  const queryTokens = expandWithConcepts(tokenizeWithBigrams(query));
  const queryVector = termVector(queryTokens);
  const queryConcepts = new Set(detectConcepts(query));
  const queryTokenSet = new Set(queryTokens);

  const scored: TrainingScore[] = active.map((training, index) => {
    const profileTokens = expandWithConcepts(profiles[index]);
    const profileVector = termVector(profileTokens);
    const profileConcepts = new Set(profileTokens.filter((token) => token.startsWith("@")));

    const lexical = cosine(queryVector, profileVector, idf);

    // Recouvrement conceptuel : c'est lui qui rattrape les formulations
    // d'acheteur éloignées du vocabulaire du catalogue.
    const shared = [...profileConcepts].filter((concept) => queryConcepts.has(concept));
    const union = new Set([...profileConcepts, ...queryConcepts]).size;
    const conceptual = union === 0 ? 0 : shared.length / union;

    // Couverture des compétences explicitement listées sur la fiche.
    const skillTokens = training.skills.flatMap((skill) => tokenizeWithBigrams(skill));
    const skillCoverage = coverage(skillTokens, queryTokenSet);

    let raw = lexical * 0.5 + conceptual * 0.32 + skillCoverage * 0.18;

    // Ajustements d'exécution : ils corrigent à la marge, jamais au point de
    // transformer une fiche hors sujet en correspondance.
    const modalites = (input.analysis?.modalites ?? []).join(" ").toLowerCase();
    if (modalites.includes("distanciel") || modalites.includes("distance")) {
      const remoteCapable =
        training.deliveryModes.some((mode) => /distanciel|hybride|mixte/i.test(mode)) ||
        /distanciel/i.test(training.modality ?? "");
      raw *= remoteCapable ? 1.04 : 0.94;
    }
    if (training.intraOnly && /inter-entreprise/i.test(query)) raw *= 0.95;

    const signals = shared.map(conceptLabel).slice(0, 8);
    const covered = training.skills
      .filter((skill) => coverage(tokenizeWithBigrams(skill), queryTokenSet) >= 0.5)
      .slice(0, 6);

    const score = calibrate(raw);
    return {
      trainingId: training.id,
      code: training.code,
      title: training.title,
      origin: training.origin,
      score,
      signals,
      covered,
      rationale: buildRationale(training, score, signals, covered),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const byOrigin = (origin: TrainingOrigin) => scored.filter((item) => item.origin === origin);
  const catalogueMatches = byOrigin("CATALOGUE_ESME");
  const voisineMatches = byOrigin("VOISINE");
  const ionisMatches = byOrigin("IONIS");

  const scoreCatalogue = aggregate(catalogueMatches.slice(0, 6).map((item) => item.score));
  const scoreIonis = aggregate(ionisMatches.slice(0, 6).map((item) => item.score));

  // Score B : capacité d'adaptation. Elle combine les fiches voisines du
  // référentiel et le potentiel de conception sur mesure à partir des fiches
  // ESME partiellement pertinentes — une formation proche mais non identique
  // reste un point d'appui réel pour construire un programme adapté.
  const adaptationBase = aggregate(voisineMatches.slice(0, 6).map((item) => item.score));
  const partialEsme = catalogueMatches
    .filter((item) => item.score >= 25 && item.score < 70)
    .slice(0, 4)
    .map((item) => item.score);
  const scoreVoisines = Math.min(
    97,
    Math.round(adaptationBase * 0.7 + (partialEsme.length ? aggregate(partialEsme) * 0.3 : 0)),
  );

  const normalized = normalize(weights);
  const scoreGlobal = Math.round(
    (scoreCatalogue * normalized.catalogue +
      scoreVoisines * normalized.voisines +
      scoreIonis * normalized.ionis) /
      100,
  );

  // Compétences demandées : concepts repérés dans la consultation, couverts ou non.
  const topMatches = scored.filter((item) => item.score >= 35).slice(0, 10);
  const coveredConcepts = new Set<string>();
  for (const match of topMatches) for (const signal of match.signals) coveredConcepts.add(signal);

  const demanded = [...queryConcepts].map(conceptLabel);
  const coveredSkills = demanded.filter((label) => coveredConcepts.has(label));
  const missingSkills = demanded.filter((label) => !coveredConcepts.has(label));

  const constraints: string[] = [];
  const extraResources: string[] = [];
  if (input.analysis?.certifications?.length) {
    constraints.push(
      `Certifications exigées à vérifier auprès du service qualité : ${input.analysis.certifications.join(", ")}.`,
    );
  }
  if (/distanciel|classe virtuelle|e-?learning|foad/i.test(query)) {
    extraResources.push("Dispositif distanciel : plateforme LMS et scénarisation à confirmer.");
  }
  if (missingSkills.length > 0) {
    extraResources.push(
      `Compétences non couvertes par le catalogue : ${missingSkills.slice(0, 5).join(", ")}.`,
    );
  }
  if (ionisMatches.some((item) => item.score >= 50)) {
    constraints.push(
      "Une contribution d'un autre établissement du Groupe IONIS suppose un accord formel : aucun établissement ne peut engager un autre sans validation.",
    );
  }

  const adaptableNote =
    voisineMatches.length > 0 && scoreVoisines >= 40
      ? `Adaptation envisageable à partir de : ${voisineMatches
          .slice(0, 3)
          .map((item) => item.title)
          .join(" ; ")}. Une compétence voisine n'est pas une capacité de réalisation confirmée : elle doit être validée par l'ingénierie pédagogique.`
      : null;

  const ionisNote =
    ionisMatches.length > 0 && scoreIonis >= 40
      ? `Compétences mobilisables côté Groupe IONIS : ${ionisMatches
          .slice(0, 3)
          .map((item) => `${item.title} (${item.code})`)
          .join(" ; ")}. À confirmer avec l'établissement concerné.`
      : null;

  caveats.push(
    "Les trois scores mesurent l'adéquation pédagogique et opérationnelle, pas la probabilité de remporter le marché.",
  );

  return {
    scoreCatalogue,
    scoreVoisines,
    scoreIonis,
    scoreGlobal,
    weights: normalized,
    matches: scored.filter((item) => item.score >= 12).slice(0, 25),
    coveredSkills,
    missingSkills,
    adaptableNote,
    ionisNote,
    extraResources,
    constraints,
    recommendation: buildRecommendation(scoreGlobal, scoreCatalogue, missingSkills.length),
    caveats,
    engine: "deterministe",
  };
}

function normalize(weights: ScoringWeights): ScoringWeights {
  const total = weights.catalogue + weights.voisines + weights.ionis;
  if (total <= 0) return { catalogue: 60, voisines: 25, ionis: 15 };
  return {
    catalogue: (weights.catalogue / total) * 100,
    voisines: (weights.voisines / total) * 100,
    ionis: (weights.ionis / total) * 100,
  };
}

function buildRationale(
  training: Training,
  score: number,
  signals: string[],
  covered: string[],
): string {
  if (score < 20) return "Correspondance faible : peu de recoupement avec la demande.";
  const parts: string[] = [];
  if (signals.length) parts.push(`thèmes communs : ${signals.slice(0, 4).join(", ")}`);
  if (covered.length) parts.push(`compétences couvertes : ${covered.slice(0, 3).join(", ")}`);
  if (training.duration) parts.push(`durée catalogue : ${training.duration}`);
  return parts.length ? parts.join(" — ") : "Correspondance lexicale avec le programme de la fiche.";
}

function buildRecommendation(global: number, catalogue: number, missing: number): string {
  if (global >= 75 && catalogue >= 70) {
    return "Forte adéquation pédagogique, sous réserve de vérification des moyens, des références et des exigences administratives.";
  }
  if (global >= 60) {
    return missing > 3
      ? "Adéquation réelle mais partielle : plusieurs compétences demandées ne sont pas couvertes par le catalogue. Chiffrer l'effort d'ingénierie avant le Go."
      : "Adéquation satisfaisante : poursuivre l'analyse du DCE et vérifier les moyens humains mobilisables.";
    }
  if (global >= 40) {
    return "Adéquation moyenne : réponse envisageable en conception sur mesure ou en coopération, après arbitrage sur la charge et la rentabilité.";
  }
  return "Adéquation faible au regard du référentiel actuel : vérifier qu'aucun lot pertinent n'a été manqué avant d'écarter la consultation.";
}
