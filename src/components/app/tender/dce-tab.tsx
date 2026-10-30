"use client";

import { AlertTriangle, Download, FileWarning, Trash2 } from "lucide-react";

import { ActionButton, ActionForm, ActionSelect } from "@/components/app/action-form";
import { Card, CardHeader, Field, Input, Notice, Table, Td, Th } from "@/components/ui";
import {
  deleteDocumentAction, markDceUnavailableAction, reclassifyDocumentAction, uploadDceAction,
} from "@/app/(app)/affaires/[id]/actions";
import { dceStatusLabels, documentKindLabels, formatDateTime } from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Onglet 3 — pièces du dossier de consultation.
 *
 * TENDERA ne prétend jamais avoir analysé un DCE qu'il n'a pas. Tant qu'aucune
 * pièce lisible n'est présente, l'onglet le dit et propose l'import manuel, en
 * rappelant le lien vers la consultation d'origine.
 */
export function DceTab({ tender, permissions }: { tender: TenderDetail; permissions: Permission[] }) {
  const canUpload = permissions.includes("dce.upload");
  const dce = tender.documents.filter((document) => document.scope === "DCE");
  const readable = dce.filter((document) => document.extractionStatus === "termine");
  const unreadable = dce.filter((document) => document.extractionStatus !== "termine");

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {dce.length === 0 ? (
          <Card>
            <CardHeader title="Aucune pièce importée" />
            <div className="p-5">
              <Notice tone={tender.dceStatus === "NON_RECUPERE" ? "danger" : "warn"} title={dceStatusLabels[tender.dceStatus]}>
                {tender.dceFailureReason ? (
                  <p className="mb-2">{tender.dceFailureReason}</p>
                ) : (
                  <p className="mb-2">
                    La récupération automatique du dossier n&apos;a pas eu lieu. Sur la plupart des profils
                    d&apos;acheteur, le retrait du DCE est nominatif et suppose un compte opérateur
                    économique : TENDERA ne contourne aucune protection.
                  </p>
                )}
                {tender.dceSourceUrl || tender.sourceUrl ? (
                  <p>
                    Téléchargez le dossier depuis{" "}
                    <a
                      href={tender.dceSourceUrl ?? tender.sourceUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium underline"
                    >
                      la consultation d&apos;origine
                    </a>
                    , puis importez-le ci-contre.
                  </p>
                ) : (
                  <p>Aucun lien de consultation n&apos;est enregistré : renseignez-le dans l&apos;onglet Informations.</p>
                )}
              </Notice>
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Pièces du dossier de consultation"
              subtitle={`${dce.length} pièce(s), dont ${readable.length} analysable(s).`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Pièce</Th>
                  <Th className="w-64">Type identifié</Th>
                  <Th className="w-28">Pages</Th>
                  <Th className="w-32">Importée</Th>
                  <Th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {dce.map((document) => (
                  <tr key={document.id}>
                    <Td>
                      <p className="font-medium text-esme-900">{document.fileName}</p>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        {document.sizeBytes ? `${Math.round(document.sizeBytes / 1024)} Ko` : ""}
                        {document.fromArchive ? ` · extrait de ${document.fromArchive}` : ""}
                      </p>
                      {document.extractionError ? (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-warn-700">
                          <FileWarning className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {document.extractionError}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      {canUpload ? (
                        <ActionSelect
                          label="Type de pièce"
                          value={document.kind}
                          action={(next) => reclassifyDocumentAction(tender.id, document.id, next)}
                          options={Object.entries(documentKindLabels).map(([value, label]) => ({
                            value,
                            label: label.split(" — ")[0],
                          }))}
                        />
                      ) : (
                        <span className="text-[13px]">{documentKindLabels[document.kind].split(" — ")[0]}</span>
                      )}
                      {/* La confiance de la classification est affichée telle quelle :
                          en dessous de 50 %, le type est à confirmer à la main. */}
                      <p className="mt-1 text-[11px] text-ink-500">
                        {document.kindConfidence >= 0.9
                          ? "Type confirmé"
                          : document.kindConfidence >= 0.5
                            ? `Confiance ${Math.round(document.kindConfidence * 100)} %`
                            : "Type à confirmer"}
                      </p>
                    </Td>
                    <Td className="text-[13px] tabular-nums">{document.pageCount ?? "—"}</Td>
                    <Td className="text-[12px] text-ink-600">{formatDateTime(document.uploadedAt)}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <a
                          href={`/api/documents/${document.id}`}
                          className="rounded-lg p-1.5 text-ink-500 hover:bg-esme-50 hover:text-esme-700"
                          title="Télécharger"
                        >
                          <Download className="size-4" aria-hidden />
                          <span className="sr-only">Télécharger {document.fileName}</span>
                        </a>
                        {canUpload ? (
                          <ActionButton
                            action={() => deleteDocumentAction(tender.id, document.id)}
                            label=""
                            variant="ghost"
                            size="sm"
                            confirm={`Supprimer définitivement « ${document.fileName} » ?`}
                            icon={<Trash2 className="size-4" aria-hidden />}
                          />
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        {unreadable.length > 0 ? (
          <Notice tone="warn" title={`${unreadable.length} pièce(s) non analysable(s)`}>
            Ces pièces sont stockées et téléchargeables, mais leur contenu n&apos;entre pas dans
            l&apos;analyse ni dans le matching. Les causes les plus fréquentes : PDF scanné sans
            couche texte, ou format .doc ancien.
          </Notice>
        ) : null}
      </div>

      <div className="space-y-5">
        {canUpload ? (
          <>
            <Card>
              <CardHeader title="Importer le DCE" subtitle="PDF, DOCX, XLSX, ZIP. Les archives sont dépliées." />
              <div className="p-5">
                <ActionForm
                  action={(formData) => uploadDceAction(tender.id, formData)}
                  submitLabel="Importer et classer"
                  resetOnSuccess
                >
                  <Field label="Pièces à importer" required>
                    <Input
                      type="file"
                      name="fichiers"
                      multiple
                      required
                      accept=".pdf,.docx,.xlsx,.xls,.xlsm,.zip,.txt,.csv,.md"
                      className="h-auto py-2 file:mr-3 file:rounded-full file:border-0 file:bg-esme-50 file:px-3 file:py-1.5 file:text-[13px] file:text-esme-700"
                    />
                  </Field>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                    Chaque pièce est stockée, son texte extrait page par page, et son type identifié.
                    Les doublons sont détectés par empreinte et ignorés.
                  </p>
                </ActionForm>
              </div>
            </Card>

            <Card>
              <CardHeader title="DCE non récupérable" />
              <div className="p-5">
                <ActionForm
                  action={(formData) => markDceUnavailableAction(tender.id, formData)}
                  submitLabel="Marquer comme non récupéré"
                  submitVariant="secondary"
                  submitSize="sm"
                >
                  <Field label="Raison" hint="Affichée sur la fiche et au journal.">
                    <Input
                      name="reason"
                      placeholder="Retrait nominatif requis sur le profil d'acheteur"
                      defaultValue={tender.dceFailureReason ?? ""}
                    />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          </>
        ) : (
          <Notice tone="info">Votre rôle ne permet pas l&apos;import de pièces.</Notice>
        )}

        <Notice tone="info" title="Ce que fait l'analyse">
          <ul className="mt-1 space-y-1">
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              Elle lit le texte des pièces et en extrait ce qui est écrit.
            </li>
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              Elle ne remplace pas la lecture du dossier et n&apos;a pas de valeur juridique.
            </li>
          </ul>
        </Notice>
      </div>
    </div>
  );
}
