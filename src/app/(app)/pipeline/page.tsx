import Link from "next/link";

import { KanbanBoard, type KanbanCard } from "@/components/app/kanban";
import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; responsable?: string; archivees?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const showArchived = params.archivees === "1";

  const tenders = await prisma.tender.findMany({
    where: {
      archived: showArchived ? undefined : false,
      ...(params.responsable ? { ownerId: params.responsable } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: "insensitive" } },
              { buyer: { contains: params.q, mode: "insensitive" } },
              { reference: { contains: params.q, mode: "insensitive" } },
              { consultationRef: { contains: params.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, reference: true, title: true, buyer: true, consultationRef: true,
      lotLabel: true, amountKind: true, amountMinEur: true, amountMaxEur: true,
      publishedAt: true, deadlineAt: true, stage: true, goNoGo: true, dceStatus: true,
      isDemo: true,
      owner: { select: { name: true } },
      matchResult: {
        select: {
          scoreGlobal: true,
          nature: true,
          matches: {
            orderBy: { score: "desc" },
            take: 1,
            select: { training: { select: { domain: { select: { name: true } } } } },
          },
        },
      },
      _count: { select: { lots: true, documents: true } },
    },
  });

  // Une fenêtre de veille de trente jours ramène aussi des avis dont la date
  // limite est passée. Ils restent consultables, mais ne doivent pas occuper
  // le haut des colonnes : on classe d'abord ce qui est encore à jouer.
  const now = new Date();
  const ordered = [...tenders].sort((a, b) => {
    const rank = (deadline: Date | null) => {
      if (!deadline) return 1; // date limite inconnue : au milieu
      return deadline >= now ? 0 : 2; // ouverte, puis inconnue, puis échue
    };
    const rankA = rank(a.deadlineAt);
    const rankB = rank(b.deadlineAt);
    if (rankA !== rankB) return rankA - rankB;
    if (!a.deadlineAt || !b.deadlineAt) return 0;
    // Les échéances ouvertes : la plus proche d'abord. Les échues : la plus
    // récente d'abord, car c'est celle qui vient de se fermer.
    return rankA === 2
      ? b.deadlineAt.getTime() - a.deadlineAt.getTime()
      : a.deadlineAt.getTime() - b.deadlineAt.getTime();
  });

  const cards: KanbanCard[] = ordered.map((tender) => ({
    id: tender.id,
    reference: tender.reference,
    title: tender.title,
    buyer: tender.buyer,
    consultationRef: tender.consultationRef,
    lotLabel: tender.lotLabel,
    amountKind: tender.amountKind,
    amountMin: tender.amountMinEur === null ? null : Number(tender.amountMinEur),
    amountMax: tender.amountMaxEur === null ? null : Number(tender.amountMaxEur),
    publishedAt: tender.publishedAt?.toISOString() ?? null,
    deadlineAt: tender.deadlineAt?.toISOString() ?? null,
    stage: tender.stage,
    goNoGo: tender.goNoGo,
    dceStatus: tender.dceStatus,
    isDemo: tender.isDemo,
    ownerName: tender.owner?.name ?? null,
    scoreGlobal: tender.matchResult?.scoreGlobal ?? null,
    nature: tender.matchResult?.nature ?? null,
    domain: tender.matchResult?.matches[0]?.training.domain?.name ?? null,
    lotCount: tender._count.lots,
    documentCount: tender._count.documents,
  }));

  const canMove = can(session.role, "tender.move");

  return (
    <div className="flex h-full min-h-dvh flex-col">
      <PageHeader
        title="Pipeline des appels d'offres"
        subtitle={`${cards.length} affaire${cards.length > 1 ? "s" : ""}. Faites glisser une carte pour changer d'étape ; les transitions interdites sont refusées.`}
        actions={
          <>
            <form method="get" className="flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Rechercher un marché, un acheteur…"
                className="h-9 w-64 rounded-lg border border-ink-300 bg-white px-3 text-sm placeholder:text-ink-400 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25"
              />
              <button
                type="submit"
                className="h-9 rounded-full border border-ink-300 bg-white px-3 text-sm text-esme-800 hover:border-esme-400 hover:bg-esme-50"
              >
                Filtrer
              </button>
            </form>
            <LinkButton href="/affaires" variant="secondary" size="sm">
              Vue tableau
            </LinkButton>
            {can(session.role, "tender.create") ? (
              <LinkButton href="/affaires/nouvelle" size="sm">
                Nouvelle affaire
              </LinkButton>
            ) : null}
          </>
        }
      />

      {!canMove ? (
        <div className="px-6 pt-4">
          <Notice tone="info">
            Votre rôle permet la consultation du pipeline, pas le déplacement des cartes.
          </Notice>
        </div>
      ) : null}

      {cards.length === 0 ? (
        <div className="p-6">
          <Notice tone="info" title="Aucune affaire">
            Lancez une synchronisation depuis la page{" "}
            <Link href="/veille" className="underline">
              Veille
            </Link>
            , ou créez une affaire manuellement à partir d&apos;un lien de consultation.
          </Notice>
        </div>
      ) : (
        <KanbanBoard cards={cards} canMove={canMove} />
      )}
    </div>
  );
}
