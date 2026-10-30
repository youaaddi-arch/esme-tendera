import Link from "next/link";

import { KanbanBoard, type KanbanCard } from "@/components/app/kanban";
import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import type { Prisma } from "@prisma/client";

import { natureLabels } from "@/lib/labels";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

/**
 * Borne de date issue du formulaire.
 *
 * Une date limite se compare à une journée entière : saisir le 15 pour une
 * borne haute doit inclure le 15, pas s'arrêter à minuit ce jour-là.
 */
function dayStart(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dayEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Ordre de tri demandé.
 *
 * Les valeurs absentes sont rejetées en fin de liste dans tous les cas : une
 * affaire sans montant publié n'est pas une affaire à zéro euro, et la faire
 * remonter en tête d'un tri décroissant donnerait à une information manquante
 * l'apparence d'une information.
 */
function ordreDeTri(tri?: string): Prisma.TenderOrderByWithRelationInput[] {
  switch (tri) {
    case "publication":
      return [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "montant":
      return [{ amountMaxEur: { sort: "desc", nulls: "last" } }, { deadlineAt: "asc" }];
    case "score":
      return [{ matchResult: { scoreGlobal: "desc" } }, { deadlineAt: "asc" }];
    default:
      return [{ deadlineAt: "asc" }, { createdAt: "desc" }];
  }
}

/** Champ de date compact, avec sa borne en légende. */
function DateInput({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[11px] text-ink-500">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value ?? ""}
        className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm text-ink-800"
      />
    </label>
  );
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; responsable?: string; archivees?: string;
    publieDu?: string; publieAu?: string; limiteDu?: string; limiteAu?: string;
    nature?: string; domaine?: string; tri?: string;
  }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const showArchived = params.archivees === "1";

  const publieDu = dayStart(params.publieDu);
  const publieAu = dayEnd(params.publieAu);
  const limiteDu = dayStart(params.limiteDu);
  const limiteAu = dayEnd(params.limiteAu);

  const [tenders, domains, owners] = await Promise.all([
    prisma.tender.findMany({
    where: {
      archived: showArchived ? undefined : false,
      ...(params.responsable ? { ownerId: params.responsable } : {}),
      ...(publieDu || publieAu
        ? { publishedAt: { ...(publieDu ? { gte: publieDu } : {}), ...(publieAu ? { lte: publieAu } : {}) } }
        : {}),
      ...(limiteDu || limiteAu
        ? { deadlineAt: { ...(limiteDu ? { gte: limiteDu } : {}), ...(limiteAu ? { lte: limiteAu } : {}) } }
        : {}),
      // Appréciation et domaine portent tous deux sur le résultat de matching :
      // ils se combinent dans une seule condition. Deux conditions séparées
      // seraient deux clés homonymes dans le même objet, et la seconde
      // écraserait la première — croiser les deux filtres n'aurait appliqué
      // que le dernier.
      //
      // « Pas encore évaluée » est un cas à part : l'affaire n'a aucun
      // résultat, ce qui n'est pas la même chose qu'un résultat hors champ.
      ...(params.nature === "AUCUNE"
        ? { matchResult: { is: null } }
        : params.nature || params.domaine
          ? {
              matchResult: {
                is: {
                  ...(params.nature ? { nature: params.nature as never } : {}),
                  ...(params.domaine ? { topDomainSlug: params.domaine } : {}),
                },
              },
            }
          : {}),
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
    orderBy: ordreDeTri(params.tri),
    select: {
      id: true, reference: true, title: true, buyer: true, consultationRef: true,
      lotLabel: true, amountKind: true, amountMinEur: true, amountMaxEur: true,
      publishedAt: true, deadlineAt: true, stage: true, goNoGo: true, dceStatus: true,
      isDemo: true,
      owner: { select: { name: true } },
      // Le domaine est lu sur le résultat lui-même plutôt que par une
      // sous-requête sur la meilleure fiche : c'est la même valeur que celle
      // sur laquelle porte le filtre, et cela évite une jointure par affaire.
      matchResult: { select: { scoreGlobal: true, nature: true, topDomainName: true } },
      _count: { select: { lots: true, documents: true } },
    },
    }),
    prisma.trainingDomain.findMany({ select: { slug: true, name: true }, orderBy: { position: "asc" } }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Une fenêtre de veille de trente jours ramène aussi des avis dont la date
  // limite est passée. Ils restent consultables, mais ne doivent pas occuper
  // le haut des colonnes : on classe d'abord ce qui est encore à jouer.
  //
  // Ce reclassement ne vaut que pour le tri par échéance. Demander un tri par
  // montant et recevoir un ordre qui dépend d'abord des dates serait un tri
  // qui ment sur ce qu'il fait : les autres tris sont donc laissés tels quels.
  const now = new Date();
  const ordered = params.tri && params.tri !== "echeance"
    ? tenders
    : [...tenders].sort((a, b) => {
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
    domain: tender.matchResult?.topDomainName ?? null,
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

      {/*
        Barre de filtres.

        Un formulaire GET : les filtres vivent dans l'URL, donc une sélection
        se partage par lien et survit au rechargement. Les champs vides ne sont
        pas envoyés, l'URL reste lisible.
      */}
      <form method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-200 bg-white px-6 py-3">
        <label className="min-w-56 flex-1">
          <span className="mb-1 block text-[12px] font-medium text-ink-700">Recherche</span>
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Marché, acheteur, référence…"
            className="h-9 w-full rounded-lg border border-ink-300 px-3 text-sm placeholder:text-ink-400 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25"
          />
        </label>

        <fieldset className="flex items-end gap-1.5">
          <legend className="mb-1 text-[12px] font-medium text-ink-700">Publication</legend>
          <DateInput name="publieDu" label="du" value={params.publieDu} />
          <DateInput name="publieAu" label="au" value={params.publieAu} />
        </fieldset>

        <fieldset className="flex items-end gap-1.5">
          <legend className="mb-1 text-[12px] font-medium text-ink-700">Date limite de dépôt</legend>
          <DateInput name="limiteDu" label="du" value={params.limiteDu} />
          <DateInput name="limiteAu" label="au" value={params.limiteAu} />
        </fieldset>

        <label>
          <span className="mb-1 block text-[12px] font-medium text-ink-700">Matching</span>
          <select
            name="nature"
            defaultValue={params.nature ?? ""}
            className="h-9 max-w-52 rounded-lg border border-ink-300 bg-white px-2 text-sm"
          >
            <option value="">Toutes appréciations</option>
            {Object.entries(natureLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
            <option value="AUCUNE">Pas encore évaluée</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[12px] font-medium text-ink-700">Domaine</span>
          <select
            name="domaine"
            defaultValue={params.domaine ?? ""}
            className="h-9 max-w-48 rounded-lg border border-ink-300 bg-white px-2 text-sm"
          >
            <option value="">Tous</option>
            {domains.map((domain) => (
              <option key={domain.slug} value={domain.slug}>{domain.name}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[12px] font-medium text-ink-700">Trier par</span>
          <select
            name="tri"
            defaultValue={params.tri ?? ""}
            className="h-9 max-w-48 rounded-lg border border-ink-300 bg-white px-2 text-sm"
          >
            <option value="">Date limite de dépôt</option>
            <option value="publication">Date de publication</option>
            <option value="montant">Montant</option>
            <option value="score">Score de matching</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[12px] font-medium text-ink-700">Responsable</span>
          <select
            name="responsable"
            defaultValue={params.responsable ?? ""}
            className="h-9 max-w-44 rounded-lg border border-ink-300 bg-white px-2 text-sm"
          >
            <option value="">Tous</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 pb-2 text-[13px] text-ink-700">
          <input
            type="checkbox"
            name="archivees"
            value="1"
            defaultChecked={showArchived}
            className="size-4 accent-[var(--color-esme-600)]"
          />
          Archives
        </label>

        <button
          type="submit"
          className="h-9 rounded-full bg-esme-600 px-4 text-sm font-medium text-white hover:bg-esme-700"
        >
          Filtrer
        </button>
        <Link href="/pipeline" className="pb-2 text-[13px] text-esme-600 hover:underline">
          Réinitialiser
        </Link>
      </form>

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
