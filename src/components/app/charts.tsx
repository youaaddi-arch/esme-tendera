"use client";

import { useId, useState } from "react";

import { cx } from "@/components/ui";

/**
 * Graphiques du tableau de bord.
 *
 * Choix de couleur, documenté parce qu'il est contraignant : la charte ESME ne
 * contient que des teintes comprises entre le bleu et le magenta (bleu #174290,
 * framboise #EB63A0, violets et prunes). Testée avec le validateur de palette,
 * toute série catégorielle de trois couleurs issue de cette gamme échoue à la
 * séparation pour les daltonismes protan et deutan — et deux d'entre elles sont
 * déjà difficiles à distinguer en vision normale.
 *
 * Plutôt que d'introduire une couleur étrangère à la charte, les graphiques
 * n'utilisent donc qu'une seule teinte, et portent l'identité par le texte :
 * barres classées avec leur valeur écrite à côté, série unique en aire, et
 * jauges nommées pour les trois scores de matching. Aucune information n'est
 * portée par la couleur seule.
 */

const AXIS = "var(--color-ink-300)";
const INK_MUTED = "var(--color-ink-500)";

// ---------------------------------------------------------------------------
// Barres classées — répartition par domaine, par acheteur, entonnoir pipeline
// ---------------------------------------------------------------------------

export type RankedDatum = { label: string; value: number; hint?: string; href?: string };

export function RankedBars({
  data,
  max,
  unit = "",
  emphasisIndex,
  emptyLabel = "Aucune donnée sur la période.",
}: {
  data: RankedDatum[];
  /** Référence de l'échelle. Par défaut, la plus grande valeur. */
  max?: number;
  unit?: string;
  /** Index mis en avant ; les autres passent en gris de recul. */
  emphasisIndex?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[13px] text-ink-500">{emptyLabel}</p>;
  }
  const ceiling = Math.max(max ?? 0, ...data.map((item) => item.value), 1);

  return (
    <ol className="space-y-2.5">
      {data.map((item, index) => {
        const share = (item.value / ceiling) * 100;
        const recessive = emphasisIndex !== undefined && emphasisIndex !== index;
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink-700" title={item.label}>
                {item.label}
              </span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-esme-900">
                {formatValue(item.value)}
                {unit ? <span className="ml-0.5 font-normal text-ink-500">{unit}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className={cx(
                  "h-full rounded-full transition-[width] duration-500",
                  recessive ? "bg-ink-300" : "bg-esme-500",
                )}
                style={{ width: `${Math.max(share, item.value > 0 ? 2 : 0)}%` }}
              />
            </div>
            {item.hint ? <p className="mt-0.5 text-[11px] text-ink-500">{item.hint}</p> : null}
          </>
        );

        return (
          <li key={`${item.label}-${index}`}>
            {item.href ? (
              <a href={item.href} className="block rounded-lg px-1 py-0.5 hover:bg-esme-50">
                {row}
              </a>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Entonnoir du pipeline
// ---------------------------------------------------------------------------

export function PipelineFunnel({
  steps,
}: {
  steps: { label: string; value: number; href?: string }[];
}) {
  const ceiling = Math.max(...steps.map((step) => step.value), 1);

  return (
    <ol className="space-y-1.5">
      {steps.map((step, index) => {
        const width = Math.max((step.value / ceiling) * 100, step.value > 0 ? 6 : 2);
        const previous = index > 0 ? steps[index - 1].value : null;
        // Rapport entre les effectifs de deux étapes voisines. C'est un rapport
        // de stocks à un instant donné, pas un taux de conversion : il peut
        // dépasser 100 % quand l'étape aval s'est remplie avant l'étape amont.
        const ratio =
          previous && previous > 0 ? Math.round((step.value / previous) * 100) : null;

        const body = (
          <div className="flex items-center gap-3">
            <div className="h-7 flex-1 overflow-hidden rounded-md bg-ink-100">
              <div
                className="flex h-full items-center rounded-md bg-esme-500/90 px-2 transition-[width] duration-500"
                style={{ width: `${width}%` }}
              >
                {step.value > 0 ? (
                  <span className="text-[11px] font-semibold tabular-nums text-white">{step.value}</span>
                ) : null}
              </div>
            </div>
            <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-ink-500">
              {ratio === null ? "" : `${ratio} %`}
            </span>
          </div>
        );

        return (
          <li key={step.label}>
            <div className="mb-0.5 flex items-baseline justify-between">
              <span className="text-[12px] text-ink-600">{step.label}</span>
              {step.value === 0 ? <span className="text-[11px] text-ink-400">0</span> : null}
            </div>
            {step.href ? (
              <a href={step.href} className="block rounded-md hover:opacity-90">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Évolution hebdomadaire — série unique, aire + ligne, repère au survol
// ---------------------------------------------------------------------------

export type TrendPoint = { label: string; value: number };

export function TrendArea({
  points,
  height = 160,
  valueLabel = "consultations",
}: {
  points: TrendPoint[];
  height?: number;
  valueLabel?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-[13px] text-ink-500">
        Pas encore assez d&apos;historique pour tracer une évolution.
      </p>
    );
  }

  const width = 560;
  const padding = { top: 12, right: 12, bottom: 26, left: 32 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const ceiling = Math.max(...points.map((point) => point.value), 1);

  const x = (index: number) => padding.left + (index / (points.length - 1)) * plotWidth;
  const y = (value: number) => padding.top + plotHeight - (value / ceiling) * plotHeight;

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${padding.top + plotHeight} L${x(0)},${padding.top + plotHeight} Z`;

  // Trois repères horizontaux suffisent : la grille reste en retrait.
  const ticks = [0, Math.round(ceiling / 2), ceiling];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Évolution du nombre de ${valueLabel} par semaine`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-esme-500)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-esme-500)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} stroke={AXIS} strokeWidth="1" strokeDasharray="2 4" />
            <text x={padding.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize="10" fill={INK_MUTED}>
              {tick}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="var(--color-esme-500)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((point, index) => (
          <g key={point.label}>
            {hover === index ? (
              <line x1={x(index)} x2={x(index)} y1={padding.top} y2={padding.top + plotHeight} stroke="var(--color-framboise-400)" strokeWidth="1" />
            ) : null}
            <circle
              cx={x(index)}
              cy={y(point.value)}
              r={hover === index ? 5 : 3.5}
              fill="var(--color-esme-500)"
              stroke="white"
              strokeWidth="2"
            />
            {/* Cible de survol plus large que le point lui-même. */}
            <rect
              x={x(index) - plotWidth / (points.length * 2)}
              y={padding.top}
              width={plotWidth / points.length}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            >
              <title>{`${point.label} : ${point.value} ${valueLabel}`}</title>
            </rect>
            {index % Math.ceil(points.length / 6) === 0 || index === points.length - 1 ? (
              <text x={x(index)} y={height - 8} textAnchor="middle" fontSize="10" fill={INK_MUTED}>
                {point.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      {hover !== null ? (
        <p className="mt-1 text-center text-[12px] text-ink-600">
          <span className="font-semibold text-esme-900">{points[hover].value}</span> {valueLabel} —{" "}
          {points[hover].label}
        </p>
      ) : (
        <p className="mt-1 text-center text-[12px] text-ink-400">Survolez la courbe pour le détail.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jauges de score — les trois scores de matching
// ---------------------------------------------------------------------------

export function ScoreGauges({
  scores,
  weights,
}: {
  scores: { label: string; value: number; detail?: string }[];
  weights?: Record<string, number>;
}) {
  return (
    <ul className="space-y-3">
      {scores.map((score) => (
        <li key={score.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-ink-700">
              {score.label}
              {weights?.[score.label] !== undefined ? (
                <span className="ml-1.5 text-[11px] text-ink-400">
                  pondération {Math.round(weights[score.label])} %
                </span>
              ) : null}
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-esme-900">
              {Math.round(score.value)}
              <span className="font-normal text-ink-400">/100</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-esme-500 transition-[width] duration-500"
              style={{ width: `${Math.max(0, Math.min(100, score.value))}%` }}
            />
          </div>
          {score.detail ? <p className="mt-0.5 text-[11px] text-ink-500">{score.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000).toLocaleString("fr-FR")} k`;
  return value.toLocaleString("fr-FR");
}
