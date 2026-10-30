import Link from "next/link";
import { Download, Lock } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { markObsoleteAction, uploadKnowledgeAction, validateKnowledgeAction } from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { formatDate, knowledgeCategoryLabels } from "@/lib/labels";

export const metadata = { title: "Base de connaissances" };
export const dynamic = "force-dynamic";

/**
 * Base de connaissances documentaire.
 *
 * Alimente la rédaction des mémoires techniques : mémoires précédents,
 * réponses gagnantes, références, CV formateurs, documents qualité, tarifs.
 * Chaque document est indexé en fragments pour permettre la recherche et la
 * citation de ses passages.
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categorie?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const canEdit = can(session.role, "knowledge.edit");
  const canReadConfidential = can(session.role, "knowledge.readConfidential");

  const [entries, counts, chunkCount, results] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where: {
        ...(params.categorie ? { category: params.categorie as never } : {}),
        ...(canReadConfidential ? {} : { confidential: false }),
        ...(params.q
          ? {
              OR: [
                { title: { contains: params.q, mode: "insensitive" } },
                { summary: { contains: params.q, mode: "insensitive" } },
                { tags: { has: params.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: [{ obsolete: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { document: { select: { id: true, fileName: true, pageCount: true, extractionStatus: true, sizeBytes: true } } },
    }),
    prisma.knowledgeEntry.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.documentChunk.count({ where: { document: { scope: "CONNAISSANCE" } } }),
    // Recherche dans le contenu : passages correspondant à la requête.
    params.q
      ? prisma.documentChunk.findMany({
          where: {
            document: { scope: "CONNAISSANCE" },
            content: { contains: params.q, mode: "insensitive" },
          },
          take: 8,
          include: {
            document: {
              select: { id: true, fileName: true, knowledgeEntry: { select: { title: true, confidential: true } } },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const byCategory = Object.fromEntries(counts.map((row) => [row.category, row._count._all]));

  return (
    <>
      <PageHeader
        title="Base de connaissances"
        subtitle={`${entries.length} document(s) accessibles, ${chunkCount} fragment(s) indexés pour la recherche.`}
      />

      <div className="space-y-5 p-6">
        <Notice tone="info" title="Rôle de cette base">
          Elle alimente la rédaction : mémoires précédents, réponses gagnantes, références clients,
          CV formateurs, certifications, documents qualité et grilles tarifaires. Le moteur de
          rédaction s&apos;y réfère plutôt que d&apos;inventer — et quand une information manque, il laisse
          un marqueur <code className="font-mono text-[11px]">[À COMPLÉTER]</code> au lieu de produire
          une donnée plausible.
          <br />
          <strong>Recherche sémantique :</strong> l&apos;indexation en fragments est en place et la
          recherche lexicale fonctionne. La recherche vectorielle (RAG par embeddings) nécessite un
          fournisseur d&apos;embeddings et l&apos;extension <code className="font-mono text-[11px]">pgvector</code> ;
          elle n&apos;est pas encore activée.
        </Notice>

        <div className="grid gap-5 lg:grid-cols-4">
          <div className="space-y-5 lg:col-span-3">
            <Card>
              <form method="get" className="flex flex-wrap items-end gap-3 p-4">
                <label className="min-w-56 flex-1">
                  <span className="mb-1 block text-[12px] font-medium text-ink-700">Recherche</span>
                  <input
                    type="search"
                    name="q"
                    defaultValue={params.q ?? ""}
                    placeholder="Titre, mot-clé, ou passage du contenu…"
                    className="h-9 w-full rounded-lg border border-ink-300 px-3 text-sm placeholder:text-ink-400 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[12px] font-medium text-ink-700">Catégorie</span>
                  <select name="categorie" defaultValue={params.categorie ?? ""} className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm">
                    <option value="">Toutes</option>
                    {Object.entries(knowledgeCategoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}{byCategory[value] ? ` (${byCategory[value]})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="h-9 rounded-full bg-esme-600 px-4 text-sm font-medium text-white hover:bg-esme-700">
                  Rechercher
                </button>
                {params.q || params.categorie ? (
                  <Link href="/base-connaissances" className="pb-2 text-[13px] text-esme-600 hover:underline">
                    Réinitialiser
                  </Link>
                ) : null}
              </form>
            </Card>

            {results.length > 0 ? (
              <Card>
                <CardHeader
                  title="Passages trouvés dans le contenu"
                  subtitle={`${results.length} extrait(s) contenant « ${params.q} ».`}
                />
                <ul className="divide-y divide-ink-100">
                  {results
                    .filter((chunk) => canReadConfidential || !chunk.document.knowledgeEntry?.confidential)
                    .map((chunk) => (
                      <li key={chunk.id} className="px-5 py-3">
                        <p className="text-[12px] font-medium text-esme-800">
                          {chunk.document.knowledgeEntry?.title ?? chunk.document.fileName}
                          {chunk.page ? <span className="ml-1 font-normal text-ink-500">· page {chunk.page}</span> : null}
                        </p>
                        <p className="mt-1 border-l-2 border-framboise-300 pl-2 text-[12px] italic leading-relaxed text-ink-600">
                          {chunk.content.slice(0, 320)}…
                        </p>
                        <a
                          href={`/api/documents/${chunk.document.id}`}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-esme-600 hover:underline"
                        >
                          <Download className="size-3" aria-hidden />
                          Ouvrir le document
                        </a>
                      </li>
                    ))}
                </ul>
              </Card>
            ) : null}

            {entries.length === 0 ? (
              <EmptyState
                title="La base est vide"
                description="Déposez les mémoires techniques précédents, les références, les CV formateurs et les documents qualité pour alimenter la rédaction."
              />
            ) : (
              <Card>
                <CardHeader title={`${entries.length} document(s)`} />
                <Table>
                  <thead>
                    <tr>
                      <Th>Document</Th>
                      <Th className="w-48">Catégorie</Th>
                      <Th className="w-32">Validité</Th>
                      <Th className="w-40">État</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className={entry.obsolete ? "opacity-55" : ""}>
                        <Td>
                          <p className="text-[13px] font-medium text-esme-900">{entry.title}</p>
                          {entry.summary ? (
                            <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-600">{entry.summary}</p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {entry.confidential ? (
                              <Badge tone="danger">
                                <Lock className="size-3" aria-hidden />
                                Confidentiel
                              </Badge>
                            ) : null}
                            {entry.tags.map((tag) => (
                              <Badge key={tag} tone="neutral">{tag}</Badge>
                            ))}
                            <a
                              href={`/api/documents/${entry.document.id}`}
                              className="inline-flex items-center gap-1 text-[11px] text-esme-600 hover:underline"
                            >
                              <Download className="size-3" aria-hidden />
                              {entry.document.fileName}
                            </a>
                          </div>
                          {entry.document.extractionStatus !== "termine" ? (
                            <p className="mt-1 text-[11px] text-warn-700">
                              Contenu non indexé : ce document ne ressortira pas dans la recherche.
                            </p>
                          ) : null}
                        </Td>
                        <Td className="text-[12px]">{knowledgeCategoryLabels[entry.category]}</Td>
                        <Td className="text-[12px] text-ink-600">
                          {entry.validUntil ? formatDate(entry.validUntil) : "Sans limite"}
                          {entry.validUntil && entry.validUntil < new Date() ? (
                            <Badge tone="danger" className="mt-1">Périmé</Badge>
                          ) : null}
                        </Td>
                        <Td>
                          <div className="space-y-1">
                            {entry.obsolete ? (
                              <Badge tone="neutral">Obsolète</Badge>
                            ) : entry.validated ? (
                              <Badge tone="ok">Validé{entry.validatedBy ? ` · ${entry.validatedBy}` : ""}</Badge>
                            ) : (
                              <Badge tone="warn">À valider</Badge>
                            )}
                            {canEdit && !entry.obsolete ? (
                              <div className="flex flex-wrap gap-1">
                                {!entry.validated ? (
                                  <ActionButton action={validateKnowledgeAction.bind(null, entry.id)} label="Valider" variant="ghost" size="sm" />
                                ) : null}
                                <ActionButton
                                  action={markObsoleteAction.bind(null, entry.id)}
                                  label="Obsolète"
                                  variant="ghost"
                                  size="sm"
                                  confirm="Marquer ce document comme obsolète ? Il ne sera plus proposé à la rédaction."
                                />
                              </div>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}
          </div>

          <div className="space-y-5">
            {canEdit ? (
              <Card>
                <CardHeader title="Ajouter des documents" subtitle="PDF, DOCX, XLSX, ZIP." />
                <div className="p-5">
                  <ActionForm action={uploadKnowledgeAction} submitLabel="Importer" resetOnSuccess>
                    <div className="space-y-3">
                      <Field label="Catégorie" required>
                        <Select name="category" required defaultValue="MEMOIRE_TECHNIQUE">
                          {Object.entries(knowledgeCategoryLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Fichiers" required>
                        <Input
                          type="file"
                          name="fichiers"
                          multiple
                          required
                          className="h-auto py-2 file:mr-3 file:rounded-full file:border-0 file:bg-esme-50 file:px-3 file:py-1.5 file:text-[13px] file:text-esme-700"
                        />
                      </Field>
                      <Field label="Étiquettes" hint="Séparées par des virgules.">
                        <Input name="tags" placeholder="énergie, collectivité, gagné" />
                      </Field>
                      <Field label="Valable jusqu'au" hint="Au-delà, le document est signalé comme périmé.">
                        <Input type="date" name="validUntil" />
                      </Field>
                      <label className="flex items-start gap-2 text-[12px] text-ink-700">
                        <input type="checkbox" name="confidential" className="mt-0.5 size-4 accent-[var(--color-esme-600)]" />
                        Document confidentiel — réservé aux rôles habilités.
                      </label>
                    </div>
                  </ActionForm>
                </div>
              </Card>
            ) : (
              <Notice tone="info">Votre rôle permet la consultation, pas l&apos;ajout de documents.</Notice>
            )}

            <Card>
              <CardHeader title="Répartition" />
              <ul className="space-y-1.5 p-5 text-[12px]">
                {Object.entries(knowledgeCategoryLabels).map(([value, label]) => (
                  <li key={value} className="flex items-center justify-between gap-2">
                    <span className="text-ink-600">{label}</span>
                    <span className="tabular-nums text-ink-800">{byCategory[value] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
