import Link from "next/link";

import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { formatDateTime } from "@/lib/labels";

export const metadata = { title: "Journal d'audit" };
export const dynamic = "force-dynamic";

/**
 * Journal d'audit global.
 *
 * Conserve qui a fait quoi sur quelle entité. Il n'est pas modifiable depuis
 * l'interface : c'est ce qui lui donne sa valeur de trace.
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ acteur?: string; action?: string; page?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "audit.read")) {
    return (
      <>
        <PageHeader title="Journal d'audit" />
        <div className="p-6">
          <Notice tone="danger">Votre rôle ne permet pas de consulter le journal d&apos;audit.</Notice>
        </div>
      </>
    );
  }

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 100;

  const where = {
    ...(params.acteur ? { actor: params.acteur } : {}),
    ...(params.action ? { action: { startsWith: params.action } } : {}),
  };

  const [events, total, actions] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true, email: true } },
        tender: { select: { id: true, reference: true } },
      },
    }),
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({ distinct: ["action"], select: { action: true }, take: 60 }),
  ]);

  const pages = Math.ceil(total / pageSize);
  const families = [...new Set(actions.map((row) => row.action.split(".")[0]))].sort();

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        subtitle={`${total} événement(s) enregistré(s). Page ${page} sur ${Math.max(pages, 1)}.`}
      />

      <div className="space-y-5 p-6">
        <Card>
          <form method="get" className="flex flex-wrap items-end gap-3 p-4">
            <label>
              <span className="mb-1 block text-[12px] font-medium text-ink-700">Acteur</span>
              <select name="acteur" defaultValue={params.acteur ?? ""} className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm">
                <option value="">Tous</option>
                <option value="utilisateur">Utilisateur</option>
                <option value="veille">Veille</option>
                <option value="moteur-ia">Moteur</option>
                <option value="systeme">Système</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[12px] font-medium text-ink-700">Famille d&apos;action</span>
              <select name="action" defaultValue={params.action ?? ""} className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm">
                <option value="">Toutes</option>
                {families.map((family) => (
                  <option key={family} value={family}>{family}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-9 rounded-full bg-esme-600 px-4 text-sm font-medium text-white hover:bg-esme-700">
              Filtrer
            </button>
            <Link href="/admin/journal" className="pb-2 text-[13px] text-esme-600 hover:underline">Réinitialiser</Link>
          </form>
        </Card>

        {events.length === 0 ? (
          <EmptyState title="Aucun événement" description="Le journal se remplit à la première action." />
        ) : (
          <Card>
            <CardHeader title="Événements" />
            <ol className="divide-y divide-ink-100">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <time className="font-mono text-[11px] text-ink-400">{formatDateTime(event.createdAt)}</time>
                    <Badge tone={event.actor === "veille" ? "esme" : event.actor === "moteur-ia" ? "violet" : "neutral"}>
                      {event.actor}
                    </Badge>
                    <span className="font-mono text-[11px] text-ink-500">{event.action}</span>
                    {event.tender ? (
                      <Link href={`/affaires/${event.tender.id}`} className="text-[11px] text-esme-600 hover:underline">
                        {event.tender.reference}
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-800">{event.summary}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    {event.user ? `${event.user.name} (${event.user.email})` : "Système"} · {event.entity}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {pages > 1 ? (
          <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
            {page > 1 ? (
              <Link
                href={`/admin/journal?page=${page - 1}${params.acteur ? `&acteur=${params.acteur}` : ""}${params.action ? `&action=${params.action}` : ""}`}
                className="rounded-full border border-ink-300 px-3 py-1.5 text-[13px] text-esme-800 hover:bg-esme-50"
              >
                Page précédente
              </Link>
            ) : null}
            <span className="text-[13px] text-ink-500">{page} / {pages}</span>
            {page < pages ? (
              <Link
                href={`/admin/journal?page=${page + 1}${params.acteur ? `&acteur=${params.acteur}` : ""}${params.action ? `&action=${params.action}` : ""}`}
                className="rounded-full border border-ink-300 px-3 py-1.5 text-[13px] text-esme-800 hover:bg-esme-50"
              >
                Page suivante
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
