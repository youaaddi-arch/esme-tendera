"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, FileText, Layers, Paperclip, User } from "lucide-react";
import type { PipelineStage } from "@prisma/client";

import { Badge, Notice, ScorePill, cx } from "@/components/ui";
import { moveTenderAction } from "@/app/(app)/pipeline/actions";
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
  // serveur refuse la transition.
  const [optimistic, setOptimistic] = useState<Record<string, PipelineStage>>({});

  const effectiveStage = (card: KanbanCard): PipelineStage => optimistic[card.id] ?? card.stage;

  const effectiveColumn = (card: KanbanCard): BoardColumnKey =>
    boardColumnOf({
      stage: effectiveStage(card),
      goNoGo: card.goNoGo as never,
      nature: card.nature as never,
    });

  const columns = boardColumnOrder.map((column) => ({
    column,
    cards: cards.filter((card) => effectiveColumn(card) === column),
  }));

  /**
   * Colonnes qui ne se posent pas, parce que leur contenu n'est pas une étape.
   *
   * « Matching » et « Sans matching » reflètent l'appréciation du moteur : on
   * n'y fait pas glisser une affaire, on corrige l'appréciation depuis la
   * fiche. « Go » et « No Go » reflètent une décision qui exige des éléments
   * qu'un glisser-déposer ne peut pas saisir — les lots visés dans un cas, le
   * motif dans l'autre. Les y déposer silencieusement reviendrait à fabriquer
   * une décision sans justification.
   */
  const DERIVED_COLUMNS: Partial<Record<BoardColumnKey, string>> = {
    MATCHING: "L'appréciation du matching est calculée. Pour la corriger, ouvrez la fiche, onglet Matching.",
    SANS_MATCHING: "L'appréciation du matching est calculée. Pour consigner un motif, ouvrez la fiche, onglet Matching.",
    GO: "Un GO se prend depuis la fiche : il faut indiquer les lots sur lesquels vous vous positionnez.",
    NO_GO: "Un NO GO se prend depuis la fiche : le motif est obligatoire.",
  };

  const canDrop = (column: BoardColumnKey) => {
    if (!dragged || !canMove) return false;
    if (DERIVED_COLUMNS[column]) return false;
    const from = effectiveStage(dragged);
    const to = boardColumnStage[column];
    return from === to || (allowedTransitions[from] ?? []).includes(to);
  };

  function handleDrop(column: BoardColumnKey) {
    const card = dragged;
    setDragged(null);
    setHoverColumn(null);
    if (!card) return;

    const refusal = DERIVED_COLUMNS[column];
    if (refusal) {
      setMessage({ tone: "danger", text: refusal });
      return;
    }

    const target = boardColumnStage[column];
    if (effectiveStage(card) === target) return;

    setOptimistic((current) => ({ ...current, [card.id]: target }));
    setMessage(null);

    startTransition(async () => {
      const result = await moveTenderAction(card.id, target);
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
        text: `${card.reference} déplacée vers « ${boardColumnLabels[column]} ».`,
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

                {DERIVED_COLUMNS[column] && dragged ? (
                  <p className="border-b border-ink-200 bg-ink-100 px-3 py-1.5 text-[11px] leading-snug text-ink-600">
                    {DERIVED_COLUMNS[column]}
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
        {card.scoreGlobal !== null ? <ScorePill value={card.scoreGlobal} size="sm" /> : null}
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
