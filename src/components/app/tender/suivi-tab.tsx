"use client";

import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import {
  addNegotiationItemAction, confirmSubmissionAction, recordResultAction,
} from "@/app/(app)/affaires/[id]/actions";
import { formatDate, formatDateTime, negotiationKindLabels, outcomeLabels } from "@/lib/labels";
import type { AssignableUser, TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Dépôt, négociation et résultat.
 *
 * Le dépôt n'est jamais déduit : il est attesté par un utilisateur habilité,
 * avec la plateforme, la date et, si disponible, l'accusé de réception.
 * TENDERA ne dépose pas sur les plateformes et ne simule pas un dépôt.
 */
export function SuiviTab({
  tender,
  users,
  permissions,
}: {
  tender: TenderDetail;
  users: AssignableUser[];
  permissions: Permission[];
}) {
  const canSubmit = permissions.includes("submission.record");
  const canResult = permissions.includes("result.record");
  const canEdit = permissions.includes("tender.edit");
  const submission = tender.submission;
  const result = tender.result;

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {/* --- Dépôt --- */}
        <Card>
          <CardHeader
            title="Dépôt du pli"
            subtitle="Le dépôt est déclaré manuellement, après dépôt réel sur la plateforme de l'acheteur."
            action={
              submission?.confirmed ? <Badge tone="ok">Dépôt confirmé</Badge> : <Badge tone="warn">Non déposé</Badge>
            }
          />
          <div className="p-5">
            {submission?.confirmed ? (
              <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                <Entry label="Plateforme" value={submission.platform} />
                <Entry label="Date et heure" value={formatDateTime(submission.submittedAt)} />
                <Entry label="Déposé par" value={submission.submittedBy} />
                <Entry label="Référence plateforme" value={submission.platformRef} />
                <Entry label="Accusé de réception" value={submission.acknowledgement} wide />
                <Entry label="Observations" value={submission.observations} wide />
                {submission.documentList.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] uppercase tracking-wide text-ink-400">Documents déposés</dt>
                    <dd className="mt-1">
                      <ul className="space-y-0.5 text-[12px] text-ink-700">
                        {submission.documentList.map((item, index) => (
                          <li key={index} className="tendera-chevron">{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : canSubmit ? (
              <ActionForm
                action={(formData) => confirmSubmissionAction(tender.id, formData)}
                submitLabel="Enregistrer le dépôt"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Plateforme de dépôt" required>
                    <Input name="platform" required placeholder="PLACE, Maximilien, AWS-Achat…" />
                  </Field>
                  <Field label="Date et heure du dépôt" required>
                    <Input type="datetime-local" name="submittedAt" required />
                  </Field>
                  <Field label="Référence de dépôt">
                    <Input name="platformRef" />
                  </Field>
                  <Field label="Accusé de réception">
                    <Input name="acknowledgement" placeholder="Numéro ou référence de l'accusé" />
                  </Field>
                  <Field label="Observations" className="sm:col-span-2">
                    <Textarea name="observations" rows={3} />
                  </Field>
                </div>
                <label className="mt-4 flex items-start gap-2 rounded-xl border border-warn-100 bg-warn-50 p-3 text-[12px] text-warn-700">
                  <input type="checkbox" name="confirmed" className="mt-0.5 size-4 accent-[var(--color-esme-600)]" />
                  <span>
                    J&apos;atteste que le pli a bien été déposé sur la plateforme de l&apos;acheteur. TENDERA
                    n&apos;effectue aucun dépôt automatique et ne vérifie pas la réception côté acheteur.
                  </span>
                </label>
              </ActionForm>
            ) : (
              <Notice tone="info">Votre rôle ne permet pas d&apos;enregistrer un dépôt.</Notice>
            )}
          </div>
        </Card>

        {/* --- Négociation --- */}
        <Card>
          <CardHeader
            title="Négociation"
            subtitle="Demandes de précisions, réunions, offres révisées et versions successives du mémoire."
            action={<Badge tone="neutral">{tender.negotiationItems.length}</Badge>}
          />
          {tender.negotiationItems.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-ink-500">
              Aucun échange enregistré pour cette consultation.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {tender.negotiationItems.map((item) => (
                <li key={item.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="esme">{negotiationKindLabels[item.kind]}</Badge>
                    <span className="text-[13px] font-medium text-esme-900">{item.title}</span>
                    {item.done ? <Badge tone="ok">Traité</Badge> : null}
                  </div>
                  {item.detail ? <p className="mt-1 text-[12px] text-ink-700">{item.detail}</p> : null}
                  <p className="mt-1 text-[11px] text-ink-500">
                    {item.dueAt ? `Échéance : ${formatDate(item.dueAt)}` : "Sans échéance"}
                    {item.assignee ? ` · ${item.assignee.name}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <div className="border-t border-ink-100 p-5">
              <ActionForm
                action={(formData) => addNegotiationItemAction(tender.id, formData)}
                submitLabel="Ajouter"
                submitSize="sm"
                resetOnSuccess
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nature">
                    <Select name="kind" defaultValue="DEMANDE_PRECISION">
                      {Object.entries(negotiationKindLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Intitulé" required>
                    <Input name="title" required />
                  </Field>
                  <Field label="Échéance">
                    <Input type="date" name="dueAt" />
                  </Field>
                  <Field label="Responsable">
                    <Select name="assigneeId" defaultValue="">
                      <option value="">Non affecté</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Détail" className="sm:col-span-2">
                    <Textarea name="detail" rows={2} />
                  </Field>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>
      </div>

      {/* --- Résultat --- */}
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Résultat"
            action={<Badge tone={tender.outcome === "ATTRIBUE" ? "ok" : tender.outcome === "EN_ATTENTE" ? "warn" : "danger"}>
              {outcomeLabels[tender.outcome]}
            </Badge>}
          />
          <div className="p-5">
            {canResult ? (
              <ActionForm
                action={(formData) => recordResultAction(tender.id, formData)}
                submitLabel="Enregistrer le résultat"
                submitSize="sm"
              >
                <div className="space-y-3">
                  <Field label="Statut" required>
                    <Select name="status" defaultValue={result?.status ?? tender.outcome} required>
                      {Object.entries(outcomeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </Field>

                  <fieldset className="rounded-xl border border-ink-200 p-3">
                    <legend className="px-1.5 text-[12px] font-medium text-ink-600">Si attribué</legend>
                    <div className="space-y-2.5">
                      <Field label="Lot attribué">
                        <Input name="awardedLot" defaultValue={result?.awardedLot ?? ""} />
                      </Field>
                      <Field label="Montant attribué HT (€)">
                        <Input name="awardedAmountEur" inputMode="decimal" defaultValue={result?.awardedAmountEur?.toString() ?? ""} />
                      </Field>
                      <Field label="Date de notification">
                        <Input type="date" name="notifiedAt" defaultValue={result?.notifiedAt?.toISOString().slice(0, 10) ?? ""} />
                      </Field>
                      <Field label="Date de démarrage">
                        <Input type="date" name="startsAt" defaultValue={result?.startsAt?.toISOString().slice(0, 10) ?? ""} />
                      </Field>
                      <Field label="Durée du marché">
                        <Input name="contractDuration" defaultValue={result?.contractDuration ?? ""} />
                      </Field>
                      <Field label="Responsable opérationnel">
                        <Input name="operationalOwner" defaultValue={result?.operationalOwner ?? ""} />
                      </Field>
                    </div>
                  </fieldset>

                  <fieldset className="rounded-xl border border-ink-200 p-3">
                    <legend className="px-1.5 text-[12px] font-medium text-ink-600">Si rejeté</legend>
                    <div className="space-y-2.5">
                      <Field label="Motif">
                        <Input name="rejectionReason" defaultValue={result?.rejectionReason ?? ""} />
                      </Field>
                      <Field label="Classement">
                        <Input name="ranking" inputMode="numeric" defaultValue={result?.ranking?.toString() ?? ""} />
                      </Field>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Note tech.">
                          <Input name="technicalScore" inputMode="decimal" defaultValue={result?.technicalScore?.toString() ?? ""} />
                        </Field>
                        <Field label="Note fin.">
                          <Input name="financialScore" inputMode="decimal" defaultValue={result?.financialScore?.toString() ?? ""} />
                        </Field>
                        <Field label="Note globale">
                          <Input name="globalScore" inputMode="decimal" defaultValue={result?.globalScore?.toString() ?? ""} />
                        </Field>
                      </div>
                      <Field label="Attributaire">
                        <Input name="winner" defaultValue={result?.winner ?? ""} />
                      </Field>
                      <Field label="Montant attribué (si connu)">
                        <Input name="winnerAmountEur" inputMode="decimal" defaultValue={result?.winnerAmountEur?.toString() ?? ""} />
                      </Field>
                      <Field label="Analyse des écarts">
                        <Textarea name="gapAnalysis" rows={3} defaultValue={result?.gapAnalysis ?? ""} />
                      </Field>
                    </div>
                  </fieldset>

                  <Field label="Enseignements" hint="Une ligne par enseignement. Réutilisés pour les futures réponses.">
                    <Textarea name="lessons" rows={3} defaultValue={(result?.lessons ?? []).join("\n")} />
                  </Field>
                </div>
              </ActionForm>
            ) : result ? (
              <dl className="space-y-2 text-[13px]">
                <Entry label="Statut" value={outcomeLabels[result.status]} />
                <Entry label="Attributaire" value={result.winner} />
                <Entry label="Classement" value={result.ranking?.toString() ?? null} />
                <Entry label="Analyse des écarts" value={result.gapAnalysis} />
              </dl>
            ) : (
              <Notice tone="info">Votre rôle ne permet pas d&apos;enregistrer un résultat.</Notice>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Entry({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={`mt-0.5 ${value ? "text-ink-800" : "text-ink-400"}`}>{value || "—"}</dd>
    </div>
  );
}
