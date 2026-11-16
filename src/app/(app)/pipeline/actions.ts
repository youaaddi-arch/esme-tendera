"use server";

import { revalidatePath } from "next/cache";
import type { PipelineStage } from "@prisma/client";

import { requireSession } from "@/lib/auth";
import { recordDecision } from "@/lib/decisions";
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

/**
 * NO GO posé depuis le Kanban.
 *
 * La colonne « No Go » n'est pas une étape : elle reflète une décision. La
 * déplacer comme une étape aurait classé l'affaire sans rien décider, et la
 * carte serait réapparue ailleurs — elle se range par sa décision, pas par son
 * étape. Le dépôt enregistre donc une vraie décision, au nom de qui l'a
 * déposée, sans motif ni motivation : c'est ce que vaut un geste de tri, et la
 * fiche reste là pour le préciser ou le défaire.
 *
 * La permission demandée est celle de décider, pas celle de déplacer : un
 * rôle qui peut remuer des cartes dans le pipeline n'arbitre pas pour autant.
 */
export async function noGoAction(tenderId: string): Promise<MoveResult> {
  try {
    const session = await requireSession();
    assertCan(session.role, "decision.record");

    const issue = await recordDecision(tenderId, { status: "NO_GO", userId: session.id });
    if (!issue.ok) return { ok: false, error: issue.message };

    revalidatePath("/pipeline");
    revalidatePath("/affaires");
    revalidatePath(`/affaires/${tenderId}`);
    revalidatePath("/");
    return { ok: true, stage: "REJETE_NON_POURSUIVI" };
  } catch (error) {
    if (error instanceof PermissionError) {
      return { ok: false, error: "Votre rôle ne permet pas d'arbitrer le Go / No Go." };
    }
    if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
      return { ok: false, error: "Session expirée. Reconnectez-vous." };
    }
    console.error("[pipeline] no go", error);
    return { ok: false, error: "L'enregistrement du NO GO a échoué. Consultez le journal du serveur." };
  }
}
