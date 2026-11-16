"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, FileText, Layers, Paperclip, User } from "lucide-react";
import type { PipelineStage } from "@prisma/client";

import { Badge, Notice, ScorePill, cx } from "@/components/ui";
import { moveTenderAction, noGoAction } from "@/app/(app)/pipeline/actions";
import {
  allowedTransitions, boardColumnHints, boardColumnLabels, boardColumnOf, boardColumnOrder,
  boardColumnStage, dceStatusLabels, formatAmount, formatDeadline, goNoGoLabels,
  natureLabels, natureTone, transitionGuards, type BoardColumnKey,
} from "@/lib/labels";

export type KanbanCard = {
  id: string;
  reference: string;
  title: string;
  buyer: string;
  consultationRef: string | null;
  lotLabel: string | null;
  amountKind: string;
  amountMin: number | null;
  amountMax: number | null;
  publishedAt: string | null;
  deadlineAt: string | null;
  stage: PipelineStage;
  goNoGo: string;
  dceStatus: string;
  isDemo: boolean;
  ownerName: string | null;
  scoreGlobal: number | null;
  /** 1 catalogue, 2 voisine, 3 IONIS. */
  rang: number | null;
  nature: string | null;
  domain: string | null;
  lotCount: number;
  documentCount: number;
};

export function KanbanBoard({
  cards,
  canMove,
}: {
  cards: KanbanCard[];
  canMove: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragged, setDragged] = useState<KanbanCard | null>(null);
  const [hoverColumn, setHoverColumn] = useState<BoardColumnKey | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "ok"; text: string } | null>(null);
  // Déplacement optimiste : la carte bouge tout de suite, et revient si le
  // serveur refuse.
  //
  // C'est la colonne visée qui est mémorisée, et non l'étape, parce que les
  // deux ne se déduisent plus l'une de l'autre : « No Go » et « Abandonnées
  // sans décision » rangent l'affaire à la même étape et restent deux
  // colonnes distinctes. Mémoriser l'étape faisait atterrir une carte lâchée
  // sur « No Go » dans la colonne voisine, le temps d'un aller-retour serveur.
  const [optimistic, setOptimistic] = useState<Record<string, BoardColumnKey>>({});

  const effectiveStage = (card: KanbanCard): PipelineStage => {
    const column = optimistic[card.id];
    return column ? boardColumnStage[column] : card.stage;
  };

  const effectiveColumn = (card: KanbanCard): BoardColumnKey =>
    optimistic[card.id] ?? boardColumnOf({ stage: card.stage, goNoGo: card.goNoGo as never });

  const columns = boardColumnOrder.map((column) => ({
    column,
    cards: cards.filter((card) => effectiveColumn(card) === column),
  }));

  /**
   * Avertissements affichés sur une colonne pendant le glissement.
   *
   * « No Go » accepte le dépôt, et c'est une correction. La colonne le
   * refusait au motif que la décision exige un motif ; le motif n'est plus
   * exigé, et le refus ne protégeait plus rien — il rendait seulement la
   * colonne inerte, visible mais inatteignable, si bien qu'on la croyait
   * absente. Lâcher une carte ici enregistre un NO GO au nom de qui l'a
   * lâchée, sans motif, et la fiche permet de le compléter ou de rouvrir.
   */
  const DROP_WARNINGS: Partial<Record<BoardColumnKey, string>> = {
    NO_GO: "Enregistre un NO GO sans motif, à votre nom. Complétez-le ou rouvrez depuis la fiche.",
  };

  const canDrop = (column: BoardColumnKey) => {
    if (!dragged || !canMove) return false;
    if (effectiveColumn(dragged) === column) return false;
    const from = effectiveStage(dragged);
    const to = boardColumnStage[column];
    return from === to || (allowedTransitions[from] ?? []).includes(to);
  };

  function handleDrop(column: BoardColumnKey) {
    const card = dragged;
    setDragged(null);
    setHoverColumn(null);
    if (!card) return;

    const target = boardColumnStage[column];
    if (effectiveColumn(card) === column) return;

    setOptimistic((current) => ({ ...current, [card.id]: column }));
    setMessage(null);

    startTransition(async () => {
      // Deux colonnes mènent à la même étape : l'une enregistre une décision,
      // l'autre range l'affaire. Le serveur fait la différence, pas l'interface.
      const result =
        column === "NO_GO" ? await noGoAction(card.id) : await moveTenderAction(card.id, target);
      if (!result.ok) {
        setOptimistic((current) => {
          const next = { ...current };
          delete next[card.id];
          return next;
        });
        setMessage({ tone: "danger", text: result.error });
        return;
      }
      setMessage({
        tone: "ok",
        text:
          column === "NO_GO"
            ? `${card.reference} : NO GO enregistré, sans motif. Elle reste rouvrable depuis la fiche.`
            : `${card.reference} déplacée vers « ${boardColumnLabels[column]} ».`,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {message ? (
        <div className="px-6 pt-4">
          <Notice tone={message.tone === "ok" ? "ok" : "danger"}>
            <div className="flex items-start justify-between gap-3">
              <span>{message.text}</span>
              <button
                type="button"
                onClick={() => setMessage(null)}
                className="shrink-0 text-[12px] underline"
              >
                Fermer
              </button>
            </div>
          </Notice>
        </div>
      ) : null}

      {/* Défilement horizontal : onze colonnes ne tiennent pas sur un écran. */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="flex h-full min-h-[70vh] gap-3">
          {columns.map(({ column, cards: columnCards }) => {
            const droppable = canDrop(column);
            const isTarget = hoverColumn === column && droppable;
            const stage = boardColumnStage[column];
            return (
              <section
                key={column}
                id={column}
                aria-label={boardColumnLabels[column]}
                className={cx(
                  "flex w-[272px] shrink-0 flex-col rounded-xl border bg-ink-50/70 transition-colors",
                  isTarget ? "kanban-drop-active border-framboise-300" : "border-ink-200",
                  dragged && !droppable ? "opacity-55" : "",
                )}
                onDragOver={(event) => {
                  if (!droppable) return;
                  event.preventDefault();
                  setHoverColumn(column);
                }}
                onDragLeave={() => setHoverColumn((current) => (current === column ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(column);
                }}
              >
                <header className="border-b border-ink-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate text-[12px] font-semibold uppercase tracking-wide text-ink-600">
                      {boardColumnLabels[column]}
                    </h2>
                    <span className="shrink-0 rounded-full bg-white px-1.5 text-[11px] font-semibold tabular-nums text-ink-600 ring-1 ring-ink-200">
                      {columnCards.length}
                    </span>
                  </div>
                  {boardColumnHints[column] ? (
                    <p className="mt-1 text-[11px] leading-snug text-ink-500">{boardColumnHints[column]}</p>
                  ) : null}
                </header>

                {DROP_WARNINGS[column] && dragged && droppable ? (
                  <p className="border-b border-ink-200 bg-warn-50 px-3 py-1.5 text-[11px] leading-snug text-warn-700">
                    {DROP_WARNINGS[column]}
                  </p>
                ) : transitionGuards[stage] && dragged && droppable && effectiveStage(dragged) !== stage ? (
                  <p className="border-b border-ink-200 bg-warn-50 px-3 py-1.5 text-[11px] leading-snug text-warn-700">
                    {transitionGuards[stage]}
                  </p>
                ) : null}

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {columnCards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[12px] text-ink-400">Aucune affaire</p>
                  ) : (
                    columnCards.map((card) => (
                      <TenderCard
                        key={card.id}
                        card={card}
                        draggable={canMove}
                        dragging={dragged?.id === card.id}
                        onDragStart={() => setDragged(card)}
                        onDragEnd={() => {
                          setDragged(null);
                          setHoverColumn(null);
                        }}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TenderCard({
  card,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  card: KanbanCard;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const deadline = formatDeadline(card.deadlineAt);
  const amount = formatAmount(
    card.amountKind as never,
    card.amountMin,
    card.amountMax,
  );

  return (
    <article
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cx(
        "rounded-lg border border-ink-200 bg-white p-3 shadow-[0_1px_2px_rgb(17_27_69/0.04)] transition-shadow",
        draggable ? "cursor-grab active:cursor-grabbing" : "",
        dragging ? "opacity-45" : "hover:shadow-[0_2px_4px_rgb(17_27_69/0.06),0_14px_30px_-16px_rgb(17_27_69/0.22)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-400">{card.reference}</span>
        {card.scoreGlobal !== null ? (
          <ScorePill value={card.scoreGlobal} size="sm" rang={card.rang} />
        ) : null}
      </div>

      <Link href={`/affaires/${card.id}`} className="mt-1 block">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-esme-900 hover:text-esme-600">
          {card.title}
        </h3>
      </Link>

      <p className="mt-1 line-clamp-1 text-[12px] text-ink-500" title={card.buyer}>
        {card.buyer}
      </p>

      <dl className="mt-2 space-y-1 text-[11px] text-ink-600">
        {card.consultationRef || card.lotLabel ? (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Consultation</dt>
            <dd className="truncate">
              {card.consultationRef ?? ""}
              {card.consultationRef && card.lotLabel ? " · " : ""}
              {card.lotLabel ?? ""}
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <dt className="sr-only">Montant</dt>
          <dd className={amount === "Non communiqué" ? "text-ink-400" : "font-medium text-ink-700"}>{amount}</dd>
          <Badge tone={deadline.tone === "ok" ? "neutral" : deadline.tone}>{deadline.text}</Badge>
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {card.isDemo ? <Badge tone="warn">Démonstration</Badge> : null}
        {card.nature ? (
          <Badge tone={natureTone(card.nature as never)}>
            {natureLabels[card.nature as never]}
          </Badge>
        ) : null}
        {card.domain ? <Badge tone="esme">{card.domain}</Badge> : null}
        {card.goNoGo !== "A_DECIDER" ? (
          <Badge tone={card.goNoGo === "GO" ? "ok" : "danger"}>{goNoGoLabels[card.goNoGo as never]}</Badge>
        ) : null}
        {card.dceStatus === "NON_RECUPERE" ? (
          <Badge tone="danger">
            <AlertCircle className="size-3" aria-hidden />
            DCE non récupéré
          </Badge>
        ) : card.documentCount > 0 ? (
          <Badge tone="neutral">
            <Paperclip className="size-3" aria-hidden />
            {card.documentCount}
          </Badge>
        ) : (
          <Badge tone="neutral">
            <FileText className="size-3" aria-hidden />
            {dceStatusLabels[card.dceStatus as never]}
          </Badge>
        )}
        {card.lotCount > 0 ? (
          <Badge tone="neutral">
            <Layers className="size-3" aria-hidden />
            {card.lotCount} lot{card.lotCount > 1 ? "s" : ""}
          </Badge>
        ) : null}
      </div>

      {card.ownerName ? (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-500">
          <User className="size-3" aria-hidden />
          {card.ownerName}
        </p>
      ) : null}
    </article>
  );
}
