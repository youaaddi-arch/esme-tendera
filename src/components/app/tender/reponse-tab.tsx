"use client";

import Link from "next/link";
import { FileDown, FileText, Wand2 } from "lucide-react";

import { ActionButton, ActionForm, ActionSelect } from "@/components/app/action-form";
import { Badge, Card, CardHeader, EmptyState, Notice, Select, Table, Td, Th, Meter } from "@/components/ui";
import {
  buildWorkspaceAction, updateChecklistAction, updateTaskAction,
} from "@/app/(app)/affaires/[id]/actions";
import {
  formatDate, requirementStatusLabels, responseDocStatusLabels, responseDocTypeLabels, taskStatusLabels,
} from "@/lib/labels";
import { readContent, type AssignableUser, type TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Onglet 6 — espace de préparation de la réponse.
 *
 * Rassemble ce qu'un responsable appels d'offres doit avoir sous les yeux :
 * les documents produits, la checklist des pièces attendues, le planning, et
 * la liste des informations qui restent à fournir.
 */
export function ReponseTab({
  tender,
  users,
  permissions,
}: {
  tender: TenderDetail;
  users: AssignableUser[];
  permissions: Permission[];
}) {
  const canEdit = permissions.includes("response.edit");

  if (tender.responseDocs.length === 0 && tender.checklistItems.length === 0) {
    return (
      <Card>
        <CardHeader title="Espace de réponse" />
        <div className="p-5">
          <EmptyState
            title="L'espace de réponse n'a pas encore été créé"
            description={
              tender.goNoGo === "GO"
                ? "Générez la checklist, le planning et le premier jet du mémoire technique à partir du DCE analysé."
                : "L'espace est créé automatiquement lors d'une décision GO. Vous pouvez aussi le générer dès maintenant."
            }
            action={
              canEdit ? (
                <ActionButton
                  action={() => buildWorkspaceAction(tender.id)}
                  label="Générer l'espace de réponse"
                  variant="primary"
                  size="md"
                  icon={<Wand2 className="size-4" aria-hidden />}
                />
              ) : null
            }
          />
        </div>
      </Card>
    );
  }

  const memoire = tender.responseDocs.find((document) => document.type === "MEMOIRE_TECHNIQUE");
  const memoireContent = memoire ? readContent(memoire) : null;
  const sections = memoireContent?.sections ?? [];
  const written = sections.filter(
    (section) => section.body.length > 150 && !section.body.includes("[À COMPLÉTER]"),
  ).length;

  const byCategory = {
    administratif: tender.checklistItems.filter((item) => item.category === "administratif"),
    technique: tender.checklistItems.filter((item) => item.category === "technique"),
    financier: tender.checklistItems.filter((item) => item.category === "financier"),
  };

  const allGaps = [...new Set(tender.responseDocs.flatMap((document) => document.gaps))];

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {/* --- Documents produits --- */}
        <Card>
          <CardHeader
            title="Documents de réponse"
            subtitle="Éditables, versionnés et exportables."
            action={
              canEdit ? (
                <ActionButton
                  action={() => buildWorkspaceAction(tender.id)}
                  label="Régénérer"
                  size="sm"
                  confirm="Régénérer le plan ? La version actuelle du mémoire sera archivée, pas écrasée."
                />
              ) : null
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th className="w-36">Statut</Th>
                <Th className="w-28">Version</Th>
                <Th className="w-44">Export</Th>
              </tr>
            </thead>
            <tbody>
              {tender.responseDocs.map((document) => (
                <tr key={document.id}>
                  <Td>
                    <Link
                      href={`/affaires/${tender.id}/documents/${document.id}`}
                      className="flex items-start gap-2 text-[13px] font-medium text-esme-700 hover:underline"
                    >
                      <FileText className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                      <span>
                        {document.title}
                        <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
                          {responseDocTypeLabels[document.type]}
                        </span>
                      </span>
                    </Link>
                    {document.gaps.length > 0 ? (
                      <Badge tone="warn" className="ml-6 mt-1">
                        {document.gaps.length} information(s) à compléter
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={document.status === "VALIDE" ? "ok" : document.status === "EN_RELECTURE" ? "warn" : "neutral"}>
                      {responseDocStatusLabels[document.status]}
                    </Badge>
                  </Td>
                  <Td className="text-[13px] tabular-nums text-ink-600">v{document.version}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <ExportLink href={`/api/documents/reponse/${document.id}/export?format=docx`} label="Word" />
                      <ExportLink href={`/api/documents/reponse/${document.id}/export?format=md`} label="Markdown" />
                      {document.type === "OFFRE_FINANCIERE" ? (
                        <ExportLink href={`/api/documents/reponse/${document.id}/export?format=xlsx`} label="Excel" />
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {/* --- Checklist --- */}
        <Card>
          <CardHeader
            title="Checklist du dossier"
            subtitle="Pièces attendues. Une pièce obligatoire manquante peut rendre l'offre irrégulière."
          />
          <div className="divide-y divide-ink-100">
            {(["administratif", "technique", "financier"] as const).map((category) =>
              byCategory[category].length === 0 ? null : (
                <section key={category} className="p-5">
                  <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                    {category === "administratif" ? "Pièces administratives" : category === "technique" ? "Pièces techniques" : "Pièces financières"}
                  </h3>
                  <ul className="space-y-2">
                    {byCategory[category].map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] text-ink-800">
                            {item.label}
                            {item.mandatory ? <span className="ml-1 text-framboise-500" title="Obligatoire">*</span> : null}
                          </p>
                          {item.detail ? <p className="mt-0.5 text-[11px] text-ink-500">{item.detail}</p> : null}
                        </div>
                        {canEdit ? (
                          <ActionSelect
                            label={`Statut de ${item.label}`}
                            value={item.status}
                            action={(next) => updateChecklistAction(tender.id, item.id, next as never)}
                            options={Object.entries(requirementStatusLabels).map(([value, label]) => ({ value, label }))}
                            className="shrink-0"
                          />
                        ) : (
                          <Badge tone={item.status === "CONFORME" ? "ok" : item.status === "MANQUANT" ? "danger" : "warn"}>
                            {requirementStatusLabels[item.status]}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        </Card>

        {/* --- Planning --- */}
        {tender.tasks.length > 0 ? (
          <Card>
            <CardHeader
              title="Planning de préparation"
              subtitle="Jalons calés à rebours de la date limite de dépôt."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Tâche</Th>
                  <Th className="w-28">Échéance</Th>
                  <Th className="w-44">Responsable</Th>
                  <Th className="w-40">Statut</Th>
                </tr>
              </thead>
              <tbody>
                {tender.tasks.map((task) => (
                  <tr key={task.id}>
                    <Td>
                      <p className="text-[13px] text-ink-800">{task.title}</p>
                      {task.detail ? <p className="mt-0.5 text-[11px] text-ink-500">{task.detail}</p> : null}
                    </Td>
                    <Td className="text-[12px] text-ink-600">{formatDate(task.dueAt)}</Td>
                    <Td>
                      {canEdit ? (
                        <ActionForm
                          action={(formData) => updateTaskAction(tender.id, task.id, formData)}
                          submitLabel="Enregistrer"
                          submitSize="sm"
                          submitVariant="ghost"
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="status" value={task.status} />
                          <Select name="assigneeId" defaultValue={task.assigneeId ?? ""} className="h-8 text-[12px]">
                            <option value="">Non affecté</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>{user.name}</option>
                            ))}
                          </Select>
                        </ActionForm>
                      ) : (
                        <span className="text-[12px]">{task.assignee?.name ?? "Non affecté"}</span>
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <ActionSelect
                          label={`Statut de ${task.title}`}
                          value={task.status}
                          action={(next) => {
                            const formData = new FormData();
                            formData.set("status", next);
                            formData.set("assigneeId", task.assigneeId ?? "");
                            return updateTaskAction(tender.id, task.id, formData);
                          }}
                          options={Object.entries(taskStatusLabels).map(([value, label]) => ({ value, label }))}
                        />
                      ) : (
                        <Badge tone={task.status === "TERMINEE" ? "ok" : task.status === "BLOQUEE" ? "danger" : "neutral"}>
                          {taskStatusLabels[task.status]}
                        </Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}

        {/* --- Offre financière --- */}
        {tender.pricingLines.length > 0 ? (
          <Card>
            <CardHeader
              title="Offre financière"
              subtitle="Structure reprise du bordereau de l'acheteur. Aucun tarif n'est pré-rempli."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Prestation</Th>
                  <Th className="w-24">Unité</Th>
                  <Th className="w-24">Quantité</Th>
                  <Th className="w-32">Prix unitaire</Th>
                </tr>
              </thead>
              <tbody>
                {tender.pricingLines.slice(0, 40).map((line) => (
                  <tr key={line.id}>
                    <Td className="text-[13px]">{line.label}</Td>
                    <Td className="text-[12px] text-ink-600">{line.unit ?? "—"}</Td>
                    <Td className="text-[12px] tabular-nums text-ink-600">{line.quantity?.toString() ?? "—"}</Td>
                    <Td className="text-[13px] tabular-nums">
                      {line.unitPrice === null ? (
                        <span className="text-warn-700">à renseigner</span>
                      ) : (
                        `${Number(line.unitPrice).toLocaleString("fr-FR")} €`
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {tender.pricingLines.length > 40 ? (
              <p className="px-5 py-2 text-[12px] text-ink-500">
                {tender.pricingLines.length - 40} ligne(s) supplémentaire(s) — ouvrez le document d&apos;offre financière.
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>

      {/* --- Colonne droite --- */}
      <div className="space-y-5">
        {memoire ? (
          <Card>
            <CardHeader title="Avancement du mémoire" />
            <div className="p-5">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13px] text-ink-600">Sections rédigées</span>
                <span className="text-[13px] font-semibold tabular-nums text-esme-900">
                  {written}/{sections.length}
                </span>
              </div>
              <Meter value={sections.length === 0 ? 0 : (written / sections.length) * 100} />
              {memoireContent?.frameworkNote ? (
                <p className="mt-3 text-[12px] leading-relaxed text-ink-600">{memoireContent.frameworkNote}</p>
              ) : null}
              <Link
                href={`/affaires/${tender.id}/documents/${memoire.id}`}
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-esme-600 hover:underline"
              >
                Ouvrir l&apos;éditeur
                <FileDown className="size-3.5" aria-hidden />
              </Link>
            </div>
          </Card>
        ) : null}

        {allGaps.length > 0 ? (
          <Card className="border-warn-100">
            <CardHeader
              title="Informations à fournir"
              subtitle="TENDERA ne les invente pas : elles doivent venir de la base de connaissances."
              action={<Badge tone="warn">{allGaps.length}</Badge>}
            />
            <ul className="space-y-2 p-5 text-[12px] leading-relaxed text-ink-700">
              {allGaps.map((gap, index) => (
                <li key={index} className="tendera-chevron">{gap}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Notice tone="info" title="Règle de rédaction">
          Aucune référence client, aucun formateur, aucune certification et aucun tarif n&apos;est généré
          automatiquement. Partout où une telle donnée est nécessaire, le document porte un marqueur
          <code className="mx-1 font-mono text-[11px]">[À COMPLÉTER]</code> que seul un humain peut lever.
        </Notice>
      </div>
    </div>
  );
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-full border border-ink-300 px-2 py-0.5 text-[11px] text-esme-700 hover:border-esme-400 hover:bg-esme-50"
    >
      <FileDown className="size-3" aria-hidden />
      {label}
    </a>
  );
}
