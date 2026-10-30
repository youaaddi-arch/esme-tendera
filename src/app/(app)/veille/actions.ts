"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { assertCan, PermissionError } from "@/lib/rbac";
import { setSetting } from "@/lib/settings";
import { runConnector } from "@/lib/veille/run";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

function fail(error: unknown): ActionState {
  if (error instanceof PermissionError) {
    return { ok: false, message: "Votre rôle ne permet pas cette action sur la veille." };
  }
  if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
    return { ok: false, message: "Session expirée. Reconnectez-vous." };
  }
  console.error("[veille] action", error);
  return { ok: false, message: "L'action a échoué. Consultez le journal du serveur." };
}

/**
 * « Lancer la veille maintenant ».
 *
 * Exécute réellement la synchronisation sur le connecteur demandé et renvoie
 * son résultat. Un connecteur injoignable produit un échec explicite avec sa
 * raison : aucune affaire n'est créée, et rien n'est simulé.
 */
export async function runConnectorAction(connectorKey: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "veille.run");

    const outcome = await runConnector(connectorKey, { trigger: "manuelle", userId: session.id });

    revalidatePath("/veille");
    revalidatePath("/pipeline");
    revalidatePath("/");

    return { ok: outcome.status !== "ECHEC", message: outcome.message };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleConnectorAction(connectorKey: string, enabled: boolean): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "veille.configure");

    const connector = await prisma.sourceConnector.findUniqueOrThrow({ where: { key: connectorKey } });
    if (enabled && connector.status === "A_IMPLEMENTER") {
      return {
        ok: false,
        message: `Ce connecteur n'est pas implémenté. ${connector.requirement ?? ""}`.trim(),
      };
    }

    await prisma.sourceConnector.update({ where: { key: connectorKey }, data: { enabled } });
    await recordAudit({
      action: "veille.configure",
      entity: "SourceConnector",
      entityId: connector.id,
      userId: session.id,
      summary: `${connector.name} ${enabled ? "activé" : "désactivé"}.`,
    });

    revalidatePath("/veille");
    return { ok: true, message: `${connector.name} ${enabled ? "activé" : "désactivé"}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function updateVeilleSettingsAction(formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "veille.configure");

    const keywords = String(formData.get("keywords") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const cpvCodes = String(formData.get("cpvCodes") ?? "")
      .split(/[\s,;]+/)
      .map((code) => code.trim())
      .filter(Boolean);
    const dailyHour = Number.parseInt(String(formData.get("dailyHour") ?? "7"), 10);

    if (keywords.length === 0) {
      return { ok: false, message: "Au moins un mot-clé est nécessaire, sinon la veille ne filtre rien." };
    }

    await setSetting(
      "veille",
      {
        keywords,
        cpvCodes,
        dailyHour: Number.isFinite(dailyHour) ? Math.max(0, Math.min(23, dailyHour)) : 7,
      },
      session.id,
    );

    await recordAudit({
      action: "veille.parametres",
      entity: "Setting",
      entityId: "veille",
      userId: session.id,
      summary: `Paramètres de veille mis à jour : ${keywords.length} mot(s)-clé(s), ${cpvCodes.length} code(s) CPV.`,
    });

    revalidatePath("/veille");
    return { ok: true, message: "Paramètres enregistrés." };
  } catch (error) {
    return fail(error);
  }
}
