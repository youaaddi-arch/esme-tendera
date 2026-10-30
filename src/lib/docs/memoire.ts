import type { Training } from "@prisma/client";

/**
 * Construction du plan et du premier jet du mémoire technique.
 *
 * Deux règles gouvernent ce module.
 *
 * 1. **Le cadre imposé prime.** Si l'acheteur fournit un cadre de mémoire, le
 *    plan en reprend les rubriques, dans leur ordre — répondre hors cadre est
 *    une cause classique d'irrégularité. Sinon, le plan est construit à partir
 *    des critères d'attribution : une rubrique par critère noté, ce qui aligne
 *    la réponse sur la grille de notation.
 *
 * 2. **Rien n'est inventé.** Le premier jet n'écrit que ce qui est déduit du
 *    DCE et du référentiel pédagogique. Partout où il faudrait une référence
 *    client, un CV de formateur, un chiffre institutionnel ou un engagement,
 *    il laisse un marqueur « à compléter » plutôt qu'un contenu plausible.
 */

export type MemoireSection = {
  id: string;
  heading: string;
  /** Contenu rédigé : paragraphes et listes. */
  body: string;
  /** D'où vient la matière : "dce", "referentiel", "plan", "cadre_impose". */
  origin: "dce" | "referentiel" | "plan" | "cadre_impose";
  /** Pondération du critère correspondant, quand la section en couvre un. */
  weight: number | null;
  /** Ce qui manque pour que la section soit complète. */
  todo: string[];
};

export type MemoireInput = {
  tenderTitle: string;
  buyer: string;
  objet: string | null;
  besoin: string | null;
  publics: string[];
  stagiaires: string | null;
  sessions: string | null;
  volumeHoraire: string | null;
  modalites: string[];
  lieux: string[];
  certifications: string[];
  criteres: { label: string; weight: number | null }[];
  /** Rubriques du cadre imposé par l'acheteur, si une pièce en fournit un. */
  imposedOutline: string[] | null;
  /** Meilleures correspondances du matching. */
  trainings: Pick<Training, "code" | "title" | "objective" | "objectives" | "duration" | "modality" | "audience" | "origin">[];
  institution: string;
};

/** Plan de référence, utilisé quand l'acheteur n'impose pas de cadre. */
const DEFAULT_OUTLINE: { heading: string; match: RegExp }[] = [
  { heading: "Présentation de l'ESME Executive Education", match: /pr[ée]sentation|candidat|soci[ée]t[ée]|organisme/i },
  { heading: "Compréhension du besoin", match: /compr[ée]hension|contexte|analyse\s+du\s+besoin/i },
  { heading: "Objectifs pédagogiques", match: /objectifs?/i },
  { heading: "Ingénierie de formation", match: /ing[ée]nierie|conception|programme/i },
  { heading: "Organisation pédagogique", match: /organisation|planning|calendrier|logistique/i },
  { heading: "Modalités d'animation", match: /animation|m[ée]thode|p[ée]dagogi/i },
  { heading: "Moyens humains", match: /moyens?\s+humains?|formateurs?|intervenants?|[ée]quipe/i },
  { heading: "Moyens matériels", match: /moyens?\s+mat[ée]riels?|supports?|plateforme|outils?/i },
  { heading: "Modalités d'évaluation", match: /[ée]valuation|acquis|satisfaction/i },
  { heading: "Suivi administratif", match: /administratif|convention|[ée]margement|facturation/i },
  { heading: "Assurance qualité", match: /qualit[ée]|qualiopi|am[ée]lioration/i },
  { heading: "Accessibilité", match: /accessibilit[ée]|handicap|psh/i },
  { heading: "Responsabilité sociétale (RSE)", match: /rse|durable|environnement|social/i },
  { heading: "Continuité de service", match: /continuit[ée]|rempla[çc]|al[ée]a|secours/i },
  { heading: "Reporting", match: /reporting|bilan|tableau\s+de\s+bord|indicateur/i },
  { heading: "Références", match: /r[ée]f[ée]rences?|exp[ée]rience|similaires?/i },
  { heading: "Engagements contractuels", match: /engagements?|d[ée]lais?|p[ée]nalit[ée]/i },
];

export function buildMemoire(input: MemoireInput): {
  sections: MemoireSection[];
  gaps: string[];
  frameworkNote: string;
} {
  const gaps: string[] = [];

  // --- Choix du plan ------------------------------------------------------
  let outline: { heading: string; weight: number | null; origin: MemoireSection["origin"] }[];
  let frameworkNote: string;

  if (input.imposedOutline && input.imposedOutline.length >= 3) {
    outline = input.imposedOutline.map((heading) => ({ heading, weight: null, origin: "cadre_impose" as const }));
    frameworkNote =
      "Plan repris du cadre de mémoire imposé par l'acheteur. Les rubriques et leur ordre ne doivent pas être modifiés.";
  } else if (input.criteres.length > 0) {
    // Une rubrique par critère noté, complétée des rubriques de fond qui
    // manqueraient : un mémoire qui ne traite que les critères reste incomplet.
    const fromCriteria = input.criteres.map((critere) => ({
      heading: critere.label,
      weight: critere.weight,
      origin: "dce" as const,
    }));
    const covered = (heading: string) =>
      fromCriteria.some((item) => item.heading.toLowerCase().includes(heading.toLowerCase().slice(0, 12)));
    const complements = DEFAULT_OUTLINE.filter((item) => !covered(item.heading))
      .slice(0, 8)
      .map((item) => ({ heading: item.heading, weight: null, origin: "plan" as const }));
    outline = [...fromCriteria, ...complements];
    frameworkNote =
      "Aucun cadre de mémoire n'a été trouvé dans le DCE. Le plan suit les critères d'attribution relevés au règlement de consultation, complétés des rubriques de fond attendues.";
  } else {
    outline = DEFAULT_OUTLINE.map((item) => ({ heading: item.heading, weight: null, origin: "plan" as const }));
    frameworkNote =
      "Ni cadre imposé ni critères d'attribution n'ont été relevés : le plan est le plan de référence ESME. Vérifiez le règlement de consultation avant de rédiger.";
    gaps.push("Critères d'attribution non identifiés : saisissez-les dans l'onglet Analyse pour aligner le plan.");
  }

  // --- Rédaction section par section --------------------------------------
  const esme = input.trainings.filter((training) => training.origin === "CATALOGUE_ESME").slice(0, 6);

  const sections: MemoireSection[] = outline.map((item, index) => {
    const { body, todo } = writeSection(item.heading, input, esme);
    return {
      id: `s${index + 1}`,
      heading: item.heading,
      body,
      origin: item.origin,
      weight: item.weight,
      todo,
    };
  });

  for (const section of sections) {
    for (const todo of section.todo) {
      if (!gaps.includes(todo)) gaps.push(todo);
    }
  }

  if (esme.length === 0) {
    gaps.push(
      "Aucune formation du catalogue ne correspond suffisamment : le contenu pédagogique est à construire sur mesure.",
    );
  }

  return { sections, gaps, frameworkNote };
}

/**
 * Rédige une section.
 *
 * Le texte produit est une base de travail, pas une réponse finie : il pose la
 * structure, injecte ce que le DCE dit du besoin, cite les fiches du catalogue
 * réellement pertinentes, et marque explicitement ce qu'un rédacteur doit
 * compléter.
 */
function writeSection(
  heading: string,
  input: MemoireInput,
  esme: MemoireInput["trainings"],
): { body: string; todo: string[] } {
  const todo: string[] = [];
  const lines: string[] = [];
  const key = heading.toLowerCase();

  const matches = (pattern: RegExp) => pattern.test(key);

  if (matches(/pr[ée]sentation|candidat|organisme|soci[ée]t[ée]/)) {
    lines.push(
      `${input.institution} est la structure de formation continue de l'ESME, école d'ingénieurs du Groupe IONIS.`,
      "",
      "[À COMPLÉTER] Chiffres institutionnels à jour, numéro de déclaration d'activité, certification Qualiopi (numéro et date de validité), forme juridique et SIRET.",
    );
    todo.push("Présentation de l'ESME : chiffres institutionnels, NDA et certification Qualiopi à insérer depuis la base de connaissances.");
  } else if (matches(/compr[ée]hension|contexte|analyse\s+du\s+besoin/)) {
    lines.push(`**Le besoin exprimé par ${input.buyer}**`, "");
    if (input.objet) lines.push(`Objet du marché : ${input.objet}`, "");
    if (input.besoin) lines.push(input.besoin, "");
    const facts: string[] = [];
    if (input.publics.length) facts.push(`publics visés : ${input.publics.join(" ; ")}`);
    if (input.stagiaires) facts.push(`effectif : ${input.stagiaires}`);
    if (input.sessions) facts.push(`volumétrie : ${input.sessions}`);
    if (input.volumeHoraire) facts.push(`durée : ${input.volumeHoraire}`);
    if (input.modalites.length) facts.push(`modalités : ${input.modalites.join(", ")}`);
    if (input.lieux.length) facts.push(`lieux : ${input.lieux.join(", ")}`);
    if (facts.length) {
      lines.push("Éléments relevés au dossier de consultation :", ...facts.map((fact) => `- ${fact}`), "");
    }
    lines.push(
      "[À COMPLÉTER] Reformulation de l'enjeu propre à cet acheteur : ce que la formation doit changer concrètement dans son organisation.",
    );
    todo.push("Compréhension du besoin : reformuler l'enjeu métier propre à l'acheteur — c'est la section la plus notée.");
    if (!input.objet && !input.besoin) {
      todo.push("Aucun élément de besoin n'a été extrait du DCE : importez le CCTP et relancez l'analyse.");
    }
  } else if (matches(/objectifs?/)) {
    if (esme.length > 0) {
      lines.push("Objectifs pédagogiques proposés, repris des fiches du catalogue mobilisées :", "");
      for (const training of esme.slice(0, 3)) {
        lines.push(`**${training.code} — ${training.title}**`);
        for (const objective of training.objectives.slice(0, 4)) lines.push(`- ${objective}`);
        lines.push("");
      }
    }
    lines.push("[À COMPLÉTER] Alignement des objectifs sur les attendus exacts du CCTP, objectif par objectif.");
    todo.push("Objectifs pédagogiques : vérifier la correspondance point par point avec le CCTP.");
  } else if (matches(/ing[ée]nierie|conception|programme/)) {
    if (esme.length > 0) {
      lines.push("**Programmes mobilisés**", "");
      for (const training of esme.slice(0, 4)) {
        lines.push(
          `- ${training.code} — ${training.title} (${training.duration ?? "durée à préciser"}, ${training.modality ?? "modalité à préciser"})`,
        );
      }
      lines.push("", "**Adaptation au contexte de l'acheteur**", "");
    }
    lines.push(
      "[À COMPLÉTER] Démarche d'ingénierie : analyse du besoin, positionnement initial, construction des parcours, adaptation des contenus et séquencement.",
    );
    todo.push("Ingénierie de formation : décrire l'adaptation des programmes catalogue au contexte de l'acheteur.");
  } else if (matches(/organisation|planning|calendrier|logistique/)) {
    const bits: string[] = [];
    if (input.sessions) bits.push(`Volumétrie annoncée : ${input.sessions}.`);
    if (input.volumeHoraire) bits.push(`Durée unitaire : ${input.volumeHoraire}.`);
    if (input.lieux.length) bits.push(`Lieux : ${input.lieux.join(", ")}.`);
    if (bits.length) lines.push(...bits, "");
    lines.push("[À COMPLÉTER] Calendrier prévisionnel, règles de constitution des groupes, procédure de report et interlocuteur unique.");
    todo.push("Organisation pédagogique : produire un calendrier prévisionnel et nommer l'interlocuteur unique.");
  } else if (matches(/animation|m[ée]thode|p[ée]dagogi/)) {
    const methods = [...new Set(esme.flatMap(() => [] as string[]))];
    if (input.modalites.length) lines.push(`Modalités demandées au DCE : ${input.modalites.join(", ")}.`, "");
    if (methods.length) lines.push(...methods.map((method) => `- ${method}`), "");
    lines.push(
      "[À COMPLÉTER] Déroulé type d'une séquence, part de pratique, outils d'animation et modalités de suivi entre les sessions.",
    );
    todo.push("Modalités d'animation : décrire le déroulé type d'une séquence et la part de mise en pratique.");
  } else if (matches(/moyens?\s+humains?|formateurs?|intervenants?|[ée]quipe/)) {
    lines.push(
      "[À COMPLÉTER] Équipe pédagogique nominative, CV des formateurs pressentis, expérience du secteur de l'acheteur, règles de remplacement.",
      "",
      "Aucun formateur n'est proposé automatiquement : les CV doivent provenir de la base de connaissances et être à jour.",
    );
    todo.push("Moyens humains : joindre les CV réels des formateurs pressentis — aucun nom ne doit être inventé.");
  } else if (matches(/moyens?\s+mat[ée]riels?|supports?|plateforme|outils?/)) {
    lines.push("[À COMPLÉTER] Supports remis aux participants, plateforme utilisée pour le distanciel, matériel technique mobilisé.");
    todo.push("Moyens matériels : préciser les supports et la plateforme utilisée.");
  } else if (matches(/[ée]valuation|acquis|satisfaction/)) {
    lines.push(
      "Dispositif d'évaluation proposé :",
      "- positionnement initial avant l'entrée en formation ;",
      "- évaluation des acquis en fin de session ;",
      "- évaluation de la satisfaction à chaud ;",
      "- [À COMPLÉTER] évaluation à froid : échéance et support à préciser.",
      "",
    );
    todo.push("Évaluation : préciser les outils d'évaluation à froid et leur échéance.");
  } else if (matches(/administratif|convention|[ée]margement|facturation/)) {
    lines.push(
      "[À COMPLÉTER] Circuit administratif : convention, convocations, feuilles d'émargement, attestations de fin de formation, facturation et interlocuteur de gestion.",
    );
    todo.push("Suivi administratif : décrire le circuit documentaire et l'interlocuteur de gestion.");
  } else if (matches(/qualit[ée]|qualiopi|am[ée]lioration/)) {
    if (input.certifications.length) {
      lines.push(`Certifications exigées au DCE : ${input.certifications.join(", ")}.`, "");
    }
    lines.push(
      "[À COMPLÉTER] Certification Qualiopi (numéro, périmètre, validité), processus de traitement des réclamations et démarche d'amélioration continue.",
    );
    todo.push("Assurance qualité : insérer le certificat Qualiopi réel et son périmètre.");
  } else if (matches(/accessibilit[ée]|handicap|psh/)) {
    lines.push(
      "[À COMPLÉTER] Référent handicap (nom et contact), modalités de compensation, accessibilité des locaux et des supports.",
    );
    todo.push("Accessibilité : nommer le référent handicap et décrire les compensations possibles.");
  } else if (matches(/rse|durable|environnement|social/)) {
    lines.push("[À COMPLÉTER] Engagements RSE applicables à cette prestation : déplacements, supports dématérialisés, inclusion.");
    todo.push("RSE : rattacher les engagements à la prestation, sans déclaration générique.");
  } else if (matches(/continuit[ée]|rempla[çc]|al[ée]a|secours/)) {
    lines.push("[À COMPLÉTER] Dispositif de remplacement d'un formateur, délai de reprise et solution de repli en distanciel.");
    todo.push("Continuité de service : préciser le délai de remplacement d'un formateur.");
  } else if (matches(/reporting|bilan|tableau\s+de\s+bord|indicateur/)) {
    lines.push(
      "[À COMPLÉTER] Indicateurs suivis, périodicité du reporting, format de restitution et bilan de fin de marché.",
    );
    todo.push("Reporting : définir les indicateurs et la périodicité attendus par l'acheteur.");
  } else if (matches(/r[ée]f[ée]rences?|exp[ée]rience|similaires?/)) {
    lines.push(
      "[À COMPLÉTER] Références de prestations comparables : client, objet, volumétrie, période, contact.",
      "",
      "Aucune référence n'est générée automatiquement. Elles doivent provenir de la base de connaissances et être vérifiables.",
    );
    todo.push("Références : sélectionner des références réelles et vérifiables — jamais de référence inventée.");
  } else if (matches(/engagements?|d[ée]lais?|p[ée]nalit[ée]/)) {
    lines.push("[À COMPLÉTER] Engagements de délai, de disponibilité et de qualité, cohérents avec le CCAP.");
    todo.push("Engagements contractuels : vérifier la cohérence avec les pénalités du CCAP.");
  } else {
    // Rubrique issue d'un cadre imposé ou d'un critère non reconnu.
    lines.push(
      `[À COMPLÉTER] Rubrique « ${heading} » : attendu à préciser d'après le cadre de réponse et le règlement de consultation.`,
    );
    todo.push(`Rubrique « ${heading} » : à rédiger, aucun contenu n'a pu être déduit du dossier.`);
  }

  return { body: lines.join("\n").trim(), todo };
}

/**
 * Repère les rubriques d'un cadre de mémoire imposé.
 *
 * Les cadres imposés sont presque toujours numérotés. On ne retient donc que
 * les lignes qui ressemblent à un titre de rubrique, et on s'arrête si le
 * résultat n'a pas la forme d'un plan — mieux vaut pas de cadre détecté qu'un
 * faux cadre imposé au rédacteur.
 */
export function extractImposedOutline(text: string): string[] | null {
  const lines = text.split(/\n|(?<=\.)\s{2,}/).map((line) => line.replace(/\s+/g, " ").trim());
  const headings: string[] = [];

  for (const line of lines) {
    if (line.length < 6 || line.length > 120) continue;
    const numbered = /^(?:\d{1,2}(?:[.)]\d{1,2})*[.)]?|[IVX]{1,5}[.)]|[A-H][.)])\s+(.{4,110})$/.exec(line);
    if (!numbered) continue;
    const heading = numbered[1].replace(/[.…:\s]+$/, "").trim();
    // Une phrase complète n'est pas un titre de rubrique.
    if (/[.;]/.test(heading) && heading.length > 70) continue;
    if (headings.some((existing) => existing.toLowerCase() === heading.toLowerCase())) continue;
    headings.push(heading);
  }

  return headings.length >= 3 && headings.length <= 30 ? headings : null;
}
