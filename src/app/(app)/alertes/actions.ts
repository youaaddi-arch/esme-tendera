"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refreshDeadlineReminders } from "@/lib/notifications";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

/** Marque une alerte comme lue pour l'utilisateur courant. */
export async function markReadAction(notificationId: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) return { ok: false, message: "Alerte introuvable." };
    // Une alerte d'équipe (sans destinataire) est marquée lue globalement :
    // c'est le comportement attendu d'un tableau d'alertes partagé.
    if (notification.userId && notification.userId !== session.id) {
      return { ok: false, message: "Cette alerte est adressée à un autre utilisateur." };
    }
    await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
    revalidatePath("/alertes");
    return { ok: true, message: "Alerte marquée comme lue." };
  } catch {
    return { ok: false, message: "L'action a échoué." };
  }
}

export async function markAllReadAction(): Promise<ActionState> {
  try {
    const session = await requireSession();
    const result = await prisma.notification.updateMany({
      where: { readAt: null, OR: [{ userId: session.id }, { userId: null }] },
      data: { readAt: new Date() },
    });
    revalidatePath("/alertes");
    return { ok: true, message: `${result.count} alerte(s) marquée(s) comme lue(s).` };
  } catch {
    return { ok: false, message: "L'action a échoué." };
  }
}

/** Recalcule les rappels d'échéance (J-15, J-7, J-3, J-1, jour du dépôt). */
export async function refreshRemindersAction(): Promise<ActionState> {
  try {
    await requireSession();
    const created = await refreshDeadlineReminders();
    revalidatePath("/alertes");
    return {
      ok: true,
      message: created > 0 ? `${created} rappel(s) créé(s).` : "Aucun nouveau rappel : aucune échéance ne tombe sur un jalon configuré.",
    };
  } catch {
    return { ok: false, message: "L'action a échoué." };
  }
}
