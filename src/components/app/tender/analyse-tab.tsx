"use client";

import { AlertOctagon, Sparkles } from "lucide-react";

import { ActionButton, ActionSelect } from "@/components/app/action-form";
import { Badge, Card, CardHeader, EmptyState, Notice, Table, Td, Th } from "@/components/ui";
import { analyzeDceAction, updateRequirementAction } from "@/app/(app)/affaires/[id]/actions";
import { requirementLevelLabels, requirementStatusLabels } from "@/lib/labels";
import { readContradictions, readCriteres, type TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Onglet 4 — synthèse du dossier et exigences détectées.
 *
 * Chaque information affichée vient d'une pièce : quand la source est connue,
 * elle est citée avec son nom de fichier et sa page.
 */
export function AnalyseTab({ tender, permissions }: { tender: TenderDetail; permissions: Permission[] }) {
  const canAnalyze = permissions.includes("dce.analyze");
  const canEdit = permissions.includes("tender.edit");
  const analysis = tender.analysis;
  const criteres = readCriteres(analysis);
  const contradictions = readContradictions(analysis);

  const byLevel = {
    OBLIGATOIRE: tender.requirements.filter((item) => item.level === "OBLIGATOIRE"),
    EVALUEE: tender.requirements.filter((item) => item.level === "EVALUEE"),
    RECOMMANDATION: tender.requirements.filter((item) => item.level === "RECOMMANDATION"),
  };

  const readable = tender.documents.filter(
    (document) => document.scope === "DCE" && document.extractionStatus === "termine",
  );

  if (!analysis || !analysis.basedOnDocuments) {
    return (
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Analyse du dossier" />
          <div className="p-5">
            <EmptyState
              title="Aucune analyse n'a été produite"
              description={
                readable.length === 0
                  ? "Aucune pièce lisible n'est présente. Importez le DCE dans l'onglet précédent — TENDERA ne produit pas de synthèse sur un dossier qu'il n'a pas lu."
                  : `${readable.length} pièce(s) sont prêtes à être analysées.`
              }
              action={
                canAnalyze && readable.length > 0 ? (
                  <ActionButton
                    action={() => analyzeDceAction(tender.id)}
                    label="Lancer l'analyse"
                    variant="primary"
                    size="md"
                    icon={<Sparkles className="size-4" aria-hidden />}
                  />
                ) : null
              }
            />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {/* --- Synthèse --- */}
        <Card>
          <CardHeader
            title="Synthèse du dossier"
            subtitle={`Produite à partir de ${analysis.documentCount} pièce(s) — moteur ${analysis.engine}.`}
            action={
              canAnalyze ? (
                <ActionButton action={() => analyzeDceAction(tender.id)} label="Relancer l'analyse" size="sm" />
              ) : null
            }
          />
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            <Entry label="Objet du marché" value={analysis.objet} wide />
            <Entry label="Besoin de l'acheteur" value={analysis.besoin} wide />
            <Entry label="Publics à former" value={analysis.publics.join(" ; ")} />
            <Entry label="Nombre de stagiaires" value={analysis.stagiaires} />
            <Entry label="Sessions" value={analysis.sessions} />
            <Entry label="Volume horaire" value={analysis.volumeHoraire} />
            <Entry label="Modalités pédagogiques" value={analysis.modalites.join(", ")} />
            <Entry label="Lieux" value={analysis.lieux.join(" ; ")} />
            <Entry label="Moyens humains demandés" value={analysis.moyensHumains} wide />
            <Entry label="Certifications exigées" value={analysis.certifications.join(", ")} />
            <Entry label="Contraintes financières" value={analysis.contraintesFinancieres} />
            <Entry label="Délais" value={analysis.delais} wide />
          </dl>
        </Card>

        {/* --- Critères d'attribution --- */}
        <Card>
          <CardHeader
            title="Critères d'attribution"
            subtitle="Ce sont eux qui dictent le plan du mémoire technique."
          />
          <div className="p-5">
            {criteres.length === 0 ? (
              <p className="text-[13px] text-ink-500">
                Aucun critère n&apos;a été repéré automatiquement. Vérifiez le règlement de consultation :
                sans critère connu, le mémoire ne peut pas être aligné sur la grille de notation.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {criteres.map((critere, index) => (
                  <li key={`${critere.label}-${index}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] text-ink-800">{critere.label}</span>
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-esme-900">
                        {critere.weight === null ? "pondération inconnue" : `${critere.weight} %`}
                      </span>
                    </div>
                    {critere.weight !== null ? (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-esme-500" style={{ width: `${critere.weight}%` }} />
                      </div>
                    ) : null}
                    {critere.source ? (
                      <p className="mt-1 text-[11px] text-ink-500">
                        Source : {critere.source.fileName}, page {critere.source.page}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* --- Exigences --- */}
        {(["OBLIGATOIRE", "EVALUEE", "RECOMMANDATION"] as const).map((level) => (
          <Card key={level}>
            <CardHeader
              title={requirementLevelLabels[level]}
              subtitle={
                level === "OBLIGATOIRE"
                  ? "Non-respect potentiellement éliminatoire : à traiter en priorité."
                  : level === "EVALUEE"
                    ? "Éléments entrant dans la notation."
                    : "Améliorations possibles, non imposées."
              }
              action={<Badge tone={level === "OBLIGATOIRE" ? "danger" : level === "EVALUEE" ? "esme" : "neutral"}>{byLevel[level].length}</Badge>}
            />
            {byLevel[level].length === 0 ? (
              <p className="px-5 py-6 text-center text-[13px] text-ink-500">Aucune exigence de ce niveau détectée.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Exigence</Th>
                    <Th className="w-40">Source</Th>
                    <Th className="w-44">Statut</Th>
                  </tr>
                </thead>
                <tbody>
                  {byLevel[level].map((requirement) => {
                    const source = tender.documents.find((document) => document.id === requirement.sourceDocumentId);
                    return (
                      <tr key={requirement.id}>
                        <Td>
                          <p className="text-[13px] text-ink-800">{requirement.label}</p>
                          {requirement.sourceQuote ? (
                            <p className="mt-1 border-l-2 border-framboise-300 pl-2 text-[11px] italic text-ink-500">
                              « {requirement.sourceQuote} »
                            </p>
                          ) : null}
                          {requirement.weight ? (
                            <Badge tone="esme" className="mt-1.5">
                              Pondération {requirement.weight} %
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="text-[11px] text-ink-500">
                          {source ? `${source.fileName}${requirement.sourcePage ? `, p. ${requirement.sourcePage}` : ""}` : "—"}
                        </Td>
                        <Td>
                          {canEdit ? (
                            <ActionSelect
                              label="Statut de l'exigence"
                              value={requirement.status}
                              action={(next) =>
                                updateRequirementAction(tender.id, requirement.id, next as never, "")
                              }
                              options={Object.entries(requirementStatusLabels).map(([value, label]) => ({ value, label }))}
                            />
                          ) : (
                            <Badge tone={statusTone(requirement.status)}>
                              {requirementStatusLabels[requirement.status]}
                            </Badge>
                          )}
                          {requirement.reviewedBy ? (
                            <p className="mt-1 text-[11px] text-ink-500">par {requirement.reviewedBy}</p>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        ))}
      </div>

      {/* --- Colonne droite : risques et limites --- */}
      <div className="space-y-5">
        {contradictions.length > 0 ? (
          <Card className="border-danger-100">
            <CardHeader
              title="Contradictions entre pièces"
              subtitle="À faire préciser par l'acheteur avant de répondre."
              action={<AlertOctagon className="size-4 text-danger-500" aria-hidden />}
            />
            <ul className="divide-y divide-ink-100">
              {contradictions.map((contradiction, index) => (
                <li key={index} className="px-5 py-3">
                  <p className="text-[13px] font-medium text-danger-700">{contradiction.sujet}</p>
                  <p className="mt-0.5 text-[12px] text-ink-600">{contradiction.detail}</p>
                  <p className="mt-1 text-[11px] text-ink-500">
                    Pièces : {contradiction.piecesConcernees.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {analysis.pointsAClarifier.length > 0 ? (
          <Card>
            <CardHeader title="Points à clarifier" />
            <ul className="space-y-2 p-5 text-[13px] text-ink-700">
              {analysis.pointsAClarifier.map((point, index) => (
                <li key={index} className="tendera-chevron">
                  {point}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <ListCard title="Risques contractuels" items={analysis.risques} />
        <ListCard title="Pénalités" items={analysis.penalites} />
        <ListCard title="Obligations particulières" items={analysis.obligations} />
        <ListCard title="Exigences administratives" items={analysis.exigencesAdmin} />

        <Notice tone="warn" title="Limites de l'analyse">
          <ul className="mt-1 space-y-1">
            {analysis.incertitudes.map((note, index) => (
              <li key={index}>— {note}</li>
            ))}
          </ul>
        </Notice>
      </div>
    </div>
  );
}

function Entry({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={`mt-0.5 text-[13px] ${value ? "text-ink-800" : "text-ink-400"}`}>
        {value && value.trim() ? value : "Non trouvé dans les pièces analysées"}
      </dd>
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2 p-5 text-[12px] leading-relaxed text-ink-700">
        {items.map((item, index) => (
          <li key={index} className="tendera-chevron">
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function statusTone(status: string): "ok" | "warn" | "danger" | "neutral" {
  if (status === "CONFORME") return "ok";
  if (status === "NON_CONFORME" || status === "MANQUANT") return "danger";
  if (status === "A_VERIFIER") return "warn";
  return "neutral";
}
