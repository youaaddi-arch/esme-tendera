import Link from "next/link";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Table, Td, Textarea, Th } from "@/components/ui";
import { archiveTrainingAction, updateTrainingAction } from "../actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { originLabels } from "@/lib/labels";

export const metadata = { title: "Administration du référentiel" };
export const dynamic = "force-dynamic";

/**
 * Administration du référentiel pédagogique.
 *
 * Toute modification incrémente la version de la fiche et relance le matching
 * des affaires actives : une correction de compétence doit se répercuter sur
 * les consultations en cours, sinon elle n'a aucun effet pratique.
 */
export default async function AdminCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ fiche?: string; q?: string; archivees?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "catalogue.edit")) {
    return (
      <>
        <PageHeader title="Administration du référentiel" />
        <div className="p-6">
          <Notice tone="danger">Votre rôle ne permet pas de modifier le référentiel.</Notice>
        </div>
      </>
    );
  }

  const params = await searchParams;
  const showArchived = params.archivees === "1";

  const [trainings, selected] = await Promise.all([
    prisma.training.findMany({
      where: {
        archived: showArchived,
        ...(params.q
          ? {
              OR: [
                { title: { contains: params.q, mode: "insensitive" } },
                { code: { contains: params.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ origin: "asc" }, { code: "asc" }],
      select: {
        id: true, code: true, title: true, origin: true, version: true, archived: true,
        duration: true, catalogPage: true,
      },
    }),
    params.fiche
      ? prisma.training.findUnique({ where: { id: params.fiche }, include: { domain: true } })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Administration du référentiel"
        subtitle="Modifier une fiche incrémente sa version et recalcule le matching des affaires actives."
        actions={
          <Link
            href="/admin"
            className="inline-flex h-8 items-center rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:bg-esme-50"
          >
            Retour à l&apos;administration
          </Link>
        }
      />

      <div className="grid gap-5 p-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={`${trainings.length} fiche(s)`} subtitle={showArchived ? "Fiches archivées." : "Fiches actives."} />
          <form method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 p-4">
            <input
              type="search"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Intitulé ou référence"
              className="h-9 flex-1 rounded-lg border border-ink-300 px-3 text-sm"
            />
            <label className="flex items-center gap-1.5 pb-2 text-[13px] text-ink-700">
              <input type="checkbox" name="archivees" value="1" defaultChecked={showArchived} className="size-4 accent-[var(--color-esme-600)]" />
              Archivées
            </label>
            <button type="submit" className="h-9 rounded-full bg-esme-600 px-4 text-sm font-medium text-white hover:bg-esme-700">
              Filtrer
            </button>
          </form>
          <Table>
            <thead>
              <tr>
                <Th className="w-28">Référence</Th>
                <Th>Formation</Th>
                <Th className="w-20">Version</Th>
                <Th className="w-48">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {trainings.map((training) => (
                <tr key={training.id} className={training.archived ? "opacity-55" : ""}>
                  <Td>
                    <span className="font-mono text-[12px] text-esme-700">{training.code}</span>
                    <Badge
                      tone={training.origin === "CATALOGUE_ESME" ? "esme" : training.origin === "VOISINE" ? "warn" : "violet"}
                      className="mt-1"
                    >
                      {originLabels[training.origin]}
                    </Badge>
                  </Td>
                  <Td>
                    <p className="text-[13px] text-esme-900">{training.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {training.duration ?? "durée non renseignée"}
                      {training.catalogPage ? ` · catalogue p. ${training.catalogPage}` : ""}
                    </p>
                  </Td>
                  <Td className="text-[12px] tabular-nums text-ink-600">v{training.version}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <Link
                        href={`/admin/catalogue?fiche=${training.id}${params.q ? `&q=${params.q}` : ""}${showArchived ? "&archivees=1" : ""}`}
                        className="inline-flex h-8 items-center rounded-full border border-ink-300 px-3 text-[12px] text-esme-800 hover:bg-esme-50"
                      >
                        Modifier
                      </Link>
                      <ActionButton
                        action={archiveTrainingAction.bind(null, training.id, !training.archived)}
                        label={training.archived ? "Réactiver" : "Archiver"}
                        variant="ghost"
                        size="sm"
                        confirm={
                          training.archived
                            ? undefined
                            : "Archiver cette fiche ? Elle sortira du matching et les affaires actives seront recalculées."
                        }
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-5">
          {selected ? (
            <Card>
              <CardHeader
                title={`Modifier ${selected.code}`}
                subtitle={`Version ${selected.version} · ${originLabels[selected.origin]}`}
              />
              <div className="p-5">
                <ActionForm
                  action={updateTrainingAction.bind(null, selected.id)}
                  submitLabel="Enregistrer et recalculer"
                  submitSize="sm"
                >
                  <div className="space-y-3">
                    <Field label="Intitulé" required>
                      <Input name="title" defaultValue={selected.title} required />
                    </Field>
                    <Field label="Objectif général">
                      <Textarea name="objective" rows={3} defaultValue={selected.objective ?? ""} />
                    </Field>
                    <Field label="Public cible">
                      <Textarea name="audience" rows={2} defaultValue={selected.audience ?? ""} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Durée">
                        <Input name="duration" defaultValue={selected.duration ?? ""} />
                      </Field>
                      <Field label="Modalité">
                        <Input name="modality" defaultValue={selected.modality ?? ""} />
                      </Field>
                    </div>
                    <Field label="Certification">
                      <Input name="certification" defaultValue={selected.certification ?? ""} />
                    </Field>
                    <Field label="Compétences visées" hint="Une par ligne. Utilisées en premier par le matching.">
                      <Textarea name="skills" rows={6} defaultValue={selected.skills.join("\n")} />
                    </Field>
                    <Field label="Compétences connexes" hint="Une par ligne.">
                      <Textarea name="relatedSkills" rows={5} defaultValue={selected.relatedSkills.join("\n")} />
                    </Field>
                    <Field label="Mots-clés" hint="Séparés par des virgules ou des retours à la ligne.">
                      <Textarea name="keywords" rows={3} defaultValue={selected.keywords.join(", ")} />
                    </Field>
                  </div>
                </ActionForm>
              </div>
            </Card>
          ) : (
            <Notice tone="info" title="Sélectionnez une fiche">
              Choisissez « Modifier » sur une fiche pour éditer son contenu. Les champs qui pèsent le
              plus sur le matching sont les compétences visées, les compétences connexes et les
              mots-clés.
            </Notice>
          )}

          <Notice tone="warn" title="Import de catalogue">
            L&apos;import direct de fichiers PDF, Word ou Excel pour alimenter le référentiel n&apos;est pas
            encore implémenté dans l&apos;interface. Le référentiel actuel a été produit par le script
            {" "}<code className="font-mono text-[11px]">scripts/build-catalogue.ts</code>, qui lit une
            extraction structurée du catalogue et génère{" "}
            <code className="font-mono text-[11px]">src/data/catalogue-esme.json</code>. Pour une
            nouvelle édition du catalogue, c&apos;est ce script qu&apos;il faut rejouer, puis{" "}
            <code className="font-mono text-[11px]">npm run db:seed</code>.
          </Notice>
        </div>
      </div>
    </>
  );
}
