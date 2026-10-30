import Link from "next/link";

import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata = { title: "Groupe IONIS" };
export const dynamic = "force-dynamic";

/**
 * Cartographie des compétences du Groupe IONIS.
 *
 * Elle sert à repérer qu'un besoin dépasse le périmètre de l'ESME et pourrait
 * être couvert par une autre entité du groupe. Elle ne vaut pas offre : aucun
 * établissement ne peut en engager un autre sans accord formel.
 */
export default async function IonisPage() {
  await requireSession();

  const institutions = await prisma.institution.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    include: {
      trainings: {
        where: { archived: false },
        include: { _count: { select: { matches: true } } },
      },
    },
  });

  const totalCapabilities = institutions.reduce((sum, institution) => sum + institution.trainings.length, 0);

  return (
    <>
      <PageHeader
        title="Compétences du Groupe IONIS"
        subtitle={`${institutions.length} établissement(s) cartographié(s), ${totalCapabilities} fiche(s) de compétences mobilisables.`}
      />

      <div className="space-y-5 p-6">
        <Notice tone="warn" title="Règle d'engagement">
          Cette cartographie décrit le champ d&apos;enseignement de chaque établissement d&apos;après ses
          pages publiques. Elle ne constitue ni une offre de formation continue catalogue, ni un
          engagement de disponibilité. <strong>Aucun établissement du groupe ne peut en engager un
          autre</strong> : toute réponse mobilisant une autre entité suppose un accord formel
          préalable — co-traitance, sous-traitance ou groupement.
        </Notice>

        <div className="grid gap-5 lg:grid-cols-2">
          {institutions.map((institution) => (
            <Card key={institution.id}>
              <CardHeader
                title={institution.name}
                subtitle={institution.description ?? undefined}
                action={<Badge tone="violet">{institution.shortName ?? ""}</Badge>}
              />
              <div className="space-y-4 p-5">
                {institution.domains.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-400">Domaines</p>
                    <div className="flex flex-wrap gap-1">
                      {institution.domains.map((domain) => (
                        <Badge key={domain} tone="esme">{domain}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {institution.skills.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-400">Compétences</p>
                    <ul className="space-y-1 text-[13px] text-ink-700">
                      {institution.skills.map((skill) => (
                        <li key={skill} className="tendera-chevron">{skill}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {institution.trainings.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-400">
                      Fiches indexées par le matching
                    </p>
                    <ul className="space-y-2">
                      {institution.trainings.map((training) => (
                        <li key={training.id} className="rounded-lg border border-ink-200 p-2.5">
                          <Link
                            href={`/catalogue/${training.slug}`}
                            className="text-[13px] font-medium text-esme-700 hover:underline"
                          >
                            {training.title}
                          </Link>
                          <p className="mt-0.5 font-mono text-[11px] text-ink-400">{training.code}</p>
                          {training.objective ? (
                            <p className="mt-1 text-[12px] text-ink-600">{training.objective}</p>
                          ) : null}
                          {training._count.matches > 0 ? (
                            <p className="mt-1 text-[11px] text-ink-500">
                              Ressortie sur {training._count.matches} consultation(s)
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {institution.cooperation ? (
                  <div className="rounded-lg bg-warn-50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-warn-700">Coopération</p>
                    <p className="mt-0.5 text-[12px] text-warn-700">{institution.cooperation}</p>
                  </div>
                ) : null}

                {institution.sourceUrl ? (
                  <p className="text-[11px] text-ink-400">
                    Source :{" "}
                    <a href={institution.sourceUrl} target="_blank" rel="noreferrer noopener" className="break-all underline">
                      {institution.sourceUrl}
                    </a>
                  </p>
                ) : null}
              </div>
            </Card>
          ))}
        </div>

        <Notice tone="info" title="Périmètre de la cartographie">
          Le Groupe IONIS compte 27 écoles et entités. Seules celles dont les domaines recoupent les
          marchés de formation continue visés par l&apos;ESME sont reprises ici. Pour en ajouter une,
          passez par l&apos;administration du référentiel.
        </Notice>
      </div>
    </>
  );
}
