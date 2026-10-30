import type {
  AmountKind, ConnectorStatus, DceStatus, DocumentKind, GoNoGoStatus, KnowledgeCategory,
  NegotiationKind, NoGoReason, NotificationKind, OutcomeStatus, PipelineStage,
  RequirementLevel, RequirementStatus, ResponseDocStatus, ResponseDocType, TaskStatus,
  TrainingOrigin,
} from "@prisma/client";

/** Libellés français des énumérations, et ordre d'affichage des pipelines. */

export const stageLabels: Record<PipelineStage, string> = {
  AO_IDENTIFIES: "AO identifiés",
  MATCHING: "Matching",
  GO_NO_GO: "Go / No Go",
  PREPARATION: "Préparation de la réponse",
  CONTROLE_QUALITE: "Contrôle qualité",
  PRET_AU_DEPOT: "Prêt au dépôt",
  DEPOT_EFFECTUE: "Dépôt effectué",
  NEGOCIATION: "Négociation",
  ATTENTE_RESULTAT: "En attente de résultat",
  MARCHE_ATTRIBUE: "Marché attribué",
  REJETE_NON_POURSUIVI: "Rejeté / non poursuivi",
};

export const stageOrder: PipelineStage[] = [
  "AO_IDENTIFIES", "MATCHING", "GO_NO_GO", "PREPARATION", "CONTROLE_QUALITE",
  "PRET_AU_DEPOT", "DEPOT_EFFECTUE", "NEGOCIATION", "ATTENTE_RESULTAT",
  "MARCHE_ATTRIBUE", "REJETE_NON_POURSUIVI",
];

/**
 * Transitions autorisées.
 *
 * Le pipeline n'est pas un couloir : on peut revenir en arrière (une affaire
 * repasse en préparation après un contrôle qualité défavorable) et abandonner
 * à toute étape. Mais on ne saute pas la décision Go/No Go, et on n'atteint
 * « Dépôt effectué » que depuis « Prêt au dépôt », parce que le dépôt exige une
 * confirmation humaine explicite.
 */
export const allowedTransitions: Record<PipelineStage, PipelineStage[]> = {
  AO_IDENTIFIES: ["MATCHING", "GO_NO_GO", "REJETE_NON_POURSUIVI"],
  MATCHING: ["AO_IDENTIFIES", "GO_NO_GO", "REJETE_NON_POURSUIVI"],
  GO_NO_GO: ["MATCHING", "PREPARATION", "REJETE_NON_POURSUIVI"],
  PREPARATION: ["GO_NO_GO", "CONTROLE_QUALITE", "PRET_AU_DEPOT", "REJETE_NON_POURSUIVI"],
  CONTROLE_QUALITE: ["PREPARATION", "PRET_AU_DEPOT", "REJETE_NON_POURSUIVI"],
  PRET_AU_DEPOT: ["CONTROLE_QUALITE", "PREPARATION", "DEPOT_EFFECTUE", "REJETE_NON_POURSUIVI"],
  DEPOT_EFFECTUE: ["NEGOCIATION", "ATTENTE_RESULTAT"],
  NEGOCIATION: ["ATTENTE_RESULTAT", "DEPOT_EFFECTUE"],
  ATTENTE_RESULTAT: ["NEGOCIATION", "MARCHE_ATTRIBUE", "REJETE_NON_POURSUIVI"],
  MARCHE_ATTRIBUE: ["ATTENTE_RESULTAT"],
  REJETE_NON_POURSUIVI: ["AO_IDENTIFIES", "MATCHING", "GO_NO_GO"],
};

/** Étapes qui exigent une condition supplémentaire avant d'être atteintes. */
export const transitionGuards: Partial<Record<PipelineStage, string>> = {
  PREPARATION: "Une décision GO doit avoir été enregistrée.",
  DEPOT_EFFECTUE:
    "Le dépôt doit être confirmé depuis la fiche (plateforme, date et responsable), avec accusé de réception si disponible.",
};

export const goNoGoLabels: Record<GoNoGoStatus, string> = {
  A_DECIDER: "À décider",
  GO: "GO",
  NO_GO: "NO GO",
};

export const outcomeLabels: Record<OutcomeStatus, string> = {
  EN_ATTENTE: "En attente de résultat",
  ATTRIBUE: "Marché attribué",
  REJETE: "Rejeté",
  ANNULE: "Annulé",
  SANS_SUITE: "Sans suite",
  INFRUCTUEUX: "Infructueux",
};

export const noGoReasonLabels: Record<NoGoReason, string> = {
  HORS_PERIMETRE: "Hors périmètre",
  MOYENS_INSUFFISANTS: "Moyens insuffisants",
  RENTABILITE_INSUFFISANTE: "Rentabilité insuffisante",
  DELAI_TROP_COURT: "Délai trop court",
  EXIGENCE_ELIMINATOIRE: "Exigence éliminatoire",
  RISQUE_CONTRACTUEL: "Risque contractuel",
  DECISION_STRATEGIQUE: "Décision stratégique",
  AUTRE: "Autre",
};

export const dceStatusLabels: Record<DceStatus, string> = {
  NON_TENTE: "Non tenté",
  RECUPERE: "Récupéré",
  IMPORTE_MANUELLEMENT: "Importé manuellement",
  NON_RECUPERE: "DCE non récupéré",
};

export const documentKindLabels: Record<DocumentKind, string> = {
  RC: "RC — Règlement de consultation",
  CCTP: "CCTP — Cahier des clauses techniques particulières",
  CCAP: "CCAP — Cahier des clauses administratives particulières",
  AE: "AE — Acte d'engagement",
  BPU: "BPU — Bordereau des prix unitaires",
  DPGF: "DPGF — Décomposition du prix global et forfaitaire",
  DQE: "DQE — Détail quantitatif estimatif",
  CADRE_MEMOIRE: "Cadre de mémoire technique",
  DC1: "DC1 — Lettre de candidature",
  DC2: "DC2 — Déclaration du candidat",
  DC4: "DC4 — Déclaration de sous-traitance",
  ANNEXE: "Annexe",
  ATTESTATION: "Attestation",
  REGLEMENT_CONSULTATION_ANNEXE: "Annexe au règlement de consultation",
  AVIS: "Avis de publicité",
  AUTRE: "Autre pièce",
};

export const requirementLevelLabels: Record<RequirementLevel, string> = {
  OBLIGATOIRE: "Exigence obligatoire",
  EVALUEE: "Exigence évaluée",
  RECOMMANDATION: "Recommandation",
};

export const requirementStatusLabels: Record<RequirementStatus, string> = {
  CONFORME: "Conforme",
  A_VERIFIER: "À vérifier",
  MANQUANT: "Manquant",
  NON_CONFORME: "Non conforme",
  NON_APPLICABLE: "Non applicable",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_RELECTURE: "En relecture",
  TERMINEE: "Terminée",
  BLOQUEE: "Bloquée",
};

export const responseDocTypeLabels: Record<ResponseDocType, string> = {
  MEMOIRE_TECHNIQUE: "Mémoire technique",
  DC1: "DC1 — Lettre de candidature",
  DC2: "DC2 — Déclaration du candidat",
  DC4: "DC4 — Déclaration de sous-traitance",
  ACTE_ENGAGEMENT: "Acte d'engagement",
  ANNEXE_ADMIN: "Annexe administrative",
  QUESTIONNAIRE: "Questionnaire",
  CADRE_REPONSE: "Cadre de réponse",
  OFFRE_FINANCIERE: "Offre financière",
  AUTRE: "Autre document",
};

export const responseDocStatusLabels: Record<ResponseDocStatus, string> = {
  BROUILLON: "Brouillon",
  EN_REDACTION: "En rédaction",
  EN_RELECTURE: "En relecture",
  VALIDE: "Validé",
};

export const knowledgeCategoryLabels: Record<KnowledgeCategory, string> = {
  CATALOGUE: "Catalogue de formations",
  PROGRAMME: "Programme",
  INSTITUTIONNEL: "Document institutionnel",
  REFERENCE_CLIENT: "Référence client",
  MEMOIRE_TECHNIQUE: "Mémoire technique",
  REPONSE_PRECEDENTE: "Réponse précédente",
  CV_FORMATEUR: "CV formateur",
  CERTIFICATION: "Certification",
  ATTESTATION: "Attestation",
  QUALITE: "Document qualité",
  TARIF: "Tarif",
  MODELE_FINANCIER: "Modèle financier",
  IONIS: "Établissement IONIS",
  PROCEDURE_INTERNE: "Procédure interne",
};

export const negotiationKindLabels: Record<NegotiationKind, string> = {
  DEMANDE_PRECISION: "Demande de précision",
  REUNION: "Réunion",
  QUESTION_ACHETEUR: "Question de l'acheteur",
  DOCUMENT_COMPLEMENTAIRE: "Document complémentaire",
  OFFRE_REVISEE: "Offre financière révisée",
  VERSION_MEMOIRE: "Version du mémoire",
  AUTRE: "Autre",
};

export const notificationKindLabels: Record<NotificationKind, string> = {
  NOUVELLE_CONSULTATION: "Nouvelle consultation pertinente",
  DCE_DISPONIBLE: "DCE disponible",
  DCE_NON_RECUPERE: "DCE non récupéré",
  AVIS_RECTIFICATIF: "Avis rectificatif",
  DATE_LIMITE_MODIFIEE: "Date limite modifiée",
  GO_NO_GO_A_DECIDER: "Go / No Go à décider",
  DOCUMENT_MANQUANT: "Document manquant",
  VALIDATION_ATTENDUE: "Validation attendue",
  ECHEANCE_DEPOT: "Échéance de dépôt",
  DEMANDE_NEGOCIATION: "Demande de négociation",
  RESULTAT_PUBLIE: "Résultat publié",
};

export const connectorStatusLabels: Record<ConnectorStatus, string> = {
  OPERATIONNEL: "Opérationnel",
  INDISPONIBLE: "Indisponible",
  A_IMPLEMENTER: "À implémenter",
  DESACTIVE: "Désactivé",
};

export const originLabels: Record<TrainingOrigin, string> = {
  CATALOGUE_ESME: "Catalogue ESME",
  VOISINE: "Formation voisine",
  IONIS: "Groupe IONIS",
};

export const amountKindLabels: Record<AmountKind, string> = {
  ESTIME: "Montant estimé",
  MAXIMUM: "Montant maximum",
  PAR_LOT: "Montant par lot",
  GLOBAL: "Montant global",
  NON_COMMUNIQUE: "Non communiqué",
};

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/**
 * Affichage d'un montant.
 *
 * Un montant absent s'affiche « Non communiqué » : jamais 0 €, jamais une
 * estimation inventée. La nature du montant (estimé, maximum) est toujours
 * portée avec lui.
 */
export function formatAmount(
  kind: AmountKind,
  // Prisma renvoie les montants en Decimal : on accepte tout ce qui sait se
  // convertir en nombre, plutôt que d'imposer une conversion à chaque appel.
  min?: number | string | { toString(): string } | null,
  max?: number | string | { toString(): string } | null,
): string {
  const low = min === null || min === undefined ? null : Number(min.toString());
  const high = max === null || max === undefined ? null : Number(max.toString());
  if (kind === "NON_COMMUNIQUE" || (low === null && high === null)) return "Non communiqué";

  const prefix =
    kind === "MAXIMUM" ? "Max. " : kind === "ESTIME" ? "Est. " : kind === "PAR_LOT" ? "Lot : " : "";
  if (low !== null && high !== null && low !== high) {
    return `${prefix}${EUR.format(low)} – ${EUR.format(high)} HT`;
  }
  const value = high ?? low;
  return value === null ? "Non communiqué" : `${prefix}${EUR.format(value)} HT`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Jours restants avant une échéance. Négatif si l'échéance est passée. */
export function daysUntil(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatDeadline(value: Date | string | null | undefined): {
  text: string;
  tone: "neutral" | "warn" | "danger" | "ok";
} {
  const remaining = daysUntil(value);
  if (remaining === null) return { text: "Date limite inconnue", tone: "neutral" };
  if (remaining < 0) return { text: `Échue depuis ${Math.abs(remaining)} j`, tone: "danger" };
  if (remaining === 0) return { text: "Dépôt aujourd'hui", tone: "danger" };
  if (remaining <= 3) return { text: `J-${remaining}`, tone: "danger" };
  if (remaining <= 10) return { text: `J-${remaining}`, tone: "warn" };
  return { text: `J-${remaining}`, tone: "ok" };
}
