import "server-only";

import type { NotificationKind, NotificationSeverity } from "@prisma/client";

import { prisma } from "./db";
import { getSetting } from "./settings";

/**
 * Alertes de la plateforme.
 *
 * Une notification sans `userId` est une alerte d'équipe, visible de tous les
 * utilisateurs habilités sur l'affaire. Les canaux externes (courriel,
 * Microsoft Teams) ne sont pas encore raccordés : la fonction
 * `dispatchExternal` marque explicitement cet état plutôt que de laisser
 * croire qu'un message est parti.
 */

type NotifyInput = {
  kind: NotificationKind;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  tenderId?: string | null;
  userId?: string | null;
  dueAt?: Date | null;
  /** Évite les doublons sur une même affaire et un même type. */
  dedupeWindowHours?: number;
};

export async function notify(input: NotifyInput): Promise<void> {
  const window = input.dedupeWindowHours ?? 24;
  if (input.tenderId) {
    const since = new Date(Date.now() - window * 60 * 60 * 1000);
    const existing = await prisma.notification.findFirst({
      where: { kind: input.kind, tenderId: input.tenderId, title: input.title, createdAt: { gte: since } },
      select: { id: true },
    });
    if (existing) return;
  }

  await prisma.notification.create({
    data: {
      kind: input.kind,
      title: input.title,
      body: input.body,
      severity: input.severity ?? "INFO",
      tenderId: input.tenderId ?? null,
      userId: input.userId ?? null,
      dueAt: input.dueAt ?? null,
    },
  });
}

/**
 * Rappels d'échéance.
 *
 * Parcourt les affaires encore en jeu et crée un rappel à chacun des jalons
 * configurés (J-15, J-7, J-3, J-1, jour du dépôt par défaut). Appelée par la
 * veille quotidienne et par le tableau de bord.
 */
export async function refreshDeadlineReminders(): Promise<number> {
  const { daysBefore } = await getSetting("reminders");
  const openStages = [
    "AO_IDENTIFIES", "MATCHING", "GO_NO_GO", "PREPARATION", "CONTROLE_QUALITE", "PRET_AU_DEPOT",
  ] as const;

  const tenders = await prisma.tender.findMany({
    where: { archived: false, stage: { in: [...openStages] }, deadlineAt: { not: null } },
    select: { id: true, reference: true, title: true, deadlineAt: true, goNoGo: true },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let created = 0;

  for (const tender of tenders) {
    if (!tender.deadlineAt) continue;
    const deadline = new Date(tender.deadlineAt);
    deadline.setHours(0, 0, 0, 0);
    const remaining = Math.round((deadline.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (!daysBefore.includes(remaining)) continue;

    const label = remaining === 0 ? "aujourd'hui" : `dans ${remaining} jour${remaining > 1 ? "s" : ""}`;
    const before = await prisma.notification.count({
      where: { kind: "ECHEANCE_DEPOT", tenderId: tender.id, title: { contains: label } },
    });
    if (before > 0) continue;

    await notify({
      kind: "ECHEANCE_DEPOT",
      severity: remaining <= 3 ? "CRITIQUE" : "IMPORTANT",
      title: `Échéance ${label} — ${tender.reference}`,
      body: `${tender.title}. Date limite de dépôt : ${deadline.toLocaleDateString("fr-FR")}.`,
      tenderId: tender.id,
      dueAt: tender.deadlineAt,
      dedupeWindowHours: 20 * 24,
    });
    created += 1;
  }

  return created;
}

/**
 * Envoi externe — non raccordé.
 *
 * Le courriel et Microsoft Teams nécessitent respectivement un relais SMTP et
 * une application Microsoft Graph autorisée. Tant qu'ils ne sont pas fournis,
 * cette fonction ne prétend pas avoir envoyé quoi que ce soit.
 */
export function dispatchExternal(): { sent: false; reason: string } {
  return {
    sent: false,
    reason:
      "Les notifications par courriel et Microsoft Teams ne sont pas raccordées. Fournir un relais SMTP et une application Microsoft Graph (Chat.ReadWrite ou webhook entrant) pour les activer.",
  };
}
