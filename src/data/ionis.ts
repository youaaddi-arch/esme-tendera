/**
 * Priorité 3 — cartographie des compétences du Groupe IONIS.
 *
 * Source : site officiel du groupe (https://www.ionis-group.com/, page
 * « Nos écoles & entités »). Le groupe compte 27 écoles et entités ; seules
 * celles dont les domaines recoupent les marchés de formation continue visés
 * par l'ESME sont reprises ici.
 *
 * Deux règles encadrent l'usage de cette cartographie :
 *
 *  1. Les compétences listées décrivent le champ d'enseignement de
 *     l'établissement d'après ses pages publiques. Elles ne constituent pas une
 *     offre de formation continue catalogue, ni un engagement de disponibilité.
 *  2. Aucun établissement ne peut engager juridiquement un autre. Toute
 *     réponse mobilisant une autre entité du groupe suppose un accord formel
 *     préalable (co-traitance, sous-traitance ou groupement).
 */

export type InstitutionSeed = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  domains: string[];
  skills: string[];
  programmes: string[];
  audiences: string[];
  modalities: string[];
  cooperation: string;
  sourceUrl: string;
  /** Fiches de compétences mobilisables, indexées par le moteur de matching. */
  capabilities: {
    code: string;
    title: string;
    /** Domaine du catalogue ESME auquel la compétence se rattache. */
    domainSlug: "energies-services" | "industrie" | "numerique" | "management-transformation";
    theme: string;
    objective: string;
    skills: string[];
    keywords: string[];
    cpvCodes: string[];
  }[];
};

const GROUP_URL = "https://www.ionis-group.com/le-groupe/ecoles-entites/";

export const ionisInstitutions: InstitutionSeed[] = [
  {
    slug: "epita",
    name: "EPITA — École d'ingénieurs en informatique",
    shortName: "EPITA",
    description:
      "École des ingénieurs en informatique et des talents du numérique. L'EPITA porte également une activité d'Executive Education en cybersécurité et numérique.",
    domains: ["Informatique", "Cybersécurité", "Données", "Systèmes d'information"],
    skills: [
      "Génie logiciel", "Cybersécurité", "Architecture des systèmes d'information",
      "Données et intelligence artificielle", "Cloud et infrastructures",
    ],
    programmes: [
      "Cycle ingénieur informatique",
      "Executive Education en cybersécurité et numérique",
    ],
    audiences: ["Ingénieurs", "Cadres techniques", "Dirigeants du numérique"],
    modalities: ["Présentiel", "Distanciel"],
    cooperation:
      "Coopération envisageable en co-traitance sur les lots cybersécurité et développement logiciel. À formaliser avant tout engagement.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-EPITA-CYB",
        title: "Cybersécurité et sécurité des systèmes d'information",
        domainSlug: "numerique",
        theme: "Cybersécurité",
        objective:
          "Mobiliser l'expertise cybersécurité de l'EPITA sur des lots de sensibilisation, de formation technique ou de mise en conformité.",
        skills: [
          "Sécurité des systèmes d'information",
          "Analyse de risques et conformité",
          "Sécurité offensive et défensive",
          "Gestion des incidents de sécurité",
        ],
        keywords: [
          "cybersécurité", "ssi", "sécurité informatique", "nis2", "iso 27001", "ebios",
          "soc", "test d'intrusion", "rssi", "cyberdéfense",
        ],
        cpvCodes: ["80500000", "80533100", "72000000"],
      },
      {
        code: "IONIS-EPITA-DEV",
        title: "Développement logiciel, cloud et systèmes d'information",
        domainSlug: "numerique",
        theme: "Numérique",
        objective:
          "Mobiliser l'expertise logicielle et infrastructure de l'EPITA sur des lots techniques du numérique.",
        skills: [
          "Développement logiciel", "Architecture applicative", "Cloud et conteneurisation",
          "Qualité et industrialisation logicielle",
        ],
        keywords: [
          "développement", "logiciel", "cloud", "devops", "architecture", "système d'information",
          "programmation", "api",
        ],
        cpvCodes: ["80500000", "72000000"],
      },
    ],
  },
  {
    slug: "ia-institut",
    name: "IA Institut by EPITA & ISG",
    shortName: "IA Institut",
    description:
      "Entité du groupe dédiée à l'intelligence artificielle et au data engineering, créée conjointement par l'EPITA et l'ISG.",
    domains: ["Intelligence artificielle", "Data engineering", "Science des données"],
    skills: [
      "Intelligence artificielle appliquée", "Data engineering", "MLOps",
      "Gouvernance et usages de la donnée",
    ],
    programmes: ["Programmes experts IA et Data Engineering"],
    audiences: ["Ingénieurs", "Data analysts", "Encadrants techniques"],
    modalities: ["Présentiel", "Distanciel"],
    cooperation:
      "Entité la plus proche des lots « IA » dépassant le périmètre du catalogue ESME. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-IA-DATA",
        title: "Intelligence artificielle et ingénierie de la donnée",
        domainSlug: "numerique",
        theme: "Intelligence artificielle",
        objective:
          "Couvrir les lots exigeant une expertise technique en IA, apprentissage automatique ou traitement de données à l'échelle.",
        skills: [
          "Apprentissage automatique", "Ingénierie des données", "Industrialisation des modèles",
          "Gouvernance des données",
        ],
        keywords: [
          "intelligence artificielle", "machine learning", "data engineering", "mlops",
          "data science", "modèle", "algorithme", "entrepôt de données", "big data",
        ],
        cpvCodes: ["80500000", "80533100", "72000000"],
      },
    ],
  },
  {
    slug: "isg",
    name: "ISG — International Business School",
    shortName: "ISG",
    description:
      "École de management créée en 1967, présente dans neuf villes. L'ISG associe compétences business et technologiques pour former dirigeants et managers.",
    domains: ["Management", "Stratégie", "Finance", "Marketing"],
    skills: [
      "Management d'équipe", "Stratégie d'entreprise", "Finance et contrôle de gestion",
      "Marketing et développement commercial", "Management international",
    ],
    programmes: ["Programmes grande école", "Programmes spécialisés"],
    audiences: ["Managers", "Dirigeants", "Fonctions support"],
    modalities: ["Présentiel"],
    cooperation:
      "Appui envisageable sur les lots management, stratégie et fonctions support. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-ISG-MGT",
        title: "Management, stratégie et performance d'entreprise",
        domainSlug: "management-transformation",
        theme: "Management",
        objective:
          "Compléter l'offre ESME sur les lots de management général, de stratégie et de pilotage de la performance.",
        skills: [
          "Management d'équipe et leadership", "Diagnostic et décision stratégique",
          "Pilotage de la performance", "Négociation et relation client",
        ],
        keywords: [
          "management", "stratégie", "leadership", "performance", "business model",
          "négociation", "pilotage", "dirigeant", "finance",
        ],
        cpvCodes: ["80500000", "80532000", "79400000"],
      },
    ],
  },
  {
    slug: "ipsa",
    name: "IPSA — École d'ingénieurs de l'air et de l'espace",
    shortName: "IPSA",
    description:
      "École d'ingénieurs en aéronautique et spatial, ouverte sur l'ensemble des secteurs de l'industrie.",
    domains: ["Aéronautique", "Spatial", "Systèmes embarqués", "Industrie"],
    skills: [
      "Systèmes embarqués", "Mécanique et structures", "Ingénierie système",
      "Industrie aéronautique et spatiale",
    ],
    programmes: ["Cycle ingénieur aéronautique et spatial"],
    audiences: ["Ingénieurs", "Techniciens supérieurs"],
    modalities: ["Présentiel"],
    cooperation:
      "Pertinent sur les lots industriels à forte composante systèmes ou aéronautique. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-IPSA-SYS",
        title: "Ingénierie système, embarqué et industrie aéronautique",
        domainSlug: "industrie",
        theme: "Industrie",
        objective:
          "Mobiliser une expertise systèmes et aéronautique sur des lots industriels hors périmètre ESME.",
        skills: [
          "Ingénierie système", "Systèmes embarqués", "Essais et qualification",
          "Industrie aéronautique",
        ],
        keywords: [
          "aéronautique", "spatial", "embarqué", "système", "mécanique", "industrie",
          "qualification", "essais", "drone",
        ],
        cpvCodes: ["80500000", "80510000"],
      },
    ],
  },
  {
    slug: "sup-biotech",
    name: "Sup'Biotech — École d'ingénieurs en biotechnologies",
    shortName: "Sup'Biotech",
    description: "École des ingénieurs en biotechnologies du Groupe IONIS.",
    domains: ["Biotechnologies", "Santé", "Bioproduction"],
    skills: ["Biotechnologies", "Bioproduction", "Qualité et réglementation santé"],
    programmes: ["Cycle ingénieur biotechnologies"],
    audiences: ["Ingénieurs", "Techniciens de laboratoire"],
    modalities: ["Présentiel"],
    cooperation:
      "Pertinent sur des lots santé ou bioproduction, hors périmètre ESME. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-SBT-BIO",
        title: "Biotechnologies, bioproduction et qualité en santé",
        domainSlug: "industrie",
        theme: "Santé et biotechnologies",
        objective:
          "Couvrir les consultations du champ santé / biotechnologies que le catalogue ESME ne traite pas.",
        skills: ["Procédés biotechnologiques", "Bioproduction", "Assurance qualité en santé"],
        keywords: [
          "biotechnologie", "bioproduction", "laboratoire", "santé", "pharmaceutique",
          "bonnes pratiques", "qualité",
        ],
        cpvCodes: ["80500000", "80510000"],
      },
    ],
  },
  {
    slug: "epitech",
    name: "Epitech — École de l'excellence informatique",
    shortName: "Epitech",
    description:
      "École d'informatique du groupe, dont la pédagogie par projet alimente aussi des dispositifs de reconversion (Coding Academy, Web@cadémie).",
    domains: ["Informatique", "Reconversion numérique", "Pédagogie par projet"],
    skills: [
      "Développement informatique", "Pédagogie par projet",
      "Reconversion et formation intensive", "Accompagnement de publics éloignés du numérique",
    ],
    programmes: ["Programme grande école", "Coding Academy", "Web@cadémie"],
    audiences: ["Demandeurs d'emploi", "Personnes en reconversion", "Salariés"],
    modalities: ["Présentiel", "Distanciel"],
    cooperation:
      "Particulièrement pertinent sur les marchés de reconversion et d'insertion professionnelle dans le numérique. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-EPITECH-RECONV",
        title: "Reconversion numérique et formation intensive",
        domainSlug: "numerique",
        theme: "Insertion et reconversion",
        objective:
          "Répondre aux marchés de reconversion, d'insertion ou de formation intensive dans les métiers du numérique.",
        skills: [
          "Formation intensive au développement",
          "Pédagogie par projet",
          "Accompagnement vers l'emploi",
          "Remise à niveau numérique",
        ],
        keywords: [
          "reconversion", "insertion", "demandeur d'emploi", "formation intensive",
          "développement web", "pédagogie par projet", "poec", "préparation opérationnelle",
        ],
        cpvCodes: ["80500000", "80530000", "79611000"],
      },
    ],
  },
  {
    slug: "etna",
    name: "ETNA — École de l'alternance en informatique",
    shortName: "ETNA",
    description: "École leader de l'alternance en informatique au sein du groupe.",
    domains: ["Informatique", "Alternance", "Systèmes et réseaux"],
    skills: ["Développement", "Systèmes et réseaux", "Alternance et tutorat en entreprise"],
    programmes: ["Formations en alternance"],
    audiences: ["Alternants", "Salariés en montée en compétences"],
    modalities: ["Présentiel", "Alternance"],
    cooperation:
      "Appui possible sur les dispositifs en alternance et le tutorat en entreprise. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-ETNA-ALT",
        title: "Dispositifs en alternance et tutorat en entreprise",
        domainSlug: "management-transformation",
        theme: "Alternance",
        objective:
          "Couvrir les lots exigeant un dispositif en alternance ou un accompagnement de tuteurs.",
        skills: ["Ingénierie de l'alternance", "Tutorat en entreprise", "Suivi des alternants"],
        keywords: ["alternance", "apprentissage", "tuteur", "tutorat", "contrat de professionnalisation"],
        cpvCodes: ["80500000", "80530000"],
      },
    ],
  },
  {
    slug: "iseg",
    name: "ISEG — École de communication",
    shortName: "ISEG",
    description: "École de communication nouvelle génération du Groupe IONIS.",
    domains: ["Communication", "Marketing digital", "Médias"],
    skills: [
      "Communication institutionnelle", "Communication digitale",
      "Marketing et relation publics", "Création de contenus",
    ],
    programmes: ["Programmes communication et marketing"],
    audiences: ["Chargés de communication", "Responsables marketing"],
    modalities: ["Présentiel"],
    cooperation:
      "Appui possible sur les lots communication publique et communication digitale. Accord formel requis.",
    sourceUrl: GROUP_URL,
    capabilities: [
      {
        code: "IONIS-ISEG-COM",
        title: "Communication institutionnelle et digitale",
        domainSlug: "management-transformation",
        theme: "Communication",
        objective:
          "Répondre aux lots de communication publique, éditoriale ou digitale hors périmètre ESME.",
        skills: [
          "Stratégie de communication", "Communication digitale",
          "Rédaction et édition", "Relations publiques",
        ],
        keywords: [
          "communication", "marketing", "digital", "réseaux sociaux", "éditorial",
          "relations publiques", "contenu", "communication publique",
        ],
        cpvCodes: ["80500000", "79416000"],
      },
    ],
  },
];
