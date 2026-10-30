import type { DocumentKind, RequirementLevel } from "@prisma/client";

import type { ExtractedPage } from "./extract";

/**
 * Analyse des pièces d'un dossier de consultation.
 *
 * Le moteur est déterministe : il repère dans le texte des pièces les
 * informations qu'un responsable appels d'offres cherche en premier, et
 * conserve pour chacune le document et la page d'où elle vient. Une
 * information qu'il ne trouve pas reste vide — il n'en invente aucune.
 *
 * Quand une clé d'API est configurée, le moteur IA enrichit cette base ; il ne
 * s'y substitue pas, et le champ `engine` dit toujours qui a produit quoi.
 */

export type SourceRef = { documentId: string; fileName: string; kind: DocumentKind; page: number };

export type Finding<T> = { value: T; source: SourceRef | null };

export type AnalyzedDocument = {
  id: string;
  fileName: string;
  kind: DocumentKind;
  pages: ExtractedPage[];
};

export type AnalysisOutcome = {
  engine: "deterministe";
  basedOnDocuments: boolean;
  documentCount: number;
  objet: string | null;
  besoin: string | null;
  publics: string[];
  stagiaires: string | null;
  sessions: string | null;
  volumeHoraire: string | null;
  modalites: string[];
  lieux: string[];
  moyensHumains: string | null;
  certifications: string[];
  exigencesAdmin: string[];
  criteres: { label: string; weight: number | null; source: SourceRef | null }[];
  contraintesFinancieres: string | null;
  delais: string | null;
  risques: string[];
  penalites: string[];
  obligations: string[];
  contradictions: { sujet: string; piecesConcernees: string[]; detail: string }[];
  pointsAClarifier: string[];
  incertitudes: string[];
  /** Citations à enregistrer : relient chaque information à sa source. */
  citations: { targetField: string; source: SourceRef; quote: string }[];
  requirements: ExtractedRequirement[];
};

export type ExtractedRequirement = {
  level: RequirementLevel;
  label: string;
  detail: string | null;
  category: string;
  weight: number | null;
  source: SourceRef | null;
  quote: string | null;
};

// ---------------------------------------------------------------------------
// Utilitaires de recherche dans le texte paginé
// ---------------------------------------------------------------------------

type Hit = { text: string; source: SourceRef; sentence: string };

/** Cherche un motif dans tous les documents et renvoie les occurrences avec leur page. */
function search(
  documents: AnalyzedDocument[],
  pattern: RegExp,
  limit = 6,
  /** Écarte une occurrence dont la phrase d'origine correspond à ce motif. */
  exclude?: RegExp,
): Hit[] {
  const hits: Hit[] = [];
  for (const document of documents) {
    for (const page of document.pages) {
      if (!page.text) continue;
      const matcher = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(page.text)) !== null) {
        const sentence = sentenceAround(page.text, match.index);
        if (!exclude || !exclude.test(sentence)) {
          hits.push({
            text: match[1] ?? match[0],
            source: { documentId: document.id, fileName: document.fileName, kind: document.kind, page: page.page },
            sentence,
          });
          if (hits.length >= limit) return hits;
        }
        if (match.index === matcher.lastIndex) matcher.lastIndex += 1;
      }
    }
  }
  return hits;
}

/** Première occurrence trouvée en essayant les motifs dans l'ordre donné. */
function searchOrdered(
  documents: AnalyzedDocument[],
  patterns: RegExp[],
  exclude?: RegExp,
): Hit | undefined {
  for (const pattern of patterns) {
    const [hit] = search(documents, pattern, 1, exclude);
    if (hit) return hit;
  }
  return undefined;
}

/** Phrase entourant une occurrence : sert de citation. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const end = text.indexOf(".", index);
  const slice = text.slice(start, end === -1 ? Math.min(text.length, index + 240) : end + 1);
  return slice.replace(/\s+/g, " ").trim().slice(0, 400);
}

/** Documents prioritaires pour une recherche donnée. */
function preferring(documents: AnalyzedDocument[], kinds: DocumentKind[]): AnalyzedDocument[] {
  const rank = (kind: DocumentKind) => {
    const index = kinds.indexOf(kind);
    return index === -1 ? kinds.length : index;
  };
  return [...documents].sort((a, b) => rank(a.kind) - rank(b.kind));
}

function uniqueStrings(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean.length < 3) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Analyse principale
// ---------------------------------------------------------------------------

export function analyzeDce(documents: AnalyzedDocument[]): AnalysisOutcome {
  const analysable = documents.filter((document) => document.pages.some((page) => page.text.length > 0));
  const citations: AnalysisOutcome["citations"] = [];
  const incertitudes: string[] = [];

  if (analysable.length === 0) {
    return {
      engine: "deterministe",
      basedOnDocuments: false,
      documentCount: 0,
      objet: null, besoin: null, publics: [], stagiaires: null, sessions: null,
      volumeHoraire: null, modalites: [], lieux: [], moyensHumains: null,
      certifications: [], exigencesAdmin: [], criteres: [], contraintesFinancieres: null,
      delais: null, risques: [], penalites: [], obligations: [], contradictions: [],
      pointsAClarifier: [],
      incertitudes: [
        "Aucune pièce exploitable : l'analyse n'a pas eu lieu. Importez le DCE pour obtenir une synthèse.",
      ],
      citations: [], requirements: [],
    };
  }

  const record = (field: string, hit: Hit | undefined) => {
    if (!hit) return null;
    citations.push({ targetField: field, source: hit.source, quote: hit.sentence });
    return hit;
  };

  // --- Objet du marché ---------------------------------------------------
  const objetHit = search(
    preferring(analysable, ["RC", "CCTP", "AVIS", "CCAP"]),
    /objet\s+(?:du\s+)?(?:march[ée]|(?:de\s+la\s+)?consultation|de\s+l['’]accord-cadre)\s*:?\s*([^.]{20,320})/i,
    1,
  )[0];
  record("objet", objetHit);

  // --- Besoin / contexte -------------------------------------------------
  const besoinHit = search(
    preferring(analysable, ["CCTP", "RC"]),
    /(?:contexte|besoin|pr[ée]sentation\s+du\s+besoin|expression\s+du\s+besoin)\s*:?\s*([^.]{40,500})/i,
    1,
  )[0];
  record("besoin", besoinHit);

  // --- Publics à former --------------------------------------------------
  const publicsHits = search(
    preferring(analysable, ["CCTP", "RC"]),
    /(?:public\s+(?:cibl[ée]|vis[ée]|concern[ée])|b[ée]n[ée]ficiaires?|stagiaires?\s+concern[ée]s?|personnels?\s+concern[ée]s?)\s*:?\s*([^.\n]{10,220})/i,
    5,
  );
  for (const hit of publicsHits) record("publics", hit);

  // --- Nombre de stagiaires ----------------------------------------------
  const stagiairesHit = search(
    analysable,
    /(\d[\d\s]{0,6}(?:agents?|stagiaires?|participants?|personnes?|collaborateurs?|apprenants?|b[ée]n[ée]ficiaires?))/i,
    4,
  )[0];
  record("stagiaires", stagiairesHit);

  // --- Sessions ----------------------------------------------------------
  const sessionsHit = search(
    analysable,
    /(\d[\d\s]{0,4}\s*(?:sessions?|groupes?|sessions?\s+de\s+formation))/i,
    3,
  )[0];
  record("sessions", sessionsHit);

  // --- Volume horaire ----------------------------------------------------
  // Une durée en jours apparaît aussi dans la validité des offres et les délais
  // de paiement : on exige un contexte de formation, et on écarte ces phrases.
  const volumeHit = searchOrdered(
    preferring(analysable, ["CCTP", "RC"]),
    [
      /(?:volume\s+horaire|dur[ée]e\s+(?:de\s+)?(?:la\s+)?(?:formation|prestation)|dur[ée]e\s+(?:de\s+)?(?:chaque\s+)?(?:session|module))\s*:?\s*([^.\n]{2,90})/i,
      /(\d[\d\s,.]{0,6}\s*(?:heures?|jours?|demi-journ[ée]es?)\s+de\s+formation)/i,
      /(?:repr[ée]sente|comprend|comporte|soit)\s+(\d[\d\s,.]{0,6}\s*(?:heures?|jours?|demi-journ[ée]es?))/i,
    ],
    /validit[ée]\s+des\s+offres|d[ée]lai\s+de\s+paiement|d[ée]lai\s+de\s+r[ée]ponse|date\s+limite/i,
  );
  record("volumeHoraire", volumeHit);

  // --- Modalités pédagogiques --------------------------------------------
  const modalitesHits = search(
    analysable,
    /(pr[ée]sentiel|distanciel|classe\s+virtuelle|e-?learning|FOAD|hybride|blended|en\s+intra|en\s+inter|AFEST)/i,
    14,
  );
  for (const hit of modalitesHits.slice(0, 4)) record("modalites", hit);

  // --- Lieux d'exécution -------------------------------------------------
  const lieuxHits = search(
    preferring(analysable, ["CCAP", "RC", "CCTP"]),
    /lieu(?:x)?\s+(?:d['’]ex[ée]cution|de\s+(?:la\s+)?formation|de\s+r[ée]alisation)\s*:?\s*([^.\n]{5,180})/i,
    4,
  );
  for (const hit of lieuxHits) record("lieux", hit);

  // --- Moyens humains demandés -------------------------------------------
  const moyensHit = search(
    preferring(analysable, ["CCTP", "RC"]),
    /(?:moyens\s+humains|[ée]quipe\s+(?:p[ée]dagogique|propos[ée]e)|profil\s+des?\s+formateurs?|qualification\s+des\s+intervenants)\s*:?\s*([^.]{20,400})/i,
    1,
  )[0];
  record("moyensHumains", moyensHit);

  // --- Certifications exigées --------------------------------------------
  const certifHits = search(
    analysable,
    /(Qualiopi|RNCP|RS\s?\d{3,5}|certification\s+[A-Za-zÀ-ÿ0-9 ]{3,40}|ISO\s?\d{4,5}|habilitation\s+[A-Za-zÀ-ÿ0-9 ]{3,30})/i,
    10,
  );
  for (const hit of certifHits.slice(0, 5)) record("certifications", hit);

  // --- Critères d'attribution et pondérations ----------------------------
  const criteres = extractCriteria(preferring(analysable, ["RC", "CCAP"]));
  for (const critere of criteres) {
    if (critere.source) {
      citations.push({ targetField: "criteres", source: critere.source, quote: critere.label });
    }
  }

  // --- Contraintes financières -------------------------------------------
  const financesHit = search(
    preferring(analysable, ["CCAP", "AE", "RC"]),
    /(?:prix\s+(?:ferme|r[ée]visable|actualisable)|montant\s+(?:maximum|minimum|estim[ée])|r[ée]vision\s+des\s+prix|variation\s+des\s+prix)\s*:?\s*([^.]{10,320})/i,
    1,
  )[0];
  record("contraintesFinancieres", financesHit);

  // --- Délais ------------------------------------------------------------
  const delaisHit = search(
    preferring(analysable, ["RC", "CCAP"]),
    /(?:d[ée]lai\s+(?:d['’]ex[ée]cution|de\s+r[ée]ponse|de\s+remise)|date\s+limite\s+de\s+(?:remise|r[ée]ception)\s+des\s+(?:offres|plis))\s*:?\s*([^.\n]{5,200})/i,
    1,
  )[0];
  record("delais", delaisHit);

  // --- Pénalités ---------------------------------------------------------
  const penalitesHits = search(
    preferring(analysable, ["CCAP"]),
    /(p[ée]nalit[ée]s?\s+(?:de\s+retard|pour\s+[^.]{5,90}|forfaitaires?)[^.]{0,200})/i,
    5,
  );
  for (const hit of penalitesHits) record("penalites", hit);

  // --- Obligations particulières -----------------------------------------
  const obligationsHits = search(
    preferring(analysable, ["CCAP", "CCTP"]),
    /((?:le\s+titulaire|le\s+prestataire)\s+(?:s['’]engage|devra|est\s+tenu)[^.]{10,260})/i,
    8,
  );
  for (const hit of obligationsHits.slice(0, 6)) record("obligations", hit);

  // --- Risques contractuels ----------------------------------------------
  const risquesHits = search(
    preferring(analysable, ["CCAP"]),
    /((?:r[ée]siliation|mise\s+en\s+demeure|exclusion|clause\s+de\s+sauvegarde|responsabilit[ée]\s+du\s+titulaire)[^.]{10,220})/i,
    6,
  );
  for (const hit of risquesHits.slice(0, 5)) record("risques", hit);

  // --- Exigences administratives -----------------------------------------
  const adminHits = search(
    preferring(analysable, ["RC"]),
    /((?:DC1|DC2|DC4|attestation\s+[^.]{3,60}|extrait\s+Kbis|assurance\s+responsabilit[ée]\s+civile|num[ée]ro\s+de\s+d[ée]claration\s+d['’]activit[ée])[^.]{0,140})/i,
    12,
  );
  for (const hit of adminHits.slice(0, 8)) record("exigencesAdmin", hit);

  // --- Exigences structurées ---------------------------------------------
  const requirements = extractRequirements(analysable, criteres);

  // --- Contradictions entre pièces ---------------------------------------
  const contradictions = detectContradictions(analysable);

  // --- Points à clarifier et incertitudes ---------------------------------
  const pointsAClarifier: string[] = [];
  if (!objetHit) pointsAClarifier.push("L'objet du marché n'a pas été identifié dans les pièces : vérifiez le RC.");
  if (criteres.length === 0) {
    pointsAClarifier.push("Aucun critère d'attribution n'a été repéré automatiquement : saisissez-les à la main.");
  }
  if (criteres.length > 0 && criteres.every((critere) => critere.weight === null)) {
    pointsAClarifier.push("Les critères d'attribution ont été repérés sans pondération : vérifiez le RC.");
  }
  for (const contradiction of contradictions) {
    pointsAClarifier.push(`À faire préciser par l'acheteur : ${contradiction.sujet}.`);
  }

  const missingKinds = (["RC", "CCTP"] as DocumentKind[]).filter(
    (kind) => !analysable.some((document) => document.kind === kind),
  );
  if (missingKinds.length > 0) {
    incertitudes.push(
      `Pièces absentes du dossier analysé : ${missingKinds.join(", ")}. La synthèse est partielle.`,
    );
  }
  const nonAnalysable = documents.length - analysable.length;
  if (nonAnalysable > 0) {
    incertitudes.push(
      `${nonAnalysable} pièce(s) n'ont pas pu être lues (format non pris en charge ou PDF scanné) et ne sont pas prises en compte.`,
    );
  }
  incertitudes.push(
    "Synthèse produite par repérage de motifs dans le texte des pièces. Elle ne remplace pas la lecture du dossier et n'a aucune valeur juridique.",
  );

  return {
    engine: "deterministe",
    basedOnDocuments: true,
    documentCount: analysable.length,
    objet: objetHit?.text.trim() ?? null,
    besoin: besoinHit?.text.trim() ?? null,
    publics: uniqueStrings(publicsHits.map((hit) => hit.text), 8),
    stagiaires: stagiairesHit?.text.trim() ?? null,
    sessions: sessionsHit?.text.trim() ?? null,
    volumeHoraire: volumeHit?.text.trim() ?? null,
    modalites: uniqueStrings(modalitesHits.map((hit) => hit.text), 6),
    lieux: uniqueStrings(lieuxHits.map((hit) => hit.text), 6),
    moyensHumains: moyensHit?.text.trim() ?? null,
    certifications: uniqueStrings(certifHits.map((hit) => hit.text), 6),
    exigencesAdmin: uniqueStrings(adminHits.map((hit) => hit.text), 10),
    criteres,
    contraintesFinancieres: financesHit?.text.trim() ?? null,
    delais: delaisHit?.text.trim() ?? null,
    risques: uniqueStrings(risquesHits.map((hit) => hit.text), 6),
    penalites: uniqueStrings(penalitesHits.map((hit) => hit.text), 6),
    obligations: uniqueStrings(obligationsHits.map((hit) => hit.text), 8),
    contradictions,
    pointsAClarifier: uniqueStrings(pointsAClarifier, 10),
    incertitudes,
    citations,
    requirements,
  };
}

// ---------------------------------------------------------------------------
// Critères d'attribution
// ---------------------------------------------------------------------------

/**
 * Les critères d'attribution se présentent presque toujours sous la forme
 * « Valeur technique : 60 % » ou « Prix des prestations 40 points ». On accepte
 * les deux, ainsi que l'ordre inverse (« 60 % — valeur technique »).
 */
function extractCriteria(documents: AnalyzedDocument[]): AnalysisOutcome["criteres"] {
  const found: AnalysisOutcome["criteres"] = [];
  const patterns = [
    /([A-ZÀ-Ÿ][^:\n%]{4,70})\s*[:–—-]?\s*(\d{1,3})\s*(?:%|points?|pts)/g,
    /(\d{1,3})\s*(?:%|points?|pts)\s*[:–—-]?\s*([A-ZÀ-Ÿ][^.\n]{4,70})/g,
  ];

  for (const document of documents) {
    for (const page of document.pages) {
      if (!/crit[èe]re/i.test(page.text)) continue;
      for (const [index, pattern] of patterns.entries()) {
        const matcher = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = matcher.exec(page.text)) !== null) {
          const label = (index === 0 ? match[1] : match[2]).replace(/\s+/g, " ").trim();
          const weight = Number.parseInt(index === 0 ? match[2] : match[1], 10);
          if (!label || label.length < 5 || weight < 1 || weight > 100) continue;
          // Évite de reprendre les intitulés de rubrique eux-mêmes.
          if (/^(crit[èe]res?|article|annexe|page|lot)\b/i.test(label)) continue;
          if (found.some((item) => item.label.toLowerCase() === label.toLowerCase())) continue;
          found.push({
            label,
            weight,
            source: { documentId: document.id, fileName: document.fileName, kind: document.kind, page: page.page },
          });
          if (found.length >= 8) return found;
        }
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Exigences : obligatoires, évaluées, recommandations
// ---------------------------------------------------------------------------

/**
 * Trois familles, distinguées par la force de la formulation :
 *
 *  - obligatoire   : « à peine d'irrégularité », « sous peine de rejet »,
 *                    « obligatoire », « le candidat doit » ;
 *  - évaluée       : tout ce qui relève des critères de notation ;
 *  - recommandation: « il est souhaitable », « le candidat pourra ».
 */
function extractRequirements(
  documents: AnalyzedDocument[],
  criteres: AnalysisOutcome["criteres"],
): ExtractedRequirement[] {
  const requirements: ExtractedRequirement[] = [];
  const seen = new Set<string>();

  const push = (requirement: ExtractedRequirement) => {
    const key = requirement.label.toLowerCase().slice(0, 90);
    if (seen.has(key)) return;
    seen.add(key);
    requirements.push(requirement);
  };

  // Les critères deviennent des exigences évaluées : ce sont elles qui sont notées.
  for (const critere of criteres) {
    push({
      level: "EVALUEE",
      label: critere.label,
      detail: critere.weight ? `Critère d'attribution, pondération ${critere.weight} %.` : "Critère d'attribution.",
      category: "technique",
      weight: critere.weight,
      source: critere.source,
      quote: null,
    });
  }

  const RULES: { level: RequirementLevel; category: string; pattern: RegExp }[] = [
    {
      level: "OBLIGATOIRE",
      category: "administratif",
      pattern: /([^.]{10,240}?(?:[àa]\s+peine\s+d['’]irr[ée]gularit[ée]|sous\s+peine\s+de\s+rejet|entra[îi]ne(?:ra)?\s+le\s+rejet|rendra?\s+l['’]offre\s+irr[ée]guli[èe]re)[^.]{0,120})/i,
    },
    {
      level: "OBLIGATOIRE",
      category: "administratif",
      pattern: /((?:est\s+obligatoire|sont\s+obligatoires|[àa]\s+fournir\s+obligatoirement|pi[èe]ces?\s+exig[ée]es?)[^.]{5,220})/i,
    },
    {
      level: "OBLIGATOIRE",
      category: "technique",
      pattern: /((?:le\s+candidat|le\s+titulaire|le\s+prestataire)\s+(?:doit|devra|est\s+tenu\s+de)[^.]{10,240})/i,
    },
    {
      level: "OBLIGATOIRE",
      category: "administratif",
      pattern: /((?:l['’]offre|la\s+candidature|le\s+pli)\s+(?:doit|devra)\s+(?:être|comporter|contenir)[^.]{10,220})/i,
    },
    {
      level: "RECOMMANDATION",
      category: "technique",
      pattern: /((?:il\s+est\s+(?:souhaitable|recommand[ée]|appr[ée]ci[ée])|le\s+candidat\s+(?:pourra|peut)|sera\s+appr[ée]ci[ée])[^.]{10,220})/i,
    },
  ];

  for (const rule of RULES) {
    for (const hit of search(documents, rule.pattern, 14)) {
      const label = hit.text.replace(/\s+/g, " ").trim();
      if (label.length < 15) continue;
      push({
        level: rule.level,
        label: label.length > 180 ? `${label.slice(0, 177)}…` : label,
        detail: label.length > 180 ? label : null,
        category: rule.category,
        weight: null,
        source: hit.source,
        quote: hit.sentence,
      });
    }
  }

  return requirements.slice(0, 60);
}

// ---------------------------------------------------------------------------
// Contradictions entre pièces
// ---------------------------------------------------------------------------

/**
 * Une contradiction entre pièces est un risque réel : si le RC annonce une
 * date limite et le CCAP une autre, l'une des deux fera foi, et il faut le
 * faire préciser avant de répondre. On compare les valeurs chiffrées les plus
 * structurantes quand elles apparaissent dans plusieurs pièces.
 */
function detectContradictions(documents: AnalyzedDocument[]): AnalysisOutcome["contradictions"] {
  const contradictions: AnalysisOutcome["contradictions"] = [];

  const subjects: { sujet: string; pattern: RegExp; normalize: (value: string) => string }[] = [
    {
      sujet: "la durée du marché",
      pattern: /dur[ée]e\s+(?:du\s+march[ée]|de\s+l['’]accord-cadre)[^.]{0,40}?(\d{1,2})\s*(ans?|mois)/i,
      normalize: (value) => value.toLowerCase().replace(/\s+/g, " "),
    },
    {
      sujet: "la durée de validité des offres",
      pattern: /validit[ée]\s+des\s+offres[^.]{0,40}?(\d{1,3})\s*(jours?|mois)/i,
      normalize: (value) => value.toLowerCase().replace(/\s+/g, " "),
    },
    {
      sujet: "le nombre de reconductions",
      pattern: /reconduct(?:ible|ion)[^.]{0,60}?(\d{1,2})\s*(?:fois|p[ée]riodes?|ans?)/i,
      normalize: (value) => value.toLowerCase(),
    },
  ];

  for (const subject of subjects) {
    const byValue = new Map<string, Set<string>>();
    for (const document of documents) {
      for (const page of document.pages) {
        const match = subject.pattern.exec(page.text);
        if (!match) continue;
        const value = subject.normalize(`${match[1]} ${match[2] ?? ""}`.trim());
        if (!byValue.has(value)) byValue.set(value, new Set());
        byValue.get(value)!.add(document.fileName);
      }
    }
    if (byValue.size > 1) {
      contradictions.push({
        sujet: subject.sujet,
        piecesConcernees: [...new Set([...byValue.values()].flatMap((set) => [...set]))],
        detail: `Valeurs divergentes relevées : ${[...byValue.keys()].join(" / ")}. Faites préciser laquelle fait foi avant de répondre.`,
      });
    }
  }

  return contradictions;
}
