import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

type RecordAuditInput = {
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  userId?: string | null;
  /** Acteur non humain : "systeme", "veille", "moteur-ia". */
  actor?: string;
  tenderId?: string | null;
  /** Détail sérialisable. Converti en JSON à l'écriture. */
  payload?: unknown;
};

/**
 * Journalise une action.
 *
 * L'écriture du journal ne doit jamais faire échouer l'action métier : une
 * erreur ici est tracée dans les logs serveur, pas remontée à l'appelant.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        summary: input.summary,
        userId: input.userId ?? null,
        actor: input.actor ?? (input.userId ? "utilisateur" : "systeme"),
        tenderId: input.tenderId ?? null,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[audit] écriture impossible", error);
  }
}

/** Calcule les champs réellement modifiés, pour un journal lisible. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { avant: unknown; apres: unknown }> {
  const diff: Record<string, { avant: unknown; apres: unknown }> = {};
  for (const [key, next] of Object.entries(after)) {
    const previous = before[key];
    const sameDate =
      previous instanceof Date && next instanceof Date && previous.getTime() === next.getTime();
    if (sameDate) continue;
    if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) continue;
    diff[key] = { avant: previous ?? null, apres: next ?? null };
  }
  return diff;
}
