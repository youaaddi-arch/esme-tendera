"use server";

import { revalidatePath } from "next/cache";
import type { PipelineStage } from "@prisma/client";

import { requireSession } from "@/lib/auth";
import { assertCan, PermissionError } from "@/lib/rbac";
import { moveTenderStage, TenderRuleError } from "@/lib/tenders";

export type MoveResult = { ok: true; stage: PipelineStage } | { ok: false; error: string };

/**
 * Déplacement d'une carte depuis le Kanban.
 *
 * Les règles de transition sont vérifiées côté serveur : un refus revient à
 * l'interface sous forme de message, et la carte reprend sa place.
 */
export async function moveTenderAction(tenderId: string, target: PipelineStage): Promise<MoveResult> {
  try {
    const session = await requireSession();
    assertCan(session.role, "tender.move");
    const result = await moveTenderStage(tenderId, target, session.id);
    revalidatePath("/pipeline");
    revalidatePath("/affaires");
    revalidatePath(`/affaires/${tenderId}`);
    revalidatePath("/");
    return { ok: true, stage: result.stage };
  } catch (error) {
    if (error instanceof TenderRuleError) return { ok: false, error: error.message };
    if (error instanceof PermissionError) {
      return { ok: false, error: "Votre rôle ne permet pas de déplacer une affaire dans le pipeline." };
    }
    if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
      return { ok: false, error: "Session expirée. Reconnectez-vous." };
    }
    console.error("[pipeline] déplacement", error);
    return { ok: false, error: "Le déplacement a échoué. Consultez le journal du serveur." };
  }
}
