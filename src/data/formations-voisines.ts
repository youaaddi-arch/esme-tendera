/**
 * Priorité 2 — formations voisines.
 *
 * Ces fiches ne figurent pas au catalogue ESME Executive Education 2027. Elles
 * décrivent des domaines proches, régulièrement demandés par les acheteurs
 * publics, pour lesquels une adaptation pédagogique ou une conception sur
 * mesure est envisageable à partir des compétences existantes.
 *
 * Avertissement repris dans l'interface : une compétence voisine n'est pas une
 * capacité de réalisation confirmée. Elle sert à ne pas manquer une
 * consultation pertinente, pas à engager l'établissement. Toute réponse
 * appuyée sur une fiche de cette liste suppose une validation par l'ingénierie
 * pédagogique.
 */

export type VoisineSeed = {
  code: string;
  slug: string;
  title: string;
  /** Domaine du catalogue ESME auquel la fiche se rattache. */
  domainSlug: "energies-services" | "industrie" | "numerique" | "management-transformation";
  theme: string;
  objective: string;
  audience: string;
  /** Compétences que l'ESME pourrait mobiliser ou adapter. */
  skills: string[];
  relatedSkills: string[];
  keywords: string[];
  /** Fiches du catalogue servant de point d'appui pour l'adaptation. */
  anchors: string[];
  cpvCodes: string[];
};

export const formationsVoisines: VoisineSeed[] = [
  {
    code: "VOIS-FDF",
    slug: "voisine-formation-de-formateurs",
    title: "Formation de formateurs et ingénierie pédagogique",
    domainSlug: "management-transformation",
    theme: "Ingénierie de formation",
    objective:
      "Concevoir, animer et évaluer une action de formation, et outiller les formateurs internes d'une organisation.",
    audience: "Formateurs occasionnels, tuteurs, experts métiers amenés à transmettre, responsables formation",
    skills: [
      "Concevoir un scénario pédagogique à partir d'objectifs opérationnels",
      "Animer un groupe en présentiel et en classe virtuelle",
      "Construire des modalités d'évaluation des acquis",
      "Accompagner la montée en compétences de formateurs internes",
    ],
    relatedSkills: [
      "Ingénierie de formation", "Scénarisation pédagogique", "Évaluation des acquis",
      "Tutorat et accompagnement", "Animation de groupe", "Qualiopi et traçabilité pédagogique",
    ],
    keywords: [
      "formation de formateurs", "pédagogie", "ingénierie pédagogique", "tutorat",
      "animation", "évaluation", "scénarisation", "qualiopi", "andragogie",
    ],
    anchors: ["SOFT 100", "LEAD 200", "IA 400"],
    cpvCodes: ["80500000", "80510000", "80521000"],
  },
  {
    code: "VOIS-MGT-OP",
    slug: "voisine-management-operationnel",
    title: "Management opérationnel et management de proximité",
    domainSlug: "management-transformation",
    theme: "Management",
    objective:
      "Outiller les encadrants de proximité sur l'animation d'équipe, la délégation, le suivi de l'activité et la gestion des situations difficiles.",
    audience: "Managers de proximité, chefs d'équipe, encadrants intermédiaires, agents en prise de fonction",
    skills: [
      "Animer une équipe au quotidien et conduire des entretiens de suivi",
      "Fixer des objectifs et déléguer",
      "Gérer les situations relationnelles difficiles",
      "Piloter l'activité d'un service à l'aide d'indicateurs",
    ],
    relatedSkills: [
      "Animation d'équipe", "Délégation", "Entretien professionnel", "Gestion des conflits",
      "Management hybride", "Prise de fonction managériale",
    ],
    keywords: [
      "management opérationnel", "management de proximité", "encadrement", "équipe",
      "délégation", "entretien", "conflit", "prise de fonction", "manager",
    ],
    anchors: ["LEAD 100", "LEAD 200", "LEAD 300"],
    cpvCodes: ["80500000", "80532000"],
  },
  {
    code: "VOIS-BUR",
    slug: "voisine-bureautique-outils-collaboratifs",
    title: "Bureautique et outils collaboratifs",
    domainSlug: "numerique",
    theme: "Compétences numériques",
    objective:
      "Développer l'usage professionnel des suites bureautiques et des outils de travail collaboratif, jusqu'à l'automatisation simple.",
    audience: "Agents et collaborateurs de tous services, assistants, gestionnaires",
    skills: [
      "Exploiter un tableur pour analyser et restituer des données",
      "Structurer des documents professionnels",
      "Travailler à plusieurs sur un espace collaboratif",
      "Automatiser des tâches répétitives simples",
    ],
    relatedSkills: [
      "Tableur avancé", "Traitement de texte", "Présentation", "Messagerie et agenda",
      "Espaces collaboratifs", "Gestion documentaire",
    ],
    keywords: [
      "bureautique", "excel", "word", "powerpoint", "outlook", "teams", "sharepoint",
      "collaboratif", "tableur", "automatisation",
    ],
    anchors: ["IA 200", "IA 410"],
    cpvCodes: ["80500000", "80533100"],
  },
  {
    code: "VOIS-IA-METIERS",
    slug: "voisine-ia-appliquee-aux-metiers",
    title: "Intelligence artificielle appliquée aux métiers",
    domainSlug: "numerique",
    theme: "Intelligence artificielle",
    objective:
      "Faire passer les équipes d'une découverte de l'IA générative à des usages encadrés dans leur métier.",
    audience: "Agents et collaborateurs de tous métiers, encadrants, référents numériques",
    skills: [
      "Identifier les cas d'usage de l'IA générative dans son métier",
      "Rédiger des instructions efficaces et en évaluer les résultats",
      "Repérer les limites, biais et risques juridiques d'un usage professionnel",
      "Encadrer l'usage de l'IA par une charte interne",
    ],
    relatedSkills: [
      "IA générative", "Qualité et vérification des productions", "Protection des données",
      "Acculturation numérique", "Cas d'usage métier",
    ],
    keywords: [
      "intelligence artificielle", "ia générative", "cas d'usage", "acculturation",
      "prompt", "assistant", "copilot", "charte", "usage professionnel",
    ],
    anchors: ["IA 100", "IA 200", "IA 300", "IA 400"],
    cpvCodes: ["80500000", "80533100"],
  },
  {
    code: "VOIS-PROJ",
    slug: "voisine-gestion-de-projet",
    title: "Gestion de projet — fondamentaux et méthodes agiles",
    domainSlug: "management-transformation",
    theme: "Gestion de projet",
    objective:
      "Donner un socle commun de conduite de projet, des méthodes classiques aux approches agiles.",
    audience: "Chefs de projet, contributeurs projet, responsables de service",
    skills: [
      "Cadrer un projet et formaliser ses livrables",
      "Construire et tenir un planning",
      "Identifier et traiter les risques",
      "Animer une équipe projet en mode agile",
    ],
    relatedSkills: [
      "Cadrage", "Planification", "Gestion des risques", "Méthodes agiles",
      "Pilotage budgétaire", "Reporting projet",
    ],
    keywords: [
      "gestion de projet", "chef de projet", "planning", "agile", "scrum", "risque",
      "cadrage", "jalon", "pilotage", "livrable",
    ],
    anchors: ["PROJ 100", "PROJ 210", "PROJ 220", "PROJ 230"],
    cpvCodes: ["80500000", "79421000"],
  },
  {
    code: "VOIS-TRANSFO",
    slug: "voisine-transformation-des-organisations",
    title: "Transformation des organisations et accompagnement au changement",
    domainSlug: "management-transformation",
    theme: "Conduite du changement",
    objective:
      "Outiller les équipes chargées de conduire une réorganisation, une modernisation ou un déploiement d'outil.",
    audience: "Dirigeants, responsables de transformation, DRH, chefs de projet transverses",
    skills: [
      "Diagnostiquer les impacts humains d'une transformation",
      "Construire un plan d'accompagnement au changement",
      "Animer la concertation avec les équipes",
      "Mesurer l'appropriation dans la durée",
    ],
    relatedSkills: [
      "Conduite du changement", "Communication interne", "Gestion des résistances",
      "Plan de déploiement", "Pilotage de la transformation",
    ],
    keywords: [
      "transformation", "changement", "réorganisation", "modernisation", "accompagnement",
      "appropriation", "déploiement", "concertation",
    ],
    anchors: ["STRA 110", "STRA 300", "LEAD 300", "INTR 100"],
    cpvCodes: ["80500000", "79400000"],
  },
  {
    code: "VOIS-COM",
    slug: "voisine-communication-professionnelle",
    title: "Communication professionnelle et prise de parole",
    domainSlug: "management-transformation",
    theme: "Soft skills",
    objective:
      "Renforcer l'expression écrite et orale en situation professionnelle, de la réunion à la prise de parole publique.",
    audience: "Tous publics, encadrants, experts amenés à présenter leurs travaux",
    skills: [
      "Structurer un message selon son auditoire",
      "Prendre la parole en public avec aisance",
      "Conduire une réunion productive",
      "Rédiger des écrits professionnels clairs",
    ],
    relatedSkills: [
      "Prise de parole", "Écrits professionnels", "Animation de réunion",
      "Écoute active", "Argumentation", "Gestion du trac",
    ],
    keywords: [
      "communication", "prise de parole", "oral", "écrit", "réunion", "présentation",
      "argumentation", "posture",
    ],
    anchors: ["SOFT 100", "SOFT 110", "SOFT 300"],
    cpvCodes: ["80500000", "80570000"],
  },
  {
    code: "VOIS-RSE",
    slug: "voisine-rse-developpement-durable",
    title: "RSE, transition écologique et développement durable",
    domainSlug: "energies-services",
    theme: "RSE",
    objective:
      "Donner aux équipes les repères de la transition écologique et les méthodes pour la traduire en plan d'action.",
    audience: "Référents RSE, directions, acheteurs, responsables techniques",
    skills: [
      "Comprendre les ordres de grandeur du climat et de l'énergie",
      "Construire une démarche RSE et ses indicateurs",
      "Intégrer les critères environnementaux aux achats",
      "Mobiliser les équipes autour d'un plan de transition",
    ],
    relatedSkills: [
      "Bilan carbone", "Économie circulaire", "Achats responsables", "Reporting extra-financier",
      "Sobriété énergétique", "Sensibilisation climat",
    ],
    keywords: [
      "rse", "développement durable", "transition écologique", "carbone", "climat",
      "économie circulaire", "achats responsables", "csrd", "sobriété",
    ],
    anchors: ["ENRJ 200", "ENRJ 210", "ENR 100", "STRA 100"],
    cpvCodes: ["80500000", "90700000"],
  },
  {
    code: "VOIS-NUM",
    slug: "voisine-competences-numeriques",
    title: "Compétences numériques et inclusion numérique",
    domainSlug: "numerique",
    theme: "Compétences numériques",
    objective:
      "Élever le socle numérique des agents, de l'usage quotidien des outils à la culture de la donnée et de la sécurité.",
    audience: "Agents de tous niveaux, publics éloignés du numérique, référents numériques",
    skills: [
      "Utiliser les outils numériques du quotidien professionnel",
      "Adopter les réflexes de sécurité élémentaires",
      "Lire et exploiter des données simples",
      "Accompagner un public dans ses démarches numériques",
    ],
    relatedSkills: [
      "Culture numérique", "Hygiène informatique", "Démarches en ligne",
      "Médiation numérique", "Lecture de données",
    ],
    keywords: [
      "numérique", "inclusion numérique", "illectronisme", "culture numérique", "pix",
      "démarches en ligne", "médiation", "hygiène informatique",
    ],
    anchors: ["CYB 100", "IA 200", "DL 100"],
    cpvCodes: ["80500000", "80533100"],
  },
  {
    code: "VOIS-ACCOMP",
    slug: "voisine-accompagnement-au-changement-des-competences",
    title: "Accompagnement à la transformation des compétences",
    domainSlug: "management-transformation",
    theme: "Conduite du changement",
    objective:
      "Accompagner une organisation dans l'évolution des métiers et des compétences : cartographie, parcours, mobilité.",
    audience: "DRH, responsables formation, encadrants, référents GPEC",
    skills: [
      "Cartographier les compétences d'une organisation",
      "Construire des parcours de montée en compétences",
      "Accompagner les mobilités et reconversions internes",
      "Évaluer l'effet d'un plan de développement des compétences",
    ],
    relatedSkills: [
      "GPEC", "Référentiel de compétences", "Parcours de professionnalisation",
      "Entretien professionnel", "Mobilité interne",
    ],
    keywords: [
      "compétences", "gpec", "parcours", "mobilité", "reconversion", "référentiel",
      "plan de développement", "transformation des compétences", "montée en compétences",
    ],
    anchors: ["LEAD 300", "STRA 110", "SOFT 100"],
    cpvCodes: ["80500000", "79630000"],
  },
];
