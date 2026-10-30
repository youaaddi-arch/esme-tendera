import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";

import { CommentForm, DocumentEditor } from "@/components/app/document-editor";
import { ActionButton } from "@/components/app/action-form";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { addCommentAction, resolveCommentAction, restoreVersionAction } from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { formatDateTime, responseDocTypeLabels } from "@/lib/labels";
import { readContent } from "@/lib/tender-detail";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const session = await requireSession();
  const { id, docId } = await params;

  const document = await prisma.responseDocument.findUnique({
    where: { id: docId },
    include: {
      tender: { select: { id: true, reference: true, title: true, buyer: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 20,
        include: { author: { select: { name: true } } },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!document || document.tenderId !== id) notFound();

  const content = readContent(document);
  const sections = content.sections ?? [];
  const canEdit = can(session.role, "response.edit");
  const canValidate = can(session.role, "response.validate");
  const canComment = can(session.role, "response.comment");

  return (
    <div className="min-h-dvh">
      <PageHeader
        title={document.title}
        subtitle={
          <>
            {responseDocTypeLabels[document.type]} · version {document.version} ·{" "}
            <Link href={`/affaires/${id}?onglet=reponse`} className="text-esme-600 hover:underline">
              Retour à l&apos;affaire {document.tender.reference}
            </Link>
          </>
        }
        actions={
          <>
            <a
              href={`/api/documents/reponse/${document.id}/export?format=docx`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
            >
              <FileDown className="size-3.5" aria-hidden />
              Word
            </a>
            <a
              href={`/api/documents/reponse/${document.id}/export?format=md`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
            >
              <FileDown className="size-3.5" aria-hidden />
              Markdown
            </a>
            {document.type === "OFFRE_FINANCIERE" ? (
              <a
                href={`/api/documents/reponse/${document.id}/export?format=xlsx`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
              >
                <FileDown className="size-3.5" aria-hidden />
                Excel
              </a>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 p-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          {document.gaps.length > 0 ? (
            <Notice tone="warn" title={`${document.gaps.length} information(s) à compléter`} className="mb-4">
              <ul className="mt-1 space-y-1">
                {document.gaps.map((gap, index) => (
                  <li key={index}>— {gap}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {content.fields ? (
            <Card className="mb-4">
              <CardHeader
                title="Champs du formulaire"
                subtitle={content.note ?? undefined}
              />
              <dl className="divide-y divide-ink-100">
                {Object.entries(content.fields).map(([label, value]) => (
                  <div key={label} className="flex flex-wrap gap-2 px-5 py-2.5 text-[13px]">
                    <dt className="w-64 shrink-0 text-ink-500">{label}</dt>
                    <dd className={value.startsWith("[") ? "text-warn-700" : "text-ink-800"}>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          <DocumentEditor
            documentId={document.id}
            initialSections={sections}
            status={document.status}
            canEdit={canEdit}
            canValidate={canValidate}
            frameworkNote={content.frameworkNote}
          />
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Commentaires" action={<Badge tone="neutral">{document.comments.filter((comment) => !comment.resolved).length}</Badge>} />
            <div className="p-5">
              {canComment ? (
                <CommentForm
                  documentId={document.id}
                  sections={sections.map((section) => ({ id: section.id, heading: section.heading }))}
                  action={addCommentAction.bind(null, document.id)}
                />
              ) : (
                <p className="text-[13px] text-ink-500">Votre rôle ne permet pas de commenter.</p>
              )}
            </div>
            {document.comments.length > 0 ? (
              <ul className="divide-y divide-ink-100 border-t border-ink-100">
                {document.comments.map((comment) => {
                  const section = sections.find((item) => item.id === comment.sectionId);
                  return (
                    <li key={comment.id} className={comment.resolved ? "px-5 py-3 opacity-55" : "px-5 py-3"}>
                      <p className="text-[12px] text-ink-500">
                        {comment.author?.name ?? "Utilisateur"} · {formatDateTime(comment.createdAt)}
                        {section ? ` · ${section.heading}` : ""}
                      </p>
                      <p className="mt-1 text-[13px] text-ink-800">{comment.body}</p>
                      {comment.suggestion ? (
                        <p className="mt-1 rounded-lg bg-esme-50 p-2 text-[12px] italic text-esme-800">
                          Proposition : {comment.suggestion}
                        </p>
                      ) : null}
                      {!comment.resolved && canEdit ? (
                        <ActionButton
                          action={resolveCommentAction.bind(null, comment.id)}
                          label="Marquer résolu"
                          variant="ghost"
                          size="sm"
                          className="mt-1"
                        />
                      ) : null}
                      {comment.resolved ? <Badge tone="ok" className="mt-1">Résolu</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Historique des versions" subtitle="Chaque enregistrement crée une version." />
            {document.versions.length === 0 ? (
              <p className="px-5 py-6 text-center text-[13px] text-ink-500">
                Version initiale : aucune version antérieure.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {document.versions.map((version) => (
                  <li key={version.id} className="px-5 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-esme-900">v{version.version}</span>
                      <span className="text-[11px] text-ink-500">{formatDateTime(version.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {version.author?.name ?? "Système"}
                      {version.label ? ` · ${version.label}` : ""}
                    </p>
                    {canEdit ? (
                      <ActionButton
                        action={restoreVersionAction.bind(null, document.id, version.id)}
                        label="Restaurer"
                        variant="ghost"
                        size="sm"
                        confirm={`Restaurer la version ${version.version} ? La version actuelle sera archivée.`}
                        className="mt-1"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
