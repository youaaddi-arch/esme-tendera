import type { ConnectorStatus } from "@prisma/client";

/**
 * Registre des sources de veille.
 *
 * Ce fichier dit la vérité sur chaque connecteur : ce qui est implémenté, ce
 * qui est joignable, et ce qu'il faudrait fournir pour rendre le reste
 * opérationnel. L'interface affiche ce statut tel quel — un connecteur
 * « à implémenter » n'est jamais présenté comme actif.
 *
 * Règle commune : on n'utilise que des API officielles, des jeux de données
 * ouverts et des flux publics. Aucune protection technique n'est contournée,
 * aucun espace nécessitant un compte n'est moissonné sans accès fourni.
 */

export type ConnectorDefinition = {
  key: string;
  name: string;
  baseUrl: string | null;
  description: string;
  status: ConnectorStatus;
  /** Ce qu'il manque pour passer à OPERATIONNEL. */
  requirement: string | null;
  enabledByDefault: boolean;
  defaultConfig?: Record<string, unknown>;
};

export const connectorRegistry: ConnectorDefinition[] = [
  {
    key: "boamp",
    name: "BOAMP — Bulletin officiel des annonces de marchés publics",
    baseUrl: "https://boamp-datadila.opendatasoft.com/api/explore/v2.1",
    description:
      "Jeu de données ouvert du BOAMP exposé via l'API Explore d'Opendatasoft. Couvre les avis d'appel public à la concurrence, les avis rectificatifs et les avis d'attribution.",
    status: "OPERATIONNEL",
    requirement:
      "Aucun compte requis. L'hôte boamp-datadila.opendatasoft.com doit être joignable depuis le serveur : dans un environnement à sortie filtrée, ajoutez-le à la liste d'autorisation.",
    enabledByDefault: true,
    defaultConfig: {
      // La recherche étant volontairement large, il faut assez de pages pour
      // ne pas tronquer la moisson : 100 avis par page, jusqu'à 25 pages.
      pageSize: 100,
      maxPages: 25,
      // Trente jours, pas sept : un avis publié il y a trois semaines dont la
      // date limite tombe dans deux mois est encore à traiter. La
      // déduplication fait que revoir un avis ne coûte rien.
      lookbackDays: 30,
    },
  },
  {
    key: "ted",
    name: "TED — Tenders Electronic Daily (Union européenne)",
    baseUrl: "https://api.ted.europa.eu/v3",
    description:
      "API de recherche officielle du supplément au Journal officiel de l'Union européenne. Couvre les marchés au-dessus des seuils européens.",
    status: "A_IMPLEMENTER",
    requirement:
      "L'API TED v3 exige une clé d'API nominative (portail des développeurs de l'Office des publications). Fournir la clé dans les paramètres du connecteur pour activer la recherche.",
    enabledByDefault: false,
    defaultConfig: { pageSize: 100, lookbackDays: 7 },
  },
  {
    key: "place",
    name: "PLACE — Plateforme des achats de l'État",
    baseUrl: "https://www.marches-publics.gouv.fr",
    description:
      "Profil d'acheteur de l'État. Les consultations sont publiées au BOAMP et, pour partie, reprises dans les données essentielles de la commande publique.",
    status: "A_IMPLEMENTER",
    requirement:
      "PLACE n'expose pas d'API publique de recherche. Deux voies possibles : le flux des données essentielles de la commande publique (data.gouv.fr), ou un compte opérateur économique permettant le retrait de DCE. À arbitrer avec la DSI.",
    enabledByDefault: false,
  },
  {
    key: "decp",
    name: "DECP — Données essentielles de la commande publique",
    baseUrl: "https://www.data.gouv.fr",
    description:
      "Jeu de données consolidé des marchés publics attribués. Utile à l'analyse des attributions, des acheteurs récurrents et des montants de référence, plutôt qu'à la détection amont.",
    status: "A_IMPLEMENTER",
    requirement:
      "Jeu de données ouvert, sans authentification. Implémentation à prévoir : téléchargement périodique et indexation locale (volume de plusieurs centaines de Mo).",
    enabledByDefault: false,
  },
  {
    key: "maximilien",
    name: "Maximilien — Place de marché publique d'Île-de-France",
    baseUrl: "https://marches.maximilien.fr",
    description:
      "Profil d'acheteur mutualisé des collectivités franciliennes, pertinent au regard de l'implantation de l'ESME.",
    status: "A_IMPLEMENTER",
    requirement:
      "Pas d'API publique documentée. Nécessite un compte opérateur économique ; le retrait de DCE y est nominatif. À cadrer avec l'éditeur avant toute automatisation.",
    enabledByDefault: false,
  },
  {
    key: "aws-achat",
    name: "AWS-Achat",
    baseUrl: "https://www.marches-publics.info",
    description: "Profil d'acheteur utilisé par de nombreuses collectivités.",
    status: "A_IMPLEMENTER",
    requirement:
      "Accès par compte opérateur économique. Vérifier auprès de l'éditeur l'existence d'un flux ou d'une API partenaire avant implémentation.",
    enabledByDefault: false,
  },
  {
    key: "marches-securises",
    name: "Marchés Sécurisés",
    baseUrl: "https://www.marches-securises.fr",
    description: "Profil d'acheteur utilisé par des collectivités et établissements publics.",
    status: "A_IMPLEMENTER",
    requirement:
      "Accès par compte opérateur économique. Aucune API publique identifiée ; contact éditeur nécessaire.",
    enabledByDefault: false,
  },
  {
    key: "achatpublic",
    name: "Achatpublic.com",
    baseUrl: "https://www.achatpublic.com",
    description: "Profil d'acheteur et place de marché.",
    status: "A_IMPLEMENTER",
    requirement:
      "Accès par compte opérateur économique. Vérifier l'offre d'API partenaire avant implémentation.",
    enabledByDefault: false,
  },
  {
    key: "import-manuel",
    name: "Import manuel",
    baseUrl: null,
    description:
      "Création d'une affaire à partir d'un lien de consultation ou d'une saisie, avec dépôt des pièces du DCE. Toujours disponible, y compris quand aucun connecteur n'est joignable.",
    status: "OPERATIONNEL",
    requirement: null,
    enabledByDefault: true,
  },
];

export function findConnector(key: string): ConnectorDefinition | undefined {
  return connectorRegistry.find((connector) => connector.key === key);
}
