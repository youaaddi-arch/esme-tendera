"use client";

import Link from "next/link";

import { ActionForm } from "@/components/app/action-form";
import { Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { updateTenderAction } from "@/app/(app)/affaires/[id]/actions";
import { amountKindLabels, formatDateTime } from "@/lib/labels";
import type { AssignableUser, TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/** Onglet 1 — informations générales. Tous les champs sont modifiables. */
export function InfosTab({
  tender,
  users,
  permissions,
}: {
  tender: TenderDetail;
  users: AssignableUser[];
  permissions: Permission[];
}) {
  const canEdit = permissions.includes("tender.edit");
  const dateValue = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");
  const amountValue = (value: unknown) => (value === null || value === undefined ? "" : String(value));

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader
          title="Informations générales"
          subtitle={
            canEdit
              ? "Les valeurs issues de la veille sont modifiables : la source fait foi, pas l'extraction automatique."
              : "Consultation seule : votre rôle ne permet pas la modification."
          }
        />
        <div className="p-5">
          <fieldset disabled={!canEdit} className="contents">
            <ActionForm
              action={(formData) => updateTenderAction(tender.id, formData)}
              submitLabel="Enregistrer la fiche"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Intitulé du marché" required className="sm:col-span-2">
                  <Input name="title" defaultValue={tender.title} required disabled={!canEdit} />
                </Field>
                <Field label="Acheteur" required>
                  <Input name="buyer" defaultValue={tender.buyer} required disabled={!canEdit} />
                </Field>
                <Field label="SIRET de l'acheteur">
                  <Input name="buyerSiret" defaultValue={tender.buyerSiret ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Numéro de consultation">
                  <Input name="consultationRef" defaultValue={tender.consultationRef ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Lot concerné" hint="Renseigné quand l'affaire porte sur un lot précis.">
                  <Input name="lotLabel" defaultValue={tender.lotLabel ?? ""} disabled={!canEdit} />
                </Field>

                <Field label="Objet du marché" className="sm:col-span-2">
                  <Textarea name="objectSummary" rows={5} defaultValue={tender.objectSummary ?? ""} disabled={!canEdit} />
                </Field>

                <Field label="Procédure">
                  <Input name="procedure" defaultValue={tender.procedure ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Codes CPV" hint="Séparés par des espaces ou des virgules.">
                  <Input name="cpvCodes" defaultValue={tender.cpvCodes.join(" ")} disabled={!canEdit} />
                </Field>

                <Field label="Date de publication">
                  <Input type="date" name="publishedAt" defaultValue={dateValue(tender.publishedAt)} disabled={!canEdit} />
                </Field>
                <Field label="Date limite de dépôt">
                  <Input type="date" name="deadlineAt" defaultValue={dateValue(tender.deadlineAt)} disabled={!canEdit} />
                </Field>

                <Field label="Durée du marché">
                  <Input name="contractDuration" defaultValue={tender.contractDuration ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Reconductions">
                  <Input name="renewals" defaultValue={tender.renewals ?? ""} disabled={!canEdit} />
                </Field>

                <Field label="Lieu d'exécution">
                  <Input name="executionPlace" defaultValue={tender.executionPlace ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Région">
                  <Input name="region" defaultValue={tender.region ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Département">
                  <Input name="department" defaultValue={tender.department ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Responsable de l'affaire">
                  <Select name="ownerId" defaultValue={tender.ownerId ?? ""} disabled={!canEdit}>
                    <option value="">Non affecté</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Modalités de réponse" className="sm:col-span-2">
                  <Textarea name="responseTerms" rows={3} defaultValue={tender.responseTerms ?? ""} disabled={!canEdit} />
                </Field>

                <Field label="Lien vers l'avis" className="sm:col-span-2">
                  <Input name="sourceUrl" type="url" defaultValue={tender.sourceUrl ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Lien direct vers le DCE" className="sm:col-span-2">
                  <Input name="dceSourceUrl" type="url" defaultValue={tender.dceSourceUrl ?? ""} disabled={!canEdit} />
                </Field>
              </div>

              <fieldset className="mt-5 rounded-xl border border-ink-200 p-4">
                <legend className="px-2 text-[13px] font-medium text-ink-700">Montant</legend>
                <p className="mb-3 text-[12px] text-ink-500">
                  Un montant absent reste « non communiqué » : TENDERA n&apos;affiche jamais un montant estimé comme
                  s&apos;il était publié.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Nature du montant">
                    <Select name="amountKind" defaultValue={tender.amountKind} disabled={!canEdit}>
                      {Object.entries(amountKindLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Montant minimum HT (€)">
                    <Input name="amountMinEur" inputMode="decimal" defaultValue={amountValue(tender.amountMinEur)} disabled={!canEdit} />
                  </Field>
                  <Field label="Montant maximum HT (€)">
                    <Input name="amountMaxEur" inputMode="decimal" defaultValue={amountValue(tender.amountMaxEur)} disabled={!canEdit} />
                  </Field>
                  <Field label="Précision sur le montant" className="sm:col-span-3">
                    <Input name="amountNote" defaultValue={tender.amountNote ?? ""} disabled={!canEdit} />
                  </Field>
                </div>
              </fieldset>
            </ActionForm>
          </fieldset>
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Provenance" />
          <dl className="space-y-3 p-5 text-[13px]">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ink-400">Source</dt>
              <dd className="mt-0.5">
                {tender.sourceConnector ? tender.sourceConnector.name : "Saisie manuelle"}
                {tender.sourceNoticeId ? (
                  <span className="ml-1 font-mono text-[11px] text-ink-500">({tender.sourceNoticeId})</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ink-400">Créée le</dt>
              <dd className="mt-0.5">{formatDateTime(tender.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ink-400">Dernière modification</dt>
              <dd className="mt-0.5">{formatDateTime(tender.updatedAt)}</dd>
            </div>
            {tender.sourceUrl ? (
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-400">Consultation officielle</dt>
                <dd className="mt-0.5 break-all">
                  <a href={tender.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-esme-600 underline">
                    {tender.sourceUrl}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>

        {Array.isArray(tender.rectificatifs) && (tender.rectificatifs as unknown[]).length > 0 ? (
          <Card>
            <CardHeader title="Avis rectificatifs" subtitle="Rattachés automatiquement par la veille." />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {(tender.rectificatifs as { avis: string; type: string | null; recuLe: string; nouvelleDateLimite: string | null }[]).map(
                (item, index) => (
                  <li key={`${item.avis}-${index}`} className="px-5 py-3">
                    <p className="font-medium text-esme-900">{item.type ?? "Avis rectificatif"}</p>
                    <p className="mt-0.5 text-ink-600">
                      Avis {item.avis} · reçu le {new Date(item.recuLe).toLocaleDateString("fr-FR")}
                      {item.nouvelleDateLimite
                        ? ` · nouvelle date limite : ${new Date(item.nouvelleDateLimite).toLocaleDateString("fr-FR")}`
                        : ""}
                    </p>
                  </li>
                ),
              )}
            </ul>
          </Card>
        ) : null}

        {tender.children.length > 0 ? (
          <Card>
            <CardHeader title="Affaires de lot" subtitle="Créées depuis l'onglet Lots." />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {tender.children.map((child) => (
                <li key={child.id} className="px-5 py-2.5">
                  <Link href={`/affaires/${child.id}`} className="text-esme-600 hover:underline">
                    {child.reference} {child.lotLabel ? `· ${child.lotLabel}` : ""}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {tender.isDemo ? (
          <Notice tone="warn" title="Affaire de démonstration">
            Les données de cette fiche sont fictives et servent uniquement à la prise en main.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
