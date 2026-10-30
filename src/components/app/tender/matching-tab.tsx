"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { ScoreGauges } from "@/components/app/charts";
import {
  Badge, Card, CardHeader, EmptyState, Field, Input, Notice, Select, Table, Td, Textarea, Th,
} from "@/components/ui";
import {
  clearOverrideAction, overrideMatchingAction, recomputeMatchingAction, recordNoMatchAction,
} from "@/app/(app)/affaires/[id]/actions";
import { formatDateTime, natureLabels, natureTone, noMatchReasonLabels } from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Onglet 5 — correspondances pédagogiques.
 *
 * Trois scores séparés, leur pondération, leur score global, et surtout
 * l'explication : quelles fiches correspondent, quelles compétences sont
 * couvertes, lesquelles ne le sont pas.
 */
export function MatchingTab({ tender, permissions }: { tender: TenderDetail; permissions: Permission[] }) {
  const canRun = permissions.includes("matching.run");
  const canOverride = permissions.includes("matching.override");
  const result = tender.matchResult;
  // Le champ libre devient obligatoire sur « Autre » : on suit donc la
  // sélection côté client pour le signaler avant l'envoi.
  const [noMatchReason, setNoMatchReason] = useState<string>(result?.noMatchReason ?? "");

  if (!result) {
    return (
      <Card>
        <CardHeader title="Matching" />
        <div className="p-5">
          <EmptyState
            title="Aucun calcul de correspondance"
            description="Le matching compare l'objet de la consultation au référentiel pédagogique : catalogue ESME, formations voisines et compétences du Groupe IONIS."
            action={
              canRun ? (
                <ActionButton
                  action={() => recomputeMatchingAction(tender.id)}
                  label="Lancer le matching"
                  variant="primary"
                  size="md"
                />
              ) : null
            }
          />
        </div>
      </Card>
    );
  }

  const weights = (result.weights as { catalogue: number; voisines: number; ionis: number } | null) ?? {
    catalogue: 60, voisines: 25, ionis: 15,
  };

  const byOrigin = {
    CATALOGUE_ESME: result.matches.filter((match) => match.training.origin === "CATALOGUE_ESME"),
    VOISINE: result.matches.filter((match) => match.training.origin === "VOISINE"),
    IONIS: result.matches.filter((match) => match.training.origin === "IONIS"),
  };

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {(["CATALOGUE_ESME", "VOISINE", "IONIS"] as const).map((origin) => (
          <Card key={origin}>
            <CardHeader
              title={
                origin === "CATALOGUE_ESME"
                  ? "Priorité 1 — catalogue ESME Executive Education"
                  : origin === "VOISINE"
                    ? "Priorité 2 — formations voisines et conception sur mesure"
                    : "Priorité 3 — compétences du Groupe IONIS"
              }
              subtitle={
                origin === "CATALOGUE_ESME"
                  ? "Formations du catalogue officiel, recherchées en premier."
                  : origin === "VOISINE"
                    ? "Points d'appui pour une adaptation : une compétence voisine n'est pas une capacité confirmée."
                    : "Compétences d'autres établissements du groupe, à confirmer par un accord formel."
              }
              action={<Badge tone="neutral">{byOrigin[origin].length}</Badge>}
            />
            {byOrigin[origin].length === 0 ? (
              <p className="px-5 py-6 text-center text-[13px] text-ink-500">
                Aucune correspondance significative dans cette famille.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-28">Référence</Th>
                    <Th>Formation</Th>
                    <Th className="w-20">Score</Th>
                  </tr>
                </thead>
                <tbody>
                  {byOrigin[origin].slice(0, 10).map((match) => (
                    <tr key={match.id}>
                      <Td>
                        <span className="font-mono text-[12px] text-esme-700">{match.training.code}</span>
                        {match.training.catalogPage ? (
                          <p className="mt-0.5 text-[11px] text-ink-400">p. {match.training.catalogPage}</p>
                        ) : null}
                      </Td>
                      <Td>
                        <p className="text-[13px] font-medium text-esme-900">{match.training.title}</p>
                        {match.training.domain ? (
                          <Badge tone="esme" className="mt-1">{match.training.domain.name}</Badge>
                        ) : null}
                        {match.training.institution ? (
                          <Badge tone="violet" className="mt-1 ml-1">
                            {match.training.institution.shortName ?? match.training.institution.name}
                          </Badge>
                        ) : null}
                        <p className="mt-1 text-[12px] text-ink-600">{match.rationale}</p>
                        {match.signals.length > 0 ? (
                          <p className="mt-1 text-[11px] text-ink-500">
                            Thèmes communs : {match.signals.join(", ")}
                          </p>
                        ) : null}
                        {match.training.institution?.cooperation ? (
                          <p className="mt-1 text-[11px] italic text-ink-500">
                            {match.training.institution.cooperation}
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="text-[13px] font-semibold tabular-nums text-esme-900">
                          {Math.round(match.score)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ))}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Scores d'adéquation"
            subtitle={`Calculés le ${formatDateTime(result.computedAt)} — moteur ${result.engine}.`}
            action={
              canRun ? (
                <ActionButton
                  action={() => recomputeMatchingAction(tender.id)}
                  label="Recalculer"
                  size="sm"
                  icon={<RefreshCw className="size-3.5" aria-hidden />}
                />
              ) : null
            }
          />
          <div className="p-5">
            <div className="mb-4 rounded-xl bg-esme-50 p-4 text-center">
              <p className="text-[12px] text-ink-600">Score global</p>
              <p className="mt-0.5 text-4xl font-semibold tabular-nums leading-none text-esme-900">
                {Math.round(result.scoreGlobal)}
                <span className="text-lg font-normal text-ink-400">/100</span>
              </p>
            </div>

            <ScoreGauges
              scores={[
                { label: "Catalogue ESME", value: result.scoreCatalogue },
                { label: "Formations voisines", value: result.scoreVoisines },
                { label: "Groupe IONIS", value: result.scoreIonis },
              ]}
              weights={{
                "Catalogue ESME": weights.catalogue,
                "Formations voisines": weights.voisines,
                "Groupe IONIS": weights.ionis,
              }}
            />

            {result.manualOverride ? (
              <Notice tone="warn" title="Scores ajustés manuellement" className="mt-4">
                <p>{result.overrideNote}</p>
                {canOverride ? (
                  <ActionButton
                    action={() => clearOverrideAction(tender.id)}
                    label="Lever l'ajustement et recalculer"
                    size="sm"
                    className="mt-2"
                  />
                ) : null}
              </Notice>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Appréciation"
            subtitle="Nature du marché, évaluée indépendamment des domaines du catalogue."
          />
          <div className="space-y-3 p-5 text-[13px]">
            <Badge tone={natureTone(result.nature)}>{natureLabels[result.nature]}</Badge>
            {result.natureLabel ? <p className="text-ink-800">{result.natureLabel}</p> : null}
            {result.formationSignals.length > 0 ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-400">
                  Ce qui a fondé cette appréciation
                </p>
                <ul className="mt-1 space-y-1 text-[12px] text-ink-600">
                  {result.formationSignals.map((signal, index) => (
                    <li key={index} className="tendera-chevron">{signal}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <hr className="border-ink-100" />
            <p className="text-ink-800">{result.recommendation}</p>
            {result.adaptableNote ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-400">Adaptation</p>
                <p className="mt-0.5 text-ink-700">{result.adaptableNote}</p>
              </div>
            ) : null}
            {result.ionisNote ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-400">Groupe IONIS</p>
                <p className="mt-0.5 text-ink-700">{result.ionisNote}</p>
              </div>
            ) : null}
          </div>
        </Card>

        {result.coveredSkills.length > 0 || result.missingSkills.length > 0 ? (
          <Card>
            <CardHeader title="Compétences" />
            <div className="space-y-3 p-5">
              {result.coveredSkills.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-400">Couvertes</p>
                  <div className="flex flex-wrap gap-1">
                    {result.coveredSkills.map((skill) => (
                      <Badge key={skill} tone="ok">{skill}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {result.missingSkills.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-400">Non couvertes</p>
                  <div className="flex flex-wrap gap-1">
                    {result.missingSkills.map((skill) => (
                      <Badge key={skill} tone="warn">{skill}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {result.extraResources.length > 0 || result.constraints.length > 0 ? (
          <Card>
            <CardHeader title="Moyens et contraintes" />
            <ul className="space-y-2 p-5 text-[12px] text-ink-700">
              {[...result.extraResources, ...result.constraints].map((item, index) => (
                <li key={index} className="tendera-chevron">{item}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Notice tone="info" title="Ce que mesurent ces scores">
          <ul className="mt-1 space-y-1">
            {result.caveats.map((caveat, index) => (
              <li key={index}>— {caveat}</li>
            ))}
          </ul>
        </Notice>

        {/*
          Qualification humaine d'une absence de correspondance.

          Sans elle, rien ne distingue dans « AO identifiés » les dossiers
          examinés et écartés du simple retard : on ne sait pas si personne n'a
          regardé, ou si quelqu'un a regardé et conclu.
        */}
        {result.nature !== "FORMATION_CATALOGUE" ? (
          <Card>
            <CardHeader
              title="Pourquoi cette affaire n'est pas retenue"
              subtitle="Facultatif, mais c'est ce qui distingue un dossier écarté d'un dossier jamais ouvert."
              action={
                result.noMatchReason ? (
                  <Badge tone="neutral">Qualifiée</Badge>
                ) : (
                  <Badge tone="warn">Non qualifiée</Badge>
                )
              }
            />
            <div className="p-5">
              {result.noMatchAt ? (
                <p className="mb-3 text-[12px] text-ink-500">
                  Dernière qualification le {formatDateTime(result.noMatchAt)}.
                </p>
              ) : null}

              {canOverride ? (
                <ActionForm
                  action={(formData) => recordNoMatchAction(tender.id, formData)}
                  submitLabel="Enregistrer le motif"
                  submitVariant="secondary"
                  submitSize="sm"
                >
                  <div className="space-y-3">
                    <Field label="Motif" hint="Laisser vide retire le motif enregistré.">
                      <Select
                        name="noMatchReason"
                        value={noMatchReason}
                        onChange={(event) => setNoMatchReason(event.target.value)}
                      >
                        <option value="">— Aucun —</option>
                        {Object.entries(noMatchReasonLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Précision"
                      required={noMatchReason === "AUTRE"}
                      hint={
                        noMatchReason === "AUTRE"
                          ? "Motif « Autre » : obligatoire, c'est la seule trace qui restera."
                          : "Texte libre, pour ce que la liste ne couvre pas."
                      }
                    >
                      <Textarea
                        name="noMatchNote"
                        rows={3}
                        defaultValue={result.noMatchNote ?? ""}
                        placeholder="Ce qui écarte cet objet du référentiel."
                      />
                    </Field>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-[13px] text-ink-600">
                  {result.noMatchReason
                    ? `${noMatchReasonLabels[result.noMatchReason]}${result.noMatchNote ? ` — ${result.noMatchNote}` : ""}`
                    : "Aucun motif enregistré. Votre rôle ne permet pas d'en consigner un."}
                </p>
              )}
            </div>
          </Card>
        ) : null}

        {canOverride ? (
          <Card>
            <CardHeader title="Ajuster les scores" subtitle="Réservé aux cas où le calcul passe à côté du sujet." />
            <div className="p-5">
              <ActionForm
                action={(formData) => overrideMatchingAction(tender.id, formData)}
                submitLabel="Appliquer l'ajustement"
                submitVariant="secondary"
                submitSize="sm"
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Catalogue">
                    <Input name="scoreCatalogue" inputMode="numeric" defaultValue={Math.round(result.scoreCatalogue)} />
                  </Field>
                  <Field label="Voisines">
                    <Input name="scoreVoisines" inputMode="numeric" defaultValue={Math.round(result.scoreVoisines)} />
                  </Field>
                  <Field label="IONIS">
                    <Input name="scoreIonis" inputMode="numeric" defaultValue={Math.round(result.scoreIonis)} />
                  </Field>
                </div>
                <Field label="Justification" required className="mt-3" hint="Conservée au journal d'audit.">
                  <Textarea name="overrideNote" rows={3} required />
                </Field>
              </ActionForm>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
