import Link from "next/link";

import { Badge, Card, CardHeader, EmptyState, PageHeader, cx } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { daysUntil, formatDate, stageLabels } from "@/lib/labels";

export const metadata = { title: "Calendrier" };
export const dynamic = "force-dynamic";

/**
 * Vue calendrier des échéances.
 *
 * Deux natures d'échéance y figurent : les dates limites de dépôt, et les
 * jalons du planning de préparation. Ce sont les deux choses qu'on ne peut pas
 * rattraper une fois passées.
 */
export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  // Un paramètre « mois » illisible ramène au mois courant plutôt que de
  // produire une page vide.
  const requested = params.mois ? new Date(`${params.mois}-01T00:00:00`) : null;
  const base = requested && !Number.isNaN(requested.getTime()) ? requested : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59);

  const [tenders, tasks, negotiations] = await Promise.all([
    prisma.tender.findMany({
      where: { archived: false, deadlineAt: { gte: start, lte: end } },
      orderBy: { deadlineAt: "asc" },
      select: { id: true, reference: true, title: true, buyer: true, deadlineAt: true, stage: true, isDemo: true },
    }),
    prisma.task.findMany({
      where: { dueAt: { gte: start, lte: end }, status: { not: "TERMINEE" } },
      orderBy: { dueAt: "asc" },
      include: {
        tender: { select: { id: true, reference: true } },
        assignee: { select: { name: true } },
      },
    }),
    prisma.negotiationItem.findMany({
      where: { dueAt: { gte: start, lte: end }, done: false },
      orderBy: { dueAt: "asc" },
      include: { tender: { select: { id: true, reference: true } } },
    }),
  ]);

  type Event = {
    date: Date;
    kind: "depot" | "tache" | "negociation";
    label: string;
    sub: string;
    href: string;
    demo?: boolean;
  };

  const events: Event[] = [
    ...tenders.map((tender) => ({
      date: tender.deadlineAt!,
      kind: "depot" as const,
      label: tender.title,
      sub: `${tender.reference} · ${tender.buyer} · ${stageLabels[tender.stage]}`,
      href: `/affaires/${tender.id}`,
      demo: tender.isDemo,
    })),
    ...tasks.map((task) => ({
      date: task.dueAt!,
      kind: "tache" as const,
      label: task.title,
      sub: `${task.tender.reference}${task.assignee ? ` · ${task.assignee.name}` : " · non affectée"}`,
      href: `/affaires/${task.tender.id}?onglet=reponse`,
    })),
    ...negotiations.map((item) => ({
      date: item.dueAt!,
      kind: "negociation" as const,
      label: item.title,
      sub: `${item.tender.reference} · négociation`,
      href: `/affaires/${item.tender.id}?onglet=suivi`,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const byDay = new Map<number, Event[]>();
  for (const event of events) {
    const day = event.date.getDate();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(event);
  }

  // Grille du mois, commençant un lundi.
  const firstWeekday = (start.getDay() + 6) % 7;
  const daysInMonth = end.getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthKey = (offset: number) => {
    const target = new Date(year, month + offset, 1);
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  };
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <>
      <PageHeader
        title="Calendrier des échéances"
        subtitle={`${events.length} échéance(s) en ${start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}.`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/calendrier?mois=${monthKey(-1)}`}
              className="rounded-full border border-ink-300 px-3 py-1.5 text-[13px] text-esme-800 hover:bg-esme-50"
            >
              Mois précédent
            </Link>
            <Link
              href="/calendrier"
              className="rounded-full border border-ink-300 px-3 py-1.5 text-[13px] text-esme-800 hover:bg-esme-50"
            >
              Aujourd&apos;hui
            </Link>
            <Link
              href={`/calendrier?mois=${monthKey(1)}`}
              className="rounded-full border border-ink-300 px-3 py-1.5 text-[13px] text-esme-800 hover:bg-esme-50"
            >
              Mois suivant
            </Link>
          </div>
        }
      />

      <div className="grid gap-5 p-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} />
          <div className="p-4">
            <div className="grid grid-cols-7 gap-1 text-center">
              {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
                <div key={day} className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {day}
                </div>
              ))}
              {cells.map((day, index) => {
                const dayEvents = day ? byDay.get(day) ?? [] : [];
                const isToday = isCurrentMonth && day === today.getDate();
                return (
                  <div
                    key={index}
                    className={cx(
                      "min-h-20 rounded-lg border p-1.5 text-left",
                      day === null ? "border-transparent" : "border-ink-200 bg-white",
                      isToday ? "ring-2 ring-framboise-300" : "",
                    )}
                  >
                    {day !== null ? (
                      <>
                        <span className={cx("text-[11px] tabular-nums", isToday ? "font-semibold text-framboise-600" : "text-ink-400")}>
                          {day}
                        </span>
                        <ul className="mt-0.5 space-y-0.5">
                          {dayEvents.slice(0, 3).map((event, position) => (
                            <li key={position}>
                              <Link
                                href={event.href}
                                title={`${event.label} — ${event.sub}`}
                                className={cx(
                                  "block truncate rounded px-1 py-0.5 text-[10px] leading-tight",
                                  event.kind === "depot"
                                    ? "bg-framboise-100 text-framboise-700"
                                    : event.kind === "negociation"
                                      ? "bg-mauve-300/30 text-violet-700"
                                      : "bg-esme-100 text-esme-700",
                                )}
                              >
                                {event.label}
                              </Link>
                            </li>
                          ))}
                          {dayEvents.length > 3 ? (
                            <li className="px-1 text-[10px] text-ink-400">+{dayEvents.length - 3}</li>
                          ) : null}
                        </ul>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-ink-600">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-framboise-100 ring-1 ring-framboise-300" aria-hidden />
                Date limite de dépôt
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-esme-100 ring-1 ring-esme-300" aria-hidden />
                Jalon de préparation
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-mauve-300/30 ring-1 ring-mauve-400" aria-hidden />
                Négociation
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Échéances du mois" subtitle="Par ordre chronologique." />
          {events.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Aucune échéance ce mois-ci" />
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {events.map((event, index) => {
                const remaining = daysUntil(event.date);
                return (
                  <li key={index}>
                    <Link href={event.href} className="block px-5 py-3 hover:bg-esme-50/60">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-esme-900">{event.label}</p>
                          <p className="mt-0.5 truncate text-[12px] text-ink-500">{event.sub}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[12px] tabular-nums text-ink-700">{formatDate(event.date)}</p>
                          {remaining !== null ? (
                            <Badge tone={remaining < 0 ? "danger" : remaining <= 3 ? "danger" : remaining <= 10 ? "warn" : "neutral"} className="mt-0.5">
                              {remaining < 0 ? `échue` : remaining === 0 ? "aujourd'hui" : `J-${remaining}`}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {event.demo ? <Badge tone="warn" className="mt-1">Démonstration</Badge> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
