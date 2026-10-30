import Link from "next/link";

import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { originLabels } from "@/lib/labels";

export const metadata = { title: "Référentiel de formations" };
export const dynamic = "force-dynamic";

/**
 * Référentiel pédagogique.
 *
 * Trois familles, affichées dans l'ordre de priorité du moteur de matching :
 * catalogue ESME, formations voisines, compétences du Groupe IONIS. Chaque
 * fiche porte sa source — pour le catalogue, le document et la page d'origine.
 */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; origine?: string; domaine?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const canEdit = can(session.role, "catalogue.edit");

  const [trainings, domains, counts] = await Promise.all([
    prisma.training.findMany({
      where: {
        archived: false,
        ...(params.origine ? { origin: params.origine as never } : {}),
        ...(params.domaine ? { domain: { slug: params.domaine } } : {}),
        ...(params.q
          ? {
              OR: [
                { title: { contains: params.q, mode: "insensitive" } },
                { code: { contains: params.q, mode: "insensitive" } },
                { objective: { contains: params.q, mode: "insensitive" } },
                { keywords: { has: params.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: [{ origin: "asc" }, { code: "asc" }],
      include: {
        domain: { select: { name: true, slug: true } },
        institution: { select: { shortName: true, name: true } },
        _count: { select: { matches: true } },
      },
    }),
    prisma.trainingDomain.findMany({ orderBy: { position: "asc" } }),
    prisma.training.groupBy({ by: ["origin"], where: { archived: false }, _count: { _all: true } }),
  ]);

  const byOrigin = Object.fromEntries(counts.map((row) => [row.origin, row._count._all]));

  return (
    <>
      <PageHeader
        title="Référentiel de formations"
        subtitle={`${byOrigin.CATALOGUE_ESME ?? 0} formations du catalogue ESME, ${byOrigin.VOISINE ?? 0} formations voisines, ${byOrigin.IONIS ?? 0} compétences du Groupe IONIS.`}
        actions={
          canEdit ? (
            <LinkButton href="/admin/catalogue" size="sm">
              Administrer le référentiel
            </LinkButton>
          ) : null
        }
      />

      <div className="space-y-5 p-6">
        <Notice tone="info" title="Source du référentiel">
          Les fiches du catalogue sont extraites du document officiel
          {" "}<strong>ESME-EE_Catalogue_2027.pdf</strong> (68 pages) : intitulé, objectif général,
          public cible, objectifs pédagogiques, prérequis, durée, modalité et programme détaillé.
          Chaque fiche renvoie à sa page dans le catalogue. Les formations voisines et la
          cartographie IONIS sont des référentiels internes, signalés comme tels.
        </Notice>

        {/* --- Filtres --- */}
        <Card>
          <form method="get" className="flex flex-wrap items-end gap-3 p-4">
            <label className="flex-1 min-w-56">
              <span className="mb-1 block text-[12px] font-medium text-ink-700">Recherche</span>
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Intitulé, référence, mot-clé…"
                className="h-9 w-full rounded-lg border border-ink-300 px-3 text-sm placeholder:text-ink-400 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25"
              />
            </label>
            <label>
              <span className="mb-1 block text-[12px] font-medium text-ink-700">Famille</span>
              <select
                name="origine"
                defaultValue={params.origine ?? ""}
                className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm"
              >
                <option value="">Toutes</option>
                {Object.entries(originLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[12px] font-medium text-ink-700">Domaine</span>
              <select
                name="domaine"
                defaultValue={params.domaine ?? ""}
                className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm"
              >
                <option value="">Tous</option>
                {domains.map((domain) => (
                  <option key={domain.slug} value={domain.slug}>{domain.name}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-9 rounded-full bg-esme-600 px-4 text-sm font-medium text-white hover:bg-esme-700"
            >
              Filtrer
            </button>
            {params.q || params.origine || params.domaine ? (
              <Link href="/catalogue" className="text-[13px] text-esme-600 hover:underline">
                Réinitialiser
              </Link>
            ) : null}
          </form>
        </Card>

        {trainings.length === 0 ? (
          <EmptyState
            title="Aucune formation ne correspond"
            description="Élargissez la recherche, ou vérifiez que le référentiel a bien été importé."
          />
        ) : (
          <Card>
            <CardHeader title={`${trainings.length} fiche(s)`} />
            <Table>
              <thead>
                <tr>
                  <Th className="w-32">Référence</Th>
                  <Th>Formation</Th>
                  <Th className="w-44">Domaine</Th>
                  <Th className="w-32">Durée</Th>
                  <Th className="w-28">Source</Th>
                </tr>
              </thead>
              <tbody>
                {trainings.map((training) => (
                  <tr key={training.id}>
                    <Td>
                      <Link
                        href={`/catalogue/${training.slug}`}
                        className="font-mono text-[12px] font-medium text-esme-700 hover:underline"
                      >
                        {training.code}
                      </Link>
                      <Badge
                        tone={training.origin === "CATALOGUE_ESME" ? "esme" : training.origin === "VOISINE" ? "warn" : "violet"}
                        className="mt-1"
                      >
                        {originLabels[training.origin]}
                      </Badge>
                    </Td>
                    <Td>
                      <Link href={`/catalogue/${training.slug}`} className="text-[13px] font-medium text-esme-900 hover:text-esme-600">
                        {training.title}
                      </Link>
                      {training.objective ? (
                        <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-600">{training.objective}</p>
                      ) : null}
                      {training._count.matches > 0 ? (
                        <p className="mt-1 text-[11px] text-ink-500">
                          Citée dans {training._count.matches} matching(s)
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-[12px]">
                      {training.domain?.name ?? training.theme ?? "—"}
                      {training.institution ? (
                        <Badge tone="violet" className="mt-1">
                          {training.institution.shortName ?? training.institution.name}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-[12px] text-ink-600">
                      {training.duration ?? "—"}
                      {training.modality ? (
                        <span className="mt-0.5 block text-[11px] text-ink-400">{training.modality}</span>
                      ) : null}
                    </Td>
                    <Td className="text-[11px] text-ink-500">
                      {training.catalogPage ? `Catalogue p. ${training.catalogPage}` : training.sourceDocument ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
