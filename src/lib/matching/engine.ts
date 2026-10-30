import type { Training, TrainingOrigin } from "@prisma/client";

import { conceptLabel, detectConcepts, expandWithConcepts } from "./synonyms";
import { buildIdf, cosineWithSupport, coverage, termVector, tokenizeWithBigrams } from "./text";
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
  /** Nature du marché déclarée par l'acheteur : SERVICES, TRAVAUX, FOURNITURES. */
  marketTypes?: string[];
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
  /**
   * Qualification héritée de la consultation mère, lorsqu'on évalue un lot.
   *
   * « Porte-t-on sur de la formation ? » est une propriété du marché, pas de
   * chacun de ses lots : les lots d'un accord-cadre de formation s'intitulent
   * « Rédiger pour le web à l'aide de l'IA » ou « Optimiser son référencement »
   * — des titres de cours, où le mot « formation » n'apparaît jamais. Les
   * évaluer isolément les classait tous hors champ.
   */
  inheritedFormation?: boolean;
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

/**
 * Nature de la consultation, indépendamment des domaines du catalogue.
 *
 * ESME Executive Education intervient en formation continue professionnelle
 * généraliste, tous secteurs — un positionnement comparable à celui de Cegos,
 * M2i ou ORSYS — avec une appétence marquée pour les sujets d'ingénieur. Un
 * marché de formation est donc dans le périmètre par défaut.
 *
 * Le catalogue mesure l'affinité — la part du besoin déjà couverte par une
 * offre existante — et non une frontière. Un score faible dit « nous n'avons
 * pas encore de programme sur étagère », pas « ce n'est pas pour nous ». La
 * seule exclusion est l'apprentissage d'un métier manuel étranger au champ de
 * l'établissement.
 */
export type TenderNature =
  | "FORMATION_CATALOGUE"
  | "FORMATION_VOISINE"
  | "FORMATION_REALISABLE"
  | "FORMATION_METIER_MANUEL"
  | "HORS_CHAMP";

export type MatchingOutcome = {
  scoreCatalogue: number;
  scoreVoisines: number;
  scoreIonis: number;
  scoreGlobal: number;
  weights: ScoringWeights;
  /** La consultation porte-t-elle sur de la formation professionnelle ? */
  isFormation: boolean;
  /** Indices qui ont fait conclure qu'il s'agit (ou non) de formation. */
  formationSignals: string[];
  nature: TenderNature;
  /** Appréciation en clair, affichée sur l'affaire. */
  natureLabel: string;
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

/**
 * Répète un champ pour lui donner du poids.
 *
 * Le vecteur de termes ne connaît pas la notion de champ : tout le texte
 * compte pareil. Or une fiche décrit son sujet dans son titre, et le reste —
 * mots-clés, compétences connexes, programme détaillé — sert la couverture,
 * pas l'identification. Les laisser peser autant revient à noyer le sujet dans
 * son contexte : c'est ce qui faisait qu'une fiche d'électrotechnique, dont
 * les mots-clés mentionnent l'IA, concurrençait une fiche d'IA sur un marché
 * d'IA. Répéter le champ est la façon la plus simple de le pondérer sans
 * changer la structure du vecteur.
 */
function weighted(text: string | null | undefined, times: number): string {
  const value = (text ?? "").trim();
  if (!value) return "";
  return Array(times).fill(value).join(" ");
}

/** Profil textuel d'une fiche : ce à quoi la demande est comparée. */
function trainingProfile(training: Training): string {
  const programme = Array.isArray(training.programme)
    ? (training.programme as { heading?: string; items?: string[] }[])
        .map((block) => `${block.heading ?? ""} ${(block.items ?? []).join(" ")}`)
        .join(" ")
    : "";
  return [
    // Ce qui identifie la fiche.
    weighted(training.title, 3),
    weighted(training.theme, 2),
    weighted(training.subTheme, 2),
    weighted(training.objective, 2),
    weighted(training.skills.join(" "), 2),
    // Ce qui la contextualise.
    training.audience ?? "",
    training.objectives.join(" "),
    training.relatedSkills.join(" "),
    training.keywords.join(" "),
    training.highlights.join(" "),
    programme,
  ].join(" ");
}

function queryText(input: MatchingInput): string {
  return [
    // L'objet du marché tient dans son intitulé ; le reste le précise.
    weighted(input.title, 3),
    weighted(input.objectSummary, 2),
    weighted(input.analysis?.objet, 2),
    (input.lots ?? []).map((lot) => `${lot.title} ${lot.description ?? ""}`).join(" "),
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
 *
 * La pente reste à 3,2. Elle a été abaissée un temps pour contenir des scores
 * manifestement trop hauts, avant de constater que le problème n'était pas
 * l'échelle mais les similarités elles-mêmes : du vocabulaire administratif
 * surpondéré, et des étiquettes de concept absentes de l'IDF. Ces deux causes
 * traitées, aplatir l'échelle ne faisait plus qu'écraser aussi les vraies
 * correspondances — un marché de formation à l'IA retombait à 33/100 alors que
 * ses quatre meilleures fiches étaient les bonnes.
 */
function calibrate(raw: number): number {
  const scaled = 100 * (1 - Math.exp(-3.2 * raw));
  return Math.max(0, Math.min(97, scaled));
}

/**
 * Concepts trop répandus pour discriminer quoi que ce soit.
 *
 * Le recouvrement conceptuel rattrape les formulations d'acheteur éloignées du
 * vocabulaire du catalogue : c'est sa raison d'être. Mais un concept présent
 * sur presque toutes les fiches n'apporte aucune information — « formation »
 * est partagé par l'intégralité du référentiel et par la quasi-totalité des
 * avis retenus par la veille. Le compter comme un point commun revient à
 * donner une prime à tout le monde, et c'est exactement ce qui faisait
 * remonter des correspondances trop éloignées.
 *
 * On pondère donc chaque concept par sa rareté dans le référentiel, et on
 * ignore ceux qui dépassent ce seuil de fréquence.
 */
const CONCEPT_UBIQUITY_THRESHOLD = 0.6;

/**
 * Poids de chaque concept, d'après sa fréquence dans le référentiel.
 *
 * Un concept porté par deux fiches sur soixante-sept vaut beaucoup ; un
 * concept porté par soixante vaut presque rien.
 */
function conceptWeights(profileTokenLists: string[][]): Map<string, number> {
  const total = profileTokenLists.length;
  const frequency = new Map<string, number>();
  for (const tokens of profileTokenLists) {
    for (const concept of new Set(tokens.filter((token) => token.startsWith("@")))) {
      frequency.set(concept, (frequency.get(concept) ?? 0) + 1);
    }
  }

  const weights = new Map<string, number>();
  for (const [concept, count] of frequency) {
    const share = count / total;
    weights.set(concept, share > CONCEPT_UBIQUITY_THRESHOLD ? 0 : Math.log(total / count) / Math.log(total));
  }
  return weights;
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
      weights,
      isFormation: false,
      formationSignals: ["Référentiel vide : la nature de la consultation n'a pas été évaluée."],
      nature: "HORS_CHAMP",
      natureLabel: "Évaluation impossible : le référentiel pédagogique est vide.",
      matches: [], coveredSkills: [], missingSkills: [],
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
  const expandedProfiles = profiles.map((tokens) => expandWithConcepts(tokens));

  // L'IDF se calcule sur les profils ÉTENDUS, c'est-à-dire sur le même espace
  // que les vecteurs comparés.
  //
  // Calculé sur les profils bruts, il ignorait les étiquettes de concept
  // injectées par l'expansion : absentes de la table, elles retombaient sur le
  // poids par défaut. Comme deux fiches de formation quelconques partagent une
  // quinzaine de concepts, cela installait un plancher de similarité entre
  // n'importe quels textes — un marché sur les risques amiante ressortait à
  // 58/100 face à une fiche de stratégie IA. Les concepts doivent être pesés
  // comme les autres termes : par leur rareté réelle.
  const idf = buildIdf(expandedProfiles);
  const conceptWeight = conceptWeights(expandedProfiles);

  /**
   * Poids d'un concept. Un concept absent du référentiel vaut le maximum : il
   * est parfaitement discriminant, et surtout parfaitement non couvert.
   */
  const weightOf = (concept: string) => conceptWeight.get(concept) ?? 1;

  const queryTokens = expandWithConcepts(tokenizeWithBigrams(query));
  const queryVector = termVector(queryTokens);
  const queryConcepts = new Set(detectConcepts(query));
  const queryTokenSet = new Set(queryTokens);

  const scored: TrainingScore[] = active.map((training, index) => {
    const profileTokens = expandedProfiles[index];
    const profileVector = termVector(profileTokens);
    const profileConcepts = new Set(profileTokens.filter((token) => token.startsWith("@")));

    const { score: lexical, support } = cosineWithSupport(queryVector, profileVector, idf);

    // Recouvrement conceptuel : c'est lui qui rattrape les formulations
    // d'acheteur éloignées du vocabulaire du catalogue. Pondéré par la rareté,
    // pour qu'un concept partagé par tout le référentiel ne vaille rien.
    const shared = [...profileConcepts].filter((concept) => queryConcepts.has(concept));
    const sharedWeight = shared.reduce((sum, concept) => sum + weightOf(concept), 0);
    const unionWeight = [...new Set([...profileConcepts, ...queryConcepts])].reduce(
      (sum, concept) => sum + weightOf(concept),
      0,
    );
    const conceptual = unionWeight === 0 ? 0 : sharedWeight / unionWeight;

    // Couverture des compétences explicitement listées sur la fiche.
    const skillTokens = training.skills.flatMap((skill) => tokenizeWithBigrams(skill));
    const skillCoverage = coverage(skillTokens, queryTokenSet);

    let raw = lexical * 0.5 + conceptual * 0.32 + skillCoverage * 0.18;

    // Ancrage lexical.
    //
    // Une correspondance portée par les seuls concepts, sans qu'un seul terme
    // du besoin ne se retrouve dans la fiche, est presque toujours un faux
    // positif : « formation des agents à la relation usager » et « management
    // d'équipe projet » partagent des concepts sans parler de la même chose.
    // On n'annule pas ces correspondances — le vocabulaire d'un acheteur peut
    // légitimement ne recouper aucun mot du catalogue — mais on les retient.
    const anchor = lexical >= 0.06 ? 1 : 0.55 + (lexical / 0.06) * 0.45;
    raw *= anchor;

    // Appui lexical : combien de termes portent réellement la similarité.
    //
    // Une proximité thématique s'appuie sur beaucoup de termes du domaine ;
    // une coïncidence repose sur deux ou trois mots passe-partout qui pèsent
    // lourd des deux côtés. Le support distingue les deux sans qu'il faille
    // énumérer les mots suspects, et il tient donc aussi pour les mots que
    // personne n'a pensé à lister.
    // Seuil calibré sur des avis réels, pas choisi : une correspondance
    // thématique vérifiée (marché de formation à l'IA face aux fiches IA du
    // catalogue) s'appuie sur un support de 5 à 6 ; une coïncidence lexicale
    // (« risques amiante » face à « stratégie IA ») reste entre 1 et 2,5. Le
    // plein crédit est donc accordé à partir de 4, et le plancher reste haut :
    // le support corrige à la marge, l'essentiel de l'écart vient déjà de la
    // similarité elle-même.
    const supportFactor = Math.min(1, support / 4);
    raw *= 0.6 + 0.4 * supportFactor;

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

    // Seuls les concepts discriminants sont montrés : afficher « formation »
    // comme point commun entre un marché de formation et une fiche de
    // formation n'apprend rien à personne, et donne une fausse impression de
    // justification.
    const signals = shared
      .filter((concept) => weightOf(concept) > 0)
      .sort((a, b) => weightOf(b) - weightOf(a))
      .map(conceptLabel)
      .slice(0, 8);
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

  // Nature de la consultation, évaluée indépendamment des domaines couverts :
  // un marché de formation hors catalogue reste un marché de formation.
  const assessed = assessFormation(input, queryConcepts);
  // Un lot hérite de la qualification de sa consultation : le mot
  // « formation » ne figure pas dans un intitulé de cours.
  const formation =
    input.inheritedFormation === true && !assessed.isFormation
      ? {
          isFormation: true,
          signals: [
            "Qualification héritée de la consultation : l'intitulé du lot ne porte pas lui-même le vocabulaire de la formation.",
            ...assessed.signals,
          ],
        }
      : assessed;
  const natureVerdict = classifyNature(
    formation.isFormation,
    { catalogue: scoreCatalogue, voisines: scoreVoisines, ionis: scoreIonis },
    `${input.title} ${input.objectSummary ?? ""}`,
  );

  // Lots relevant d'un métier manuel : signalés sans déclasser l'affaire.
  const manualLots = (input.lots ?? [])
    .filter((lot) => detectMetierManuel(`${lot.title} ${lot.description ?? ""}`))
    .map((lot) => `lot ${lot.number} — ${lot.title}`);
  if (manualLots.length > 0) {
    formation.signals.push(
      `Lot(s) relevant d'un métier manuel hors périmètre : ${manualLots.slice(0, 5).join(" ; ")}. Les autres lots restent traitables.`,
    );
  }

  caveats.push(
    "Les trois scores mesurent l'adéquation pédagogique et opérationnelle, pas la probabilité de remporter le marché.",
  );
  if (natureVerdict.nature === "FORMATION_REALISABLE") {
    caveats.push(
      "Un score faible ne vaut pas rejet : l'ESME intervient en formation continue généraliste, tous secteurs. Le score mesure l'affinité au catalogue, pas l'appartenance au périmètre.",
    );
  }

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
    isFormation: formation.isFormation,
    formationSignals: formation.signals,
    nature: natureVerdict.nature,
    natureLabel: natureVerdict.label,
    recommendation: buildRecommendation(
      natureVerdict.nature,
      scoreGlobal,
      scoreCatalogue,
      missingSkills.length,
    ),
    caveats,
    engine: "deterministe",
  };
}

/** Un lot, tel qu'il est soumis au matching. */
export type LotMatchingInput = {
  number: string;
  title: string;
  description?: string | null;
  cpvCodes?: string[];
};

/** Affinité d'un lot avec le référentiel. */
export type LotMatchingOutcome = {
  number: string;
  scoreCatalogue: number;
  scoreVoisines: number;
  scoreGlobal: number;
  nature: TenderNature;
  natureLabel: string;
  /** Fiches les plus proches, du plus au moins pertinent. */
  matchTitles: string[];
};

/**
 * Évalue un lot pour lui-même.
 *
 * Le score d'une affaire agrège tous ses lots : sur un accord-cadre de
 * formation à douze lots dont deux relèvent du catalogue, la note globale ne
 * décrit aucun des deux. Elle est trop basse pour signaler l'opportunité, trop
 * haute pour écarter le reste. Or c'est lot par lot que l'on se positionne.
 *
 * Le lot hérite du contexte de la consultation — codes CPV et nature du marché
 * déclarés par l'acheteur — pour que la qualification « formation » reste
 * correcte : l'intitulé d'un lot est souvent trop court pour la porter seul
 * (« Lot 3 : anglais professionnel »).
 *
 * Le moteur est réinstancié à chaque lot plutôt que partagé. C'est quelques
 * dizaines de millisecondes par lot, et cela garantit qu'un lot est noté
 * exactement comme le serait une affaire du même objet — une seule
 * implémentation du score, donc aucune dérive possible entre les deux.
 */
export function runLotMatching(
  lot: LotMatchingInput,
  context: {
    cpvCodes?: string[];
    marketTypes?: string[];
    buyer?: string | null;
    /** Verdict « formation » rendu sur la consultation mère. */
    isFormation?: boolean;
  },
  trainings: Training[],
  weights: ScoringWeights,
): LotMatchingOutcome {
  const outcome = runMatching(
    {
      title: lot.title,
      objectSummary: lot.description ?? null,
      buyer: context.buyer ?? null,
      // Les CPV du lot priment ; à défaut, ceux de la consultation.
      cpvCodes: lot.cpvCodes?.length ? lot.cpvCodes : (context.cpvCodes ?? []),
      marketTypes: context.marketTypes ?? [],
      inheritedFormation: context.isFormation,
    },
    trainings,
    weights,
  );

  return {
    number: lot.number,
    scoreCatalogue: outcome.scoreCatalogue,
    scoreVoisines: outcome.scoreVoisines,
    scoreGlobal: outcome.scoreGlobal,
    nature: outcome.nature,
    natureLabel: outcome.natureLabel,
    matchTitles: outcome.matches
      .filter((match) => match.score >= 30)
      .slice(0, 4)
      .map((match) => `${match.title} (${Math.round(match.score)}/100)`),
  };
}

/**
 * La consultation porte-t-elle sur de la formation professionnelle ?
 *
 * Question volontairement distincte de l'adéquation au catalogue. Trois
 * indices, du plus fiable au moins fiable :
 *
 *  1. un code CPV de la division 80 (« services d'enseignement et de
 *     formation »), que l'acheteur a choisi lui-même ;
 *  2. le vocabulaire explicite de la formation dans l'intitulé ou l'objet ;
 *  3. les concepts de formation ou d'accompagnement repérés par le
 *     dictionnaire métier, qui rattrapent « montée en compétences des agents ».
 *
 * Un seul indice suffit : l'enjeu est de ne pas écarter un marché de formation,
 * pas de prouver qu'il en est un.
 */
export function assessFormation(
  input: MatchingInput,
  concepts: Set<string>,
): { isFormation: boolean; signals: string[] } {
  const signals: string[] = [];

  const cpvFormation = (input.cpvCodes ?? []).filter((code) => /^80/.test(code));
  if (cpvFormation.length > 0) {
    signals.push(`Code CPV de formation déclaré par l'acheteur : ${cpvFormation.join(", ")}.`);
  }

  // La nature déclarée du marché tranche les cas trompeurs : « travaux
  // d'extension de l'atelier du centre de formation » contient deux fois le
  // mot formation, et reste un marché de travaux. Un code CPV de formation
  // l'emporte toutefois : c'est le classement de l'acheteur lui-même.
  const declared = (input.marketTypes ?? []).map((type) => type.toUpperCase());
  const isServices = declared.some((type) => type.includes("SERVICE"));
  const isWorksOrSupply = declared.some(
    (type) => type.includes("TRAVAUX") || type.includes("FOURNITURE"),
  );
  if (isWorksOrSupply && !isServices && cpvFormation.length === 0) {
    signals.push(
      `Marché de ${declared.join(" et de ").toLowerCase()} d'après l'acheteur : ce n'est pas une prestation de formation, même si l'objet mentionne un centre de formation.`,
    );
    return { isFormation: false, signals };
  }

  const text = `${input.title} ${input.objectSummary ?? ""} ${(input.lots ?? [])
    .map((lot) => lot.title)
    .join(" ")}`;
  const explicit =
    /\bformation|\bformer\b|\bformateur|p[ée]dagogi|apprentissage|stage\s+de|s[ée]minaire|qualifiante|certifiante|mont[ée]e\s+en\s+comp[ée]tence/i.exec(
      text,
    );
  if (explicit) {
    signals.push(`Vocabulaire de la formation dans l'objet : « ${explicit[0]} ».`);
  }

  // Sans nature déclarée, un objet qui commence par un verbe d'achat ou de
  // travaux est écarté, sauf si le vocabulaire de la formation en est bien
  // l'objet et non le décor.
  if (declared.length === 0 && cpvFormation.length === 0) {
    const acquisition =
      /^\s*(march[ée]\s+(de\s+)?)?(travaux|extension|construction|r[ée]fection|r[ée]novation|am[ée]nagement|acquisition|fourniture|achat|livraison|location|entretien|maintenance)\b/i.exec(
        input.title,
      );
    const formationIsObject =
      /(march[ée]|accord-cadre|prestations?|actions?|programmes?|parcours|sessions?)\s+(de\s+|d['’])?formation|formation\s+(des?|du|de\s+la|aux?|en|à)\s/i.test(
        input.title,
      );
    if (acquisition && !formationIsObject) {
      signals.push(
        `L'objet porte sur « ${acquisition[0].trim()} » : la formation y est le contexte, pas la prestation attendue.`,
      );
      return { isFormation: false, signals };
    }
  }

  const conceptHits = ["@formation", "@formation_formateurs", "@accompagnement"].filter((concept) =>
    concepts.has(concept),
  );
  if (conceptHits.length > 0) {
    signals.push(`Concepts métier repérés : ${conceptHits.map(conceptLabel).join(", ")}.`);
  }

  if (signals.length === 0) {
    signals.push(
      "Ni code CPV de formation, ni vocabulaire de la formation dans l'objet : ce marché ne semble pas porter sur de la formation.",
    );
    return { isFormation: false, signals };
  }

  return { isFormation: true, signals };
}

/**
 * Métiers manuels étrangers au champ de l'ESME.
 *
 * C'est la seule exclusion de périmètre : l'établissement intervient sur
 * l'ensemble de la formation continue professionnelle, mais n'enseigne pas un
 * métier manuel comme l'esthétique, la coiffure, les métiers de bouche ou les
 * métiers du bâtiment.
 *
 * La liste vise l'apprentissage du geste métier, pas les sujets techniques
 * d'ingénierie : « habilitation électrique », « installation photovoltaïque »
 * ou « maintenance industrielle » relèvent bien du champ de l'ESME et ne
 * figurent pas ici.
 */
const METIERS_MANUELS = [
  /esth[ée]ti(que|cienne?)|onglerie|proth[èe]siste\s+ongulaire|manucure|maquillage|spa\b|massage|baln[ée]o/i,
  /coiffure|coiffeur|barbier|perruqui/i,
  /cuisin(e|ier)|p[âa]tisser|boulanger|boucher|charcuti|traiteur|sommelier|barman|restauration\s+collective|arts\s+de\s+la\s+table/i,
  /ma[çc]onnerie|plomberie|plombier|menuiser|charpent|couvreur|couverture\s+toiture|carrelage|plaquiste|peinture\s+en\s+b[âa]timent|pl[âa]trerie|[ée]tanch[ée]it[ée]\s+toiture|gros\s+œuvre/i,
  /soudure|soudeur|chaudronner|serrurier|forgeron|taille\s+de\s+pierre|[ée]b[ée]nist/i,
  /carrosserie|m[ée]canique\s+automobile|garagiste|pneumatique/i,
  /couture|coutur[ìi]er|tapissier|cordonnier|maroquiner/i,
  // « agricole » seul désignerait la Mutualité Sociale Agricole ou une chambre
  // d'agriculture : on vise le geste métier, pas le secteur d'activité.
  /fleuriste|horticult|mara[îi]chage|[ée]levage|viticult|p[ée]piniériste|bûcheron|sylvicult|machinisme\s+agricole|travaux\s+agricoles|exploitation\s+agricole/i,
  /toilettage|palefrenier|mar[ée]chal-ferrant/i,
  /aide\s+[àa]\s+domicile|auxiliaire\s+de\s+vie|garde\s+d.enfants|assistante?\s+maternelle/i,
];

function detectMetierManuel(text: string): string | null {
  for (const pattern of METIERS_MANUELS) {
    const found = pattern.exec(text);
    if (found) return found[0];
  }
  return null;
}

/**
 * Qualifie la consultation.
 *
 * Le catalogue affine le matching ; il ne délimite pas le périmètre. Un marché
 * de formation continue professionnelle est donc réalisable par défaut, même
 * hors catalogue. Seul l'apprentissage d'un métier manuel étranger au champ de
 * l'ESME sort du périmètre.
 */
/**
 * Seuils d'appréciation.
 *
 * Calibrés sur la distribution réelle des scores, pas choisis a priori. Sur un
 * échantillon de cent avis BOAMP portant le terme « formation », les scores
 * catalogue se répartissent ainsi : une masse de 41 avis entre 0 et 30 — des
 * marchés de formation sans rapport avec l'offre, sécurité incendie, secourisme
 * ou conduite — puis une queue de huit avis entre 30 et 40, et deux au-delà.
 * Le seuil est placé à l'entrée de cette queue : il retient cinq avis sur
 * soixante-et-onze, un format de liste courte exploitable. Au-delà de 40, il
 * n'en restait que deux, ce qui écartait des opportunités défendables.
 *
 * Ils ne sont pas transposables tels quels à un autre référentiel : un
 * catalogue plus large produirait des scores plus hauts. À revoir après toute
 * évolution substantielle du référentiel, en rejouant la même mesure.
 */
const SEUIL_CATALOGUE = 35;
const SEUIL_VOISINES = 28;

export function classifyNature(
  isFormation: boolean,
  scores: { catalogue: number; voisines: number; ionis: number },
  /**
   * Objet du marché seul — sans les intitulés de lots.
   *
   * Un accord-cadre de formation à douze lots dont un seul porte sur la
   * coiffure reste un marché de formation : ce lot-là est hors périmètre, pas
   * l'affaire entière. Les lots concernés sont signalés à part, et l'onglet
   * Lots permet d'en faire des affaires distinctes.
   */
  text = "",
): { nature: TenderNature; label: string } {
  if (!isFormation) {
    return {
      nature: "HORS_CHAMP",
      label:
        "Ce marché ne paraît pas porter sur de la formation. Vérifiez l'objet avant de l'écarter : il a été conservé, pas supprimé.",
    };
  }

  const metier = detectMetierManuel(text);
  if (metier) {
    return {
      nature: "FORMATION_METIER_MANUEL",
      label: `Formation à un métier manuel hors du champ de l'ESME (« ${metier} »). Hors périmètre, sauf décision contraire.`,
    };
  }

  if (scores.catalogue >= SEUIL_CATALOGUE) {
    return {
      nature: "FORMATION_CATALOGUE",
      label:
        "Formation continue professionnelle, directement couverte par le catalogue ESME. Forte affinité : des programmes existants répondent au besoin.",
    };
  }

  if (scores.voisines >= SEUIL_VOISINES || scores.ionis >= SEUIL_VOISINES) {
    return {
      nature: "FORMATION_VOISINE",
      label:
        "Formation continue professionnelle, proche du catalogue ou mobilisable au sein du Groupe IONIS. Une adaptation des programmes existants suffit probablement.",
    };
  }

  return {
    nature: "FORMATION_REALISABLE",
    label:
      "Formation continue professionnelle, dans le périmètre d'intervention de l'ESME. Aucun programme du catalogue ne couvre ce besoin : il est à concevoir. L'arbitrage porte sur les intervenants et la rentabilité, pas sur le périmètre.",
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

function buildRecommendation(
  nature: TenderNature,
  global: number,
  catalogue: number,
  missing: number,
): string {
  if (nature === "HORS_CHAMP") {
    return "Ce marché ne paraît pas porter sur de la formation. Vérifiez l'objet : s'il s'agit bien d'une prestation de formation, corrigez la fiche et relancez le matching.";
  }
  if (nature === "FORMATION_METIER_MANUEL") {
    return "Formation à un métier manuel étranger au champ de l'ESME. Hors périmètre, sauf décision contraire du responsable appels d'offres.";
  }
  if (nature === "FORMATION_REALISABLE") {
    return "Marché de formation continue professionnelle, dans le périmètre. Aucun programme du catalogue ne le couvre : il faut concevoir l'offre et identifier les intervenants. L'arbitrage porte sur la charge d'ingénierie et la rentabilité, pas sur le périmètre.";
  }
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
