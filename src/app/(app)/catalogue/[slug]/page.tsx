import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { originLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const training = await prisma.training.findUnique({ where: { slug }, select: { code: true, title: true } });
  return { title: training ? `${training.code} — ${training.title.slice(0, 50)}` : "Formation" };
}

/** Fiche détaillée d'une formation du référentiel. */
export default async function TrainingPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireSession();
  const { slug } = await params;

  const training = await prisma.training.findUnique({
    where: { slug },
    include: {
      domain: true,
      institution: true,
      matches: {
        orderBy: { score: "desc" },
        take: 10,
        include: {
          matchResult: {
            select: {
              tender: { select: { id: true, reference: true, title: true, buyer: true } },
            },
          },
        },
      },
    },
  });

  if (!training) notFound();

  const programme = Array.isArray(training.programme)
    ? (training.programme as { heading: string; items: string[] }[])
    : [];

  return (
    <>
      <PageHeader
        title={training.title}
        subtitle={
          <>
            <span className="font-mono">{training.code}</span> ·{" "}
            {training.domain?.name ?? training.theme ?? "Référentiel interne"} ·{" "}
            <Link href="/catalogue" className="text-esme-600 hover:underline">
              Retour au référentiel
            </Link>
          </>
        }
        actions={
          <Badge tone={training.origin === "CATALOGUE_ESME" ? "esme" : training.origin === "VOISINE" ? "warn" : "violet"}>
            {originLabels[training.origin]}
          </Badge>
        }
      />

      <div className="grid gap-5 p-6 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {training.objective ? (
            <Card>
              <CardHeader title="Objectif général" />
              <p className="p-5 text-[14px] leading-relaxed text-ink-800">{training.objective}</p>
            </Card>
          ) : null}

          {training.objectives.length > 0 ? (
            <Card>
              <CardHeader
                title="Objectifs pédagogiques"
                subtitle="À l'issue de la formation, le participant sera capable de :"
              />
              <ul className="space-y-2 p-5 text-[13px] text-ink-800">
                {training.objectives.map((objective, index) => (
                  <li key={index} className="tendera-chevron">{objective}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {programme.length > 0 ? (
            <Card>
              <CardHeader title="Programme détaillé" />
              <div className="divide-y divide-ink-100">
                {programme.map((block, index) => (
                  <section key={index} className="p-5">
                    <h3 className="text-[13px] font-semibold uppercase tracking-wide text-esme-800">
                      {block.heading}
                    </h3>
                    <ul className="mt-2 space-y-1.5 text-[13px] text-ink-700">
                      {block.items.map((item, position) => (
                        <li key={position} className="tendera-chevron">{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </Card>
          ) : null}

          {training.matches.length > 0 ? (
            <Card>
              <CardHeader
                title="Consultations rattachées"
                subtitle="Affaires où cette fiche ressort du matching."
              />
              <ul className="divide-y divide-ink-100">
                {training.matches.map((match) => (
                  <li key={match.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/affaires/${match.matchResult.tender.id}`}
                        className="text-[13px] font-medium text-esme-700 hover:underline"
                      >
                        {match.matchResult.tender.title}
                      </Link>
                      <p className="mt-0.5 text-[12px] text-ink-500">
                        {match.matchResult.tender.reference} · {match.matchResult.tender.buyer}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-esme-900">
                      {Math.round(match.score)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Caractéristiques" />
            <dl className="space-y-3 p-5 text-[13px]">
              <Entry label="Public cible" value={training.audience} />
              <Entry label="Durée" value={training.duration} />
              <Entry label="Volume horaire" value={training.hours ? `${training.hours} heures` : null} />
              <Entry label="Modalité" value={training.modality} />
              <Entry label="Formats" value={training.deliveryModes.join(", ")} />
              <Entry label="Certification" value={training.certification} />
              {training.intraOnly ? (
                <div>
                  <Badge tone="warn">Proposé en intra-entreprise uniquement</Badge>
                </div>
              ) : null}
            </dl>
          </Card>

          {training.prerequisites.length > 0 ? (
            <Card>
              <CardHeader title="Prérequis" />
              <ul className="space-y-1.5 p-5 text-[13px] text-ink-700">
                {training.prerequisites.map((item, index) => (
                  <li key={index} className="tendera-chevron">{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {training.methods.length > 0 ? (
            <Card>
              <CardHeader title="Méthodes et moyens pédagogiques" />
              <ul className="space-y-1.5 p-5 text-[13px] text-ink-700">
                {training.methods.map((item, index) => (
                  <li key={index} className="tendera-chevron">{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {training.relatedSkills.length > 0 ? (
            <Card>
              <CardHeader title="Compétences connexes" subtitle="Utilisées par le moteur de matching." />
              <div className="flex flex-wrap gap-1 p-5">
                {training.relatedSkills.map((skill) => (
                  <Badge key={skill} tone="neutral">{skill}</Badge>
                ))}
              </div>
            </Card>
          ) : null}

          {training.keywords.length > 0 ? (
            <Card>
              <CardHeader title="Mots-clés" />
              <div className="flex flex-wrap gap-1 p-5">
                {training.keywords.map((keyword) => (
                  <Badge key={keyword} tone="esme">{keyword}</Badge>
                ))}
              </div>
            </Card>
          ) : null}

          {training.highlights.length > 0 ? (
            <Card>
              <CardHeader title="Les +" />
              <ul className="space-y-2 p-5 text-[13px] text-ink-700">
                {training.highlights.map((item, index) => (
                  <li key={index} className="tendera-chevron">{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Source" />
            <div className="space-y-2 p-5 text-[12px] text-ink-600">
              {training.sourceDocument ? <p>{training.sourceDocument}</p> : null}
              {training.catalogPage ? <p>Page {training.catalogPage} du catalogue.</p> : null}
              {training.sourceUrl ? (
                <a href={training.sourceUrl} target="_blank" rel="noreferrer noopener" className="block break-all text-esme-600 underline">
                  {training.sourceUrl}
                </a>
              ) : null}
              <p className="text-ink-400">Version {training.version}</p>
            </div>
          </Card>

          {training.origin === "VOISINE" ? (
            <Notice tone="warn" title="Formation voisine">
              Cette fiche ne figure pas au catalogue ESME. Elle sert à ne pas manquer une consultation
              pertinente. Une compétence voisine n&apos;est pas une capacité de réalisation confirmée :
              toute réponse appuyée dessus suppose une validation par l&apos;ingénierie pédagogique.
            </Notice>
          ) : null}

          {training.institution ? (
            <Notice tone="warn" title={training.institution.name}>
              <p>{training.institution.description}</p>
              {training.institution.cooperation ? (
                <p className="mt-2">{training.institution.cooperation}</p>
              ) : null}
            </Notice>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Entry({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-ink-800">{value}</dd>
    </div>
  );
}
