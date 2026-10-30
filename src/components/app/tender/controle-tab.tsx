"use client";

import { AlertOctagon, ShieldCheck } from "lucide-react";

import { ActionButton } from "@/components/app/action-form";
import { Badge, Card, CardHeader, EmptyState, Meter, Notice } from "@/components/ui";
import { runQualityAction } from "@/app/(app)/affaires/[id]/actions";
import { formatDateTime } from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

type Blocker = { severite: "bloquant" | "majeur"; sujet: string; detail: string; documentCible: string | null };
type Correction = { probleme: string; risque: string; correction: string; documentCible: string | null; applique: boolean };
type Breakdown = { rubrique: string; note: number; commentaire: string };

/**
 * Contrôle de complétude, de qualité et de conformité.
 *
 * Les trois notes sont affichées séparément et ne sont jamais moyennées entre
 * elles : un dossier peut être complet à 95 % et rester irrégulier.
 */
export function ControleTab({ tender, permissions }: { tender: TenderDetail; permissions: Permission[] }) {
  const canRun = permissions.includes("quality.run");
  const latest = tender.qualityReviews[0];

  if (!latest) {
    return (
      <Card>
        <CardHeader title="Contrôle du dossier" />
        <div className="p-5">
          <EmptyState
            title="Aucun contrôle n'a été lancé"
            description="Le contrôle compare le dossier préparé aux exigences du règlement de consultation et aux critères d'attribution."
            action={
              canRun ? (
                <ActionButton
                  action={() => runQualityAction(tender.id)}
                  label="Analyser le dossier"
                  variant="primary"
                  size="md"
                  icon={<ShieldCheck className="size-4" aria-hidden />}
                />
              ) : null
            }
          />
        </div>
      </Card>
    );
  }

  const blockers = (latest.blockers as unknown as Blocker[]) ?? [];
  const corrections = (latest.corrections as unknown as Correction[]) ?? [];
  const breakdown = (latest.breakdown as unknown as Breakdown[]) ?? [];
  const blocking = blockers.filter((blocker) => blocker.severite === "bloquant");

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {/* --- Alertes prioritaires : avant tout le reste --- */}
        {blocking.length > 0 ? (
          <Card className="border-danger-200">
            <CardHeader
              title={`${blocking.length} alerte(s) bloquante(s)`}
              subtitle="Une pièce obligatoire manquante ou une non-conformité éliminatoire prime sur le niveau des scores."
              action={<AlertOctagon className="size-5 text-danger-500" aria-hidden />}
            />
            <ul className="divide-y divide-ink-100">
              {blocking.map((blocker, index) => (
                <li key={index} className="px-5 py-3">
                  <p className="text-[13px] font-semibold text-danger-700">{blocker.sujet}</p>
                  <p className="mt-0.5 text-[12px] text-ink-700">{blocker.detail}</p>
                  {blocker.documentCible ? (
                    <Badge tone="neutral" className="mt-1.5">{blocker.documentCible}</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Notice tone="ok" title="Aucune alerte bloquante">
            Aucune pièce obligatoire manquante ni non-conformité éliminatoire n&apos;a été détectée au
            dernier contrôle. Ce constat porte sur ce qui a été saisi dans TENDERA : il ne vaut pas
            vérification juridique du dossier.
          </Notice>
        )}

        {/* --- Détail par rubrique --- */}
        <Card>
          <CardHeader title="Détail par rubrique" />
          <ul className="divide-y divide-ink-100">
            {breakdown.map((item, index) => (
              <li key={index} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-esme-900">{item.rubrique}</span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-esme-900">
                    {Math.round(item.note)}<span className="font-normal text-ink-400">/100</span>
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter value={item.note} tone={item.note >= 70 ? "ok" : item.note >= 40 ? "warn" : "danger"} />
                </div>
                <p className="mt-1.5 text-[12px] text-ink-600">{item.commentaire}</p>
              </li>
            ))}
          </ul>
        </Card>

        {/* --- Corrections proposées --- */}
        <Card>
          <CardHeader
            title="Corrections proposées"
            subtitle="Chaque proposition dit le problème, le risque encouru et la correction attendue. Aucune n'est appliquée sans validation humaine."
            action={<Badge tone="neutral">{corrections.length}</Badge>}
          />
          {corrections.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-ink-500">
              Aucune correction à proposer au dernier contrôle.
            </p>
          ) : (
            <ol className="divide-y divide-ink-100">
              {corrections.map((correction, index) => (
                <li key={index} className="px-5 py-3.5">
                  <p className="text-[13px] font-medium text-esme-900">{correction.probleme}</p>
                  <dl className="mt-1.5 space-y-1 text-[12px]">
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-ink-400">Risque</dt>
                      <dd className="text-ink-700">{correction.risque}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-ink-400">Correction</dt>
                      <dd className="text-ink-700">{correction.correction}</dd>
                    </div>
                    {correction.documentCible ? (
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-ink-400">Document</dt>
                        <dd className="text-ink-700">{correction.documentCible}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Scores du dernier contrôle"
            subtitle={formatDateTime(latest.createdAt)}
            action={
              canRun ? (
                <ActionButton action={() => runQualityAction(tender.id)} label="Relancer" size="sm" />
              ) : null
            }
          />
          <div className="space-y-4 p-5">
            <ScoreBlock
              label="Complétude"
              value={latest.completeness}
              hint="Le dossier contient-il tout ce qui est demandé ?"
            />
            <ScoreBlock
              label="Qualité"
              value={latest.quality}
              hint="Le contenu répond-il vraiment aux critères notés ?"
            />
            <ScoreBlock
              label="Conformité"
              value={latest.compliance}
              hint="Reste-t-il une exigence impérative non satisfaite ?"
              critical
            />
          </div>
        </Card>

        {tender.qualityReviews.length > 1 ? (
          <Card>
            <CardHeader title="Contrôles précédents" />
            <ul className="divide-y divide-ink-100 text-[12px]">
              {tender.qualityReviews.slice(1).map((review) => (
                <li key={review.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span className="text-ink-600">{formatDateTime(review.createdAt)}</span>
                  <span className="tabular-nums text-ink-700">
                    {Math.round(review.completeness)} / {Math.round(review.quality)} / {Math.round(review.compliance)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Notice tone="warn" title="Portée de ces notes">
          {latest.notes ??
            "Ces notes sont une aide à la décision. Elles n'ont pas de valeur juridique et ne garantissent ni la recevabilité ni la réussite de l'offre."}
        </Notice>
      </div>
    </div>
  );
}

function ScoreBlock({
  label,
  value,
  hint,
  critical,
}: {
  label: string;
  value: number;
  hint: string;
  critical?: boolean;
}) {
  const tone = value >= 80 ? "ok" : value >= 50 ? "warn" : "danger";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-esme-900">
          {label}
          {critical ? <span className="ml-1 text-[11px] font-normal text-ink-400">(non moyennée)</span> : null}
        </span>
        <span className="text-xl font-semibold tabular-nums text-esme-900">
          {Math.round(value)}<span className="text-sm font-normal text-ink-400">/100</span>
        </span>
      </div>
      <div className="mt-1.5">
        <Meter value={value} tone={tone} />
      </div>
      <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}
