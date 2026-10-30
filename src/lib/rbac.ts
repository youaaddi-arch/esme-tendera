import type { Role } from "@prisma/client";

/**
 * Permissions de TENDERA.
 *
 * Le principe : la lecture est large, l'écriture est cadrée, et les décisions
 * engageantes (Go/No Go, validation finale, enregistrement d'un dépôt) sont
 * réservées à l'administrateur et au responsable appels d'offres.
 */
export type Permission =
  | "tender.read"
  | "tender.create"
  | "tender.edit"
  | "tender.move" // déplacer une carte dans le pipeline
  | "tender.archive"
  | "tender.assign"
  | "dce.upload"
  | "dce.analyze"
  | "matching.run"
  | "matching.override"
  | "decision.record" // Go / No Go
  | "response.edit"
  | "response.comment"
  | "response.validate"
  | "quality.run"
  | "submission.record" // enregistrer un dépôt effectué
  | "result.record"
  | "catalogue.read"
  | "catalogue.edit"
  | "knowledge.read"
  | "knowledge.edit"
  | "knowledge.readConfidential"
  | "veille.run"
  | "veille.configure"
  | "admin.users"
  | "admin.settings"
  | "audit.read";

const ALL: Permission[] = [
  "tender.read", "tender.create", "tender.edit", "tender.move", "tender.archive", "tender.assign",
  "dce.upload", "dce.analyze", "matching.run", "matching.override", "decision.record",
  "response.edit", "response.comment", "response.validate", "quality.run",
  "submission.record", "result.record",
  "catalogue.read", "catalogue.edit", "knowledge.read", "knowledge.edit", "knowledge.readConfidential",
  "veille.run", "veille.configure", "admin.users", "admin.settings", "audit.read",
];

const MATRIX: Record<Role, Permission[]> = {
  ADMINISTRATEUR: ALL,

  RESPONSABLE_AO: [
    "tender.read", "tender.create", "tender.edit", "tender.move", "tender.archive", "tender.assign",
    "dce.upload", "dce.analyze", "matching.run", "matching.override", "decision.record",
    "response.edit", "response.comment", "response.validate", "quality.run",
    "submission.record", "result.record",
    "catalogue.read", "catalogue.edit", "knowledge.read", "knowledge.edit", "knowledge.readConfidential",
    "veille.run", "veille.configure", "audit.read",
  ],

  REDACTEUR: [
    "tender.read", "tender.edit", "tender.move",
    "dce.upload", "dce.analyze", "matching.run",
    "response.edit", "response.comment", "quality.run",
    "catalogue.read", "knowledge.read", "veille.run",
  ],

  EXPERT_PEDAGOGIQUE: [
    "tender.read", "tender.edit",
    "dce.analyze", "matching.run", "matching.override",
    "response.edit", "response.comment",
    "catalogue.read", "catalogue.edit", "knowledge.read", "knowledge.edit",
  ],

  RELECTEUR: [
    "tender.read", "response.comment", "quality.run",
    "catalogue.read", "knowledge.read",
  ],

  LECTEUR: ["tender.read", "catalogue.read", "knowledge.read"],
};

export const roleLabels: Record<Role, string> = {
  ADMINISTRATEUR: "Administrateur",
  RESPONSABLE_AO: "Responsable appels d'offres",
  REDACTEUR: "Rédacteur",
  EXPERT_PEDAGOGIQUE: "Expert pédagogique",
  RELECTEUR: "Relecteur",
  LECTEUR: "Lecteur",
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(permission) ?? false;
}

/** Lève si le rôle ne porte pas la permission. Utilisé par les routes d'API. */
export function assertCan(role: Role | undefined | null, permission: Permission): void {
  if (!can(role, permission)) {
    throw new PermissionError(permission);
  }
}

export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Permission requise : ${permission}`);
    this.name = "PermissionError";
  }
}

export function permissionsFor(role: Role): Permission[] {
  return MATRIX[role] ?? [];
}
