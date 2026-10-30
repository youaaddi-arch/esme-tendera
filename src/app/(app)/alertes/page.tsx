import Link from "next/link";
import { BellRing } from "lucide-react";

import { ActionButton } from "@/components/app/action-form";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { markAllReadAction, markReadAction, refreshRemindersAction } from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, notificationKindLabels } from "@/lib/labels";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Alertes" };
export const dynamic = "force-dynamic";

export default async function AlertesPage() {
  const session = await requireSession();

  const [notifications, reminders] = await Promise.all([
    prisma.notification.findMany({
      where: { OR: [{ userId: session.id }, { userId: null }] },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: 150,
      include: { tender: { select: { id: true, reference: true, title: true } } },
    }),
    getSetting("reminders"),
  ]);

  const unread = notifications.filter((notification) => !notification.readAt);

  return (
    <>
      <PageHeader
        title="Alertes"
        subtitle={`${unread.length} alerte(s) non lue(s) sur ${notifications.length} affichée(s).`}
        actions={
          <>
            <ActionButton action={refreshRemindersAction} label="Recalculer les rappels" size="sm" />
            {unread.length > 0 ? (
              <ActionButton action={markAllReadAction} label="Tout marquer comme lu" variant="secondary" size="sm" />
            ) : null}
          </>
        }
      />

      <div className="space-y-5 p-6">
        <Notice tone="info" title="Rappels d'échéance">
          Les rappels sont créés à J-{reminders.daysBefore.filter((day) => day > 0).join(", J-")} et le jour du
          dépôt, pour les affaires encore en cours. Une consultation est signalée comme fortement
          pertinente à partir d&apos;un score global de {reminders.highRelevanceScore}/100.
          <br />
          Les envois par courriel et Microsoft Teams ne sont pas raccordés : fournir un relais SMTP et
          une application Microsoft Graph pour les activer.
        </Notice>

        {notifications.length === 0 ? (
          <EmptyState
            title="Aucune alerte"
            description="Les alertes sont créées par la veille, l'analyse des dossiers et les contrôles qualité."
          />
        ) : (
          <Card>
            <CardHeader title="Journal des alertes" />
            <ul className="divide-y divide-ink-100">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={notification.readAt ? "px-5 py-3 opacity-60" : "px-5 py-3"}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            notification.severity === "CRITIQUE" ? "danger"
                            : notification.severity === "IMPORTANT" ? "warn" : "neutral"
                          }
                        >
                          {notificationKindLabels[notification.kind]}
                        </Badge>
                        {!notification.readAt ? (
                          <span className="flex items-center gap-1 text-[11px] text-framboise-500">
                            <BellRing className="size-3" aria-hidden />
                            Non lue
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[13px] font-medium text-esme-900">{notification.title}</p>
                      {notification.body ? (
                        <p className="mt-0.5 text-[12px] text-ink-600">{notification.body}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-ink-400">
                        {formatDateTime(notification.createdAt)}
                        {notification.tender ? (
                          <>
                            {" · "}
                            <Link href={`/affaires/${notification.tender.id}`} className="text-esme-600 hover:underline">
                              {notification.tender.reference}
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {!notification.readAt ? (
                      <ActionButton
                        action={markReadAction.bind(null, notification.id)}
                        label="Marquer lue"
                        variant="ghost"
                        size="sm"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
