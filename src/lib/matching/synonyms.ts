import { tokenize } from "./text";

/**
 * Vocabulaire des acheteurs publics ↔ vocabulaire du catalogue.
 *
 * Un acheteur écrit rarement « formation à la cybersécurité ». Il écrit
 * « accompagnement à la montée en compétences des agents sur la sécurité des
 * systèmes d'information ». Chaque entrée ci-dessous rattache les formulations
 * rencontrées dans les avis et les CCTP au concept du référentiel, de sorte
 * qu'une consultation soit reconnue même sans mot-clé littéral.
 *
 * Les clés sont des concepts internes ; les valeurs, les formulations
 * équivalentes. L'expansion est symétrique : repérer n'importe quelle valeur
 * ajoute le concept, et inversement.
 */
export const SYNONYM_GROUPS: Record<string, string[]> = {
  formation: [
    "formation", "formation continue", "formation professionnelle", "action de formation",
    "montée en compétences", "montee en competences", "développement des compétences",
    "developpement des competences", "professionnalisation", "perfectionnement",
    "qualification", "apprentissage", "transfert de compétences", "sensibilisation",
    "acculturation", "parcours de formation", "cursus", "stage", "session de formation",
    "ingénierie de formation", "ingénierie pédagogique", "plan de développement des compétences",
  ],
  accompagnement: [
    "accompagnement", "assistance", "appui", "conseil", "coaching", "mentorat",
    "accompagnement au changement", "conduite du changement", "transformation des compétences",
    "accompagnement des agents", "appui méthodologique",
  ],
  energie: [
    "énergie", "energie", "énergétique", "energetique", "transition énergétique",
    "sobriété énergétique", "décarbonation", "decarbonation", "performance énergétique",
    "efficacité énergétique", "maîtrise de l'énergie", "mix énergétique",
  ],
  photovoltaique: [
    "photovoltaïque", "photovoltaique", "solaire", "panneau solaire", "centrale solaire",
    "ombrière", "ombriere", "autoconsommation", "solarisation", "ferme solaire",
  ],
  renouvelable: [
    "énergies renouvelables", "enr", "renouvelable", "éolien", "eolien", "biomasse",
    "méthanisation", "methanisation", "hydroélectricité", "hydroelectricite", "biogaz",
    "cogénération", "cogeneration", "pompe à chaleur", "géothermie",
  ],
  reseau_electrique: [
    "réseau électrique", "reseau electrique", "distribution publique", "hta", "htb",
    "basse tension", "haute tension", "poste de transformation", "smart grid",
    "réseaux intelligents", "raccordement", "électrotechnique", "electrotechnique",
    "installation électrique", "habilitation électrique",
  ],
  stockage: ["stockage d'énergie", "batterie", "bess", "accumulateur", "stockage stationnaire"],
  batiment: [
    "bâtiment", "batiment", "immobilier", "patrimoine immobilier", "cvc",
    "génie climatique", "chauffage", "ventilation", "climatisation", "isolation",
    "rénovation énergétique", "décret tertiaire", "audit énergétique",
  ],
  datacenter: ["data center", "datacenter", "centre de données", "salle serveur", "tier", "pue"],
  industrie: [
    "industrie", "industriel", "production", "usine", "manufacturing", "industrie 4.0",
    "maintenance industrielle", "process industriel", "lean", "supply chain", "qhse",
    "performance industrielle", "gmao",
  ],
  fabrication_additive: [
    "fabrication additive", "impression 3d", "prototypage", "frittage", "fao", "cao",
  ],
  robotique: [
    "robotique", "robot", "cobot", "automatisation", "automatisme", "automaticien",
    "automate programmable", "api industriel", "supervision", "scada", "mécatronique",
  ],
  ia: [
    "intelligence artificielle", "ia", "ai", "machine learning", "apprentissage automatique",
    "deep learning", "réseau de neurones", "ia générative", "ia generative", "llm",
    "modèle de langage", "grand modèle de langage", "chatgpt", "copilot", "agent conversationnel",
    "science des données", "data science", "algorithme", "mlops", "vision par ordinateur",
    "traitement automatique du langage", "nlp",
  ],
  cybersecurite: [
    "cybersécurité", "cybersecurite", "cyber", "sécurité informatique", "sécurité numérique",
    "sécurité des systèmes d'information", "ssi", "rssi", "nis2", "iso 27001", "ebios",
    "anssi", "cyberdéfense", "pentest", "test d'intrusion", "cyber-résilience", "soc",
    "gestion des incidents", "rgpd", "protection des données",
  ],
  data: [
    "données", "donnees", "data", "base de données", "big data", "dataviz",
    "visualisation de données", "pilotage par la donnée", "gouvernance des données",
    "qualité des données", "entrepôt de données", "business intelligence", "décisionnel",
    "power bi", "tableau de bord", "indicateur", "kpi",
  ],
  numerique: [
    "numérique", "numerique", "digital", "transformation digitale", "transformation numérique",
    "dématérialisation", "dematerialisation", "système d'information", "informatique",
    "cloud", "devops", "développement logiciel", "culture numérique", "inclusion numérique",
    "compétences numériques", "illectronisme", "pix",
  ],
  bureautique: [
    "bureautique", "pack office", "microsoft 365", "excel", "word", "powerpoint", "outlook",
    "teams", "sharepoint", "outils collaboratifs", "travail collaboratif", "suite collaborative",
  ],
  management: [
    "management", "manager", "encadrement", "encadrant", "management d'équipe",
    "management opérationnel", "management de proximité", "animation d'équipe",
    "prise de fonction", "management hybride", "management à distance",
  ],
  leadership: [
    "leadership", "dirigeant", "codir", "comex", "posture managériale", "charisme",
    "influence", "prise de décision", "vision stratégique", "manager coach",
  ],
  gestion_projet: [
    "gestion de projet", "management de projet", "conduite de projet", "chef de projet",
    "pilotage de projet", "projet complexe", "agile", "scrum", "pmo", "planification",
    "gestion des risques projet", "méthode agile", "cycle en v", "jalons",
  ],
  strategie: [
    "stratégie", "strategie", "stratégique", "business model", "business plan",
    "plan stratégique", "diagnostic stratégique", "veille stratégique", "intelligence économique",
  ],
  innovation: [
    "innovation", "innover", "intrapreneuriat", "entrepreneuriat", "design thinking",
    "créativité", "idéation", "prototypage rapide", "incubation", "transformation de l'innovation",
  ],
  transformation: [
    "transformation", "transformation des organisations", "réorganisation", "modernisation",
    "conduite du changement", "accompagnement du changement", "change management",
    "transformation managériale", "nouvelles méthodes de travail",
  ],
  soft_skills: [
    "soft skills", "compétences comportementales", "compétences transversales",
    "savoir-être", "communication professionnelle", "prise de parole", "prise de parole en public",
    "communication orale", "écoute active", "intelligence émotionnelle", "gestion du stress",
    "gestion du temps", "gestion des conflits", "négociation", "cohésion d'équipe",
    "esprit critique", "assertivité", "coopération",
  ],
  formation_formateurs: [
    "formation de formateurs", "former des formateurs", "tutorat", "tuteur", "pédagogie",
    "animation de formation", "ingénierie pédagogique", "conception pédagogique",
    "scénarisation pédagogique", "évaluation des acquis", "aft", "formateur occasionnel",
  ],
  rse: [
    "rse", "responsabilité sociétale", "développement durable", "transition écologique",
    "fresque du climat", "bilan carbone", "empreinte carbone", "achats responsables",
    "économie circulaire", "biodiversité", "csrd", "éco-conception",
  ],
  achat_public: [
    "marché public", "commande publique", "achat public", "appel d'offres", "consultation",
    "code de la commande publique", "acheteur public", "procédure adaptée", "mapa",
    "accord-cadre", "dialogue compétitif",
  ],
  qualite_formation: [
    "qualiopi", "certification qualité", "rncp", "répertoire national", "cpf",
    "opco", "bilan pédagogique", "datadock", "organisme de formation", "nda",
    "numéro de déclaration d'activité",
  ],
  accessibilite: [
    "accessibilité", "handicap", "psh", "situation de handicap", "référent handicap",
    "compensation", "rgaa", "inclusion",
  ],
  distanciel: [
    "distanciel", "à distance", "e-learning", "elearning", "digital learning", "foad",
    "classe virtuelle", "visioconférence", "blended", "hybride", "mooc", "plateforme lms",
    "mixte", "présentiel", "presentiel",
  ],
  public_agents: [
    "agent", "agents publics", "fonctionnaire", "collectivité", "collectivite",
    "service public", "collaborateur", "salarié", "stagiaire", "apprenant", "participant",
    "cadre", "technicien", "ingénieur", "opérateur",
  ],
};

/** Index inversé : lexème → concepts auxquels il appartient. */
const TOKEN_TO_CONCEPTS = new Map<string, Set<string>>();
/** Concept → lexèmes caractéristiques, pour l'expansion descendante. */
const CONCEPT_TOKENS = new Map<string, string[]>();

for (const [concept, phrases] of Object.entries(SYNONYM_GROUPS)) {
  const conceptTag = `@${concept}`;
  const tokens = new Set<string>();
  for (const phrase of phrases) {
    const phraseTokens = tokenize(phrase);
    if (phraseTokens.length === 0) continue;

    // Un mot seul dans la liste déclenche le concept : c'est ce qu'il désigne.
    if (phraseTokens.length === 1) {
      tokens.add(phraseTokens[0]);
      continue;
    }

    // Une expression de plusieurs mots ne déclenche que par ses bigrammes.
    //
    // Indexer aussi ses mots pris isolément faisait de chacun un déclencheur à
    // lui seul, ce qui produisait des concepts omniprésents et faux : par
    // « organisme de formation », le mot « formation » déclenchait Qualiopi ;
    // par « marché public », le mot « public » déclenchait la commande
    // publique sur tout avis de marché ; par « outils collaboratifs », le mot
    // « outils » déclenchait la bureautique sur un marché d'outils d'IA.
    // Mesuré sur le référentiel, « Intelligence artificielle » ressortait
    // ainsi sur 60 % des fiches et « Gestion de projet » sur 75 % : des
    // concepts présents partout ne distinguent plus rien, et rapprochaient des
    // sujets sans rapport.
    for (let i = 0; i < phraseTokens.length - 1; i += 1) {
      tokens.add(`${phraseTokens[i]}_${phraseTokens[i + 1]}`);
    }
  }
  CONCEPT_TOKENS.set(conceptTag, [...tokens]);
  for (const token of tokens) {
    if (!TOKEN_TO_CONCEPTS.has(token)) TOKEN_TO_CONCEPTS.set(token, new Set());
    TOKEN_TO_CONCEPTS.get(token)!.add(conceptTag);
  }
}

/**
 * Ajoute aux lexèmes les concepts qu'ils déclenchent.
 *
 * Les concepts sont préfixés par « @ » pour ne jamais entrer en collision avec
 * un mot réel, et sont comparables entre un avis et une fiche : c'est par eux
 * que passe l'essentiel des correspondances non littérales.
 */
export function expandWithConcepts(tokens: string[]): string[] {
  const concepts = new Set<string>();
  for (const token of tokens) {
    const found = TOKEN_TO_CONCEPTS.get(token);
    if (found) for (const concept of found) concepts.add(concept);
  }
  return [...tokens, ...concepts];
}

/** Concepts détectés dans un texte libre. */
export function detectConcepts(text: string): string[] {
  const tokens = tokenize(text);
  const withBigrams = [...tokens];
  for (let i = 0; i < tokens.length - 1; i += 1) withBigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  const concepts = new Set<string>();
  for (const token of withBigrams) {
    const found = TOKEN_TO_CONCEPTS.get(token);
    if (found) for (const concept of found) concepts.add(concept);
  }
  return [...concepts];
}

/** Libellé lisible d'un concept, pour l'analyse explicative. */
export function conceptLabel(conceptTag: string): string {
  const key = conceptTag.replace(/^@/, "");
  const first = SYNONYM_GROUPS[key]?.[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : key.replace(/_/g, " ");
}

export function conceptTokens(conceptTag: string): string[] {
  return CONCEPT_TOKENS.get(conceptTag) ?? [];
}

export const ALL_CONCEPTS = [...CONCEPT_TOKENS.keys()];
