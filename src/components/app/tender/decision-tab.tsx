"use client";

import { useState } from "react";

import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardHeader, Field, Notice, ScorePill, Select, Textarea } from "@/components/ui";
import { recordDecisionAction } from "@/app/(app)/affaires/[id]/actions";
import {
  daysUntil, formatAmount, formatDateTime, goNoGoLabels, natureLabels, noGoReasonLabels,
} from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Décision Go / No Go.
 *
 * La plateforme propose une recommandation argumentée à partir des éléments
 * qu'elle connaît. La décision reste humaine : elle n'est jamais prise
 * automatiquement, et une affaire demeure « à décider » tant que personne ne
 * s'est prononcé.
 */
export function DecisionTab({ tender, permissions }: { tender: TenderDetail; permissions: Permission[] }) {
  const canDecide = permissions.includes("decision.record");
  const current = tender.decisions.find((decision) => !decision.superseded);
  const criteria = buildCriteria(tender);
  // Le formulaire change de forme selon la décision : les lots ne concernent
  // qu'un GO, le motif qu'un NO GO. Tout afficher en permanence ferait saisir
  // des champs sans objet.
  const [status, setStatus] = useState(tender.goNoGo);
  const [reason, setReason] = useState("");

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Card>
          <CardHeader
            title="Éléments d'arbitrage"
            subtitle="Ce que TENDERA sait du dossier. Les cases vides sont des informations manquantes, pas des zéros."
          />
          <ul className="divide-y divide-ink-100">
            {criteria.map((criterion) => (
              <li key={criterion.label} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-esme-900">{criterion.label}</p>
                  <p className="mt-0.5 text-[12px] text-ink-600">{criterion.detail}</p>
                </div>
                <Badge tone={criterion.tone} className="shrink-0">
                  {criterion.verdict}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Recommandation" subtitle="Aide à la décision — elle n'engage pas l'établissement." />
          <div className="p-5">
            <p className="text-[13px] leading-relaxed text-ink-800">{buildRecommendation(tender, criteria)}</p>
          </div>
        </Card>

        {tender.decisions.length > 0 ? (
          <Card>
            <CardHeader title="Historique des décisions" />
            <ul className="divide-y divide-ink-100">
              {tender.decisions.map((decision) => (
                <li key={decision.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={decision.status === "GO" ? "ok" : decision.status === "NO_GO" ? "danger" : "warn"}>
                      {goNoGoLabels[decision.status]}
                    </Badge>
                    {decision.reason ? <Badge tone="neutral">{noGoReasonLabels[decision.reason]}</Badge> : null}
                    {decision.superseded ? <Badge tone="neutral">Remplacée</Badge> : null}
                    <span className="text-[12px] text-ink-500">
                      {formatDateTime(decision.decidedAt)}
                      {decision.decidedBy ? ` · ${decision.decidedBy.name}` : ""}
                    </span>
                  </div>
                  {decision.lotLabels.length > 0 ? (
                    <p className="mt-1.5 text-[12px] text-ink-600">
                      Positionnement sur {decision.lotLabels.length} lot(s) :{" "}
                      {decision.lotLabels.join(" ; ")}
                    </p>
                  ) : null}
                  {decision.rationale ? (
                    <p className="mt-1.5 text-[13px] text-ink-700">{decision.rationale}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Statut actuel"
            action={
              <Badge tone={tender.goNoGo === "GO" ? "ok" : tender.goNoGo === "NO_GO" ? "danger" : "warn"}>
                {goNoGoLabels[tender.goNoGo]}
              </Badge>
            }
          />
          <div className="p-5 text-[13px] text-ink-700">
            {current ? (
              <p>{current.rationale}</p>
            ) : (
              <p className="text-ink-500">
                Aucune décision n&apos;a été enregistrée. L&apos;affaire reste « à décider » tant que personne ne
                s&apos;est prononcé.
              </p>
            )}
          </div>
        </Card>

        {canDecide ? (
          <Card>
            <CardHeader title="Enregistrer une décision" />
            <div className="p-5">
              <ActionForm
                action={(formData) => recordDecisionAction(tender.id, formData)}
                submitLabel="Enregistrer la décision"
              >
                <div className="space-y-3">
                  <Field label="Décision" required>
                    <Select
                      name="status"
                      value={status}
                      onChange={(event) => setStatus(event.target.value as typeof status)}
                      required
                    >
                      <option value="A_DECIDER">À décider</option>
                      <option value="GO">GO — répondre</option>
                      <option value="NO_GO">NO GO — ne pas poursuivre</option>
                    </Select>
                  </Field>

                  {status === "GO" && tender.lots.length > 0 ? (
                    <Field
                      label="Lots sur lesquels nous nous positionnons"
                      required
                      hint="Un accord-cadre ne se gagne pas en bloc : le lot retenu pilote le mémoire et le chiffrage."
                    >
                      <ul className="space-y-1.5 rounded-lg border border-ink-200 bg-white p-2.5">
                        {tender.lots.map((lot) => (
                          <li key={lot.id} className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              name="lots"
                              value={lot.id}
                              id={`lot-${lot.id}`}
                              className="mt-0.5 size-4 shrink-0 accent-[var(--color-esme-600)]"
                            />
                            <label htmlFor={`lot-${lot.id}`} className="min-w-0 flex-1 cursor-pointer">
                              <span className="block text-[13px] text-esme-900">
                                Lot {lot.number} — {lot.title}
                              </span>
                              {lot.scoreGlobal !== null && lot.scoreGlobal !== undefined ? (
                                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <ScorePill value={lot.scoreGlobal} size="sm" />
                                  {lot.nature ? (
                                    <span className="text-[11px] text-ink-500">{natureLabels[lot.nature]}</span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="mt-0.5 block text-[11px] text-ink-400">
                                  Affinité non calculée pour ce lot.
                                </span>
                              )}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </Field>
                  ) : null}

                  {status === "GO" && tender.lots.length === 0 ? (
                    <Notice tone="info">
                      Cette consultation n&apos;est pas allotie : le GO porte sur l&apos;ensemble du marché.
                    </Notice>
                  ) : null}

                  {status === "NO_GO" ? (
                    <Field label="Motif du NO GO" required hint="Obligatoire, même lorsque l'affaire correspond au catalogue.">
                      <Select
                        name="reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        required
                      >
                        <option value="">— Choisir un motif —</option>
                        {Object.entries(noGoReasonLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}

                  <Field
                    label="Motivation"
                    required
                    hint={
                      status === "NO_GO" && reason === "AUTRE"
                        ? "Motif « Autre » : décrivez-le ici, c'est la seule trace qui restera."
                        : "Conservée au journal d'audit."
                    }
                  >
                    <Textarea
                      name="rationale"
                      rows={4}
                      required
                      placeholder={
                        status === "NO_GO"
                          ? "Ce qui écarte cette consultation."
                          : "Ce qui justifie la décision."
                      }
                    />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Card>
        ) : (
          <Notice tone="info">Votre rôle ne permet pas d&apos;arbitrer le Go / No Go.</Notice>
        )}

        <Notice tone="info" title="Ce qui se passe ensuite">
          Un <strong>GO</strong> fait passer l&apos;affaire en préparation et génère l&apos;espace de réponse :
          checklist, planning, plan et premier jet du mémoire. Un <strong>NO GO</strong> classe
          l&apos;affaire dans les opportunités non poursuivies, avec son motif — elle reste rouvrable.
        </Notice>
      </div>
    </div>
  );
}

type Criterion = { label: string; detail: string; verdict: string; tone: "ok" | "warn" | "danger" | "neutral" };

/** Éléments factuels pesés dans l'arbitrage. Aucun n'est inventé. */
function buildCriteria(tender: TenderDetail): Criterion[] {
  const criteria: Criterion[] = [];
  const match = tender.matchResult;

  criteria.push(
    match
      ? {
          label: "Adéquation pédagogique",
          detail: `Catalogue ${Math.round(match.scoreCatalogue)}, voisines ${Math.round(match.scoreVoisines)}, IONIS ${Math.round(match.scoreIonis)}.`,
          verdict: `${Math.round(match.scoreGlobal)}/100`,
          tone: match.scoreGlobal >= 70 ? "ok" : match.scoreGlobal >= 45 ? "warn" : "danger",
        }
      : {
          label: "Adéquation pédagogique",
          detail: "Le matching n'a pas été calculé.",
          verdict: "Inconnue",
          tone: "neutral",
        },
  );

  criteria.push({
    label: "Montant",
    detail:
      tender.amountKind === "NON_COMMUNIQUE"
        ? "L'avis ne publie aucun montant : la rentabilité ne peut pas être appréciée à ce stade."
        : `Montant publié : ${formatAmount(tender.amountKind, tender.amountMinEur, tender.amountMaxEur)}.`,
    verdict: tender.amountKind === "NON_COMMUNIQUE" ? "Non communiqué" : "Publié",
    tone: tender.amountKind === "NON_COMMUNIQUE" ? "neutral" : "ok",
  });

  const remaining = daysUntil(tender.deadlineAt);
  criteria.push({
    label: "Délai de réponse",
    detail:
      remaining === null
        ? "Date limite inconnue."
        : remaining < 0
          ? "La date limite est dépassée."
          : `${remaining} jour(s) avant la date limite de dépôt.`,
    verdict: remaining === null ? "Inconnu" : remaining < 0 ? "Échu" : `J-${remaining}`,
    tone: remaining === null ? "neutral" : remaining < 0 ? "danger" : remaining < 10 ? "warn" : "ok",
  });

  const dceReadable = tender.documents.filter(
    (document) => document.scope === "DCE" && document.extractionStatus === "termine",
  ).length;
  criteria.push({
    label: "Dossier de consultation",
    detail:
      dceReadable === 0
        ? "Aucune pièce analysée : l'arbitrage repose sur le seul avis."
        : `${dceReadable} pièce(s) analysée(s).`,
    verdict: dceReadable === 0 ? "Absent" : "Analysé",
    tone: dceReadable === 0 ? "warn" : "ok",
  });

  const blocking = tender.requirements.filter(
    (requirement) => requirement.level === "OBLIGATOIRE" && requirement.status === "NON_CONFORME",
  ).length;
  const toCheck = tender.requirements.filter(
    (requirement) => requirement.level === "OBLIGATOIRE" && requirement.status === "A_VERIFIER",
  ).length;
  criteria.push({
    label: "Conditions de candidature",
    detail:
      tender.requirements.length === 0
        ? "Aucune exigence enregistrée : lancez l'analyse du DCE."
        : `${blocking} non-conformité(s) relevée(s), ${toCheck} exigence(s) encore à vérifier.`,
    verdict: blocking > 0 ? "Risque" : tender.requirements.length === 0 ? "Inconnues" : "À vérifier",
    tone: blocking > 0 ? "danger" : tender.requirements.length === 0 ? "neutral" : "warn",
  });

  if (tender.analysis?.certifications.length) {
    criteria.push({
      label: "Certifications exigées",
      detail: tender.analysis.certifications.join(", "),
      verdict: "À confirmer",
      tone: "warn",
    });
  }

  const ionis = (match?.matches ?? []).filter(
    (item) => item.training.origin === "IONIS" && item.score >= 50,
  );
  if (ionis.length > 0) {
    criteria.push({
      label: "Coopération Groupe IONIS",
      detail:
        "Une partie du besoin relève d'un autre établissement du groupe. Aucun établissement ne peut en engager un autre sans accord formel.",
      verdict: "Accord requis",
      tone: "warn",
    });
  }

  return criteria;
}

function buildRecommendation(tender: TenderDetail, criteria: Criterion[]): string {
  const match = tender.matchResult;
  const blockers = criteria.filter((criterion) => criterion.tone === "danger");
  const unknowns = criteria.filter((criterion) => criterion.tone === "neutral");

  const parts: string[] = [];

  if (!match) {
    parts.push("Le matching n'a pas été calculé : lancez-le avant d'arbitrer.");
  } else {
    if (match.recommendation) parts.push(match.recommendation);
  }

  if (blockers.length > 0) {
    parts.push(
      `Points bloquants à lever avant un GO : ${blockers.map((criterion) => criterion.label.toLowerCase()).join(", ")}.`,
    );
  }
  if (unknowns.length > 0) {
    parts.push(
      `Éléments encore inconnus : ${unknowns.map((criterion) => criterion.label.toLowerCase()).join(", ")}. Ils ne sont pas comptés comme favorables.`,
    );
  }

  parts.push(
    "Cette recommandation ne tient pas compte de la rentabilité réelle, des moyens humains disponibles à la période visée, ni de la concurrence : ces éléments relèvent de l'arbitrage humain.",
  );

  return parts.join(" ");
}
