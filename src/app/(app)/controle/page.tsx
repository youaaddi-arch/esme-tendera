import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Badge, Card, CardHeader, EmptyState, Meter, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, stageLabels } from "@/lib/labels";

export const metadata = { title: "Contrôle de dossier" };
export const dynamic = "force-dynamic";

type Blocker = { severite: "bloquant" | "majeur"; sujet: string; detail: string; documentCible: string | null };

/**
 * Vue transverse des contrôles.
 *
 * Donne en un écran l'état de tous les dossiers en préparation : où en est
 * chacun, et lesquels portent une alerte bloquante. Le contrôle lui-même se
 * lance depuis la fiche de l'affaire, où se trouve le dossier.
 */
export default async function ControlePage() {
  await requireSession();

  const tenders = await prisma.tender.findMany({
    where: {
      archived: false,
      stage: { in: ["PREPARATION", "CONTROLE_QUALITE", "PRET_AU_DEPOT"] },
    },
    orderBy: { deadlineAt: "asc" },
    include: {
      qualityReviews: { orderBy: { createdAt: "desc" }, take: 1 },
      checklistItems: { select: { mandatory: true, status: true } },
      _count: { select: { responseDocs: true } },
    },
  });

  const withBlockers = tenders.filter((tender) => {
    const blockers = (tender.qualityReviews[0]?.blockers as unknown as Blocker[]) ?? [];
    return blockers.some((blocker) => blocker.severite === "bloquant");
  });

  const neverChecked = tenders.filter((tender) => tender.qualityReviews.length === 0);

  return (
    <>
      <PageHeader
        title="Contrôle des dossiers"
        subtitle={`${tenders.length} dossier(s) en préparation. ${withBlockers.length} portent une alerte bloquante, ${neverChecked.length} n'ont jamais été contrôlés.`}
      />

      <div className="space-y-5 p-6">
        {withBlockers.length > 0 ? (
          <Notice tone="danger" title={`${withBlockers.length} dossier(s) avec alerte bloquante`}>
            Une pièce obligatoire manquante ou une non-conformité potentiellement éliminatoire prime
            sur le niveau des autres scores : traitez-les avant toute autre correction.
          </Notice>
        ) : null}

        {neverChecked.length > 0 ? (
          <Notice tone="warn" title={`${neverChecked.length} dossier(s) jamais contrôlés`}>
            Un dossier non contrôlé n&apos;est pas un dossier conforme : l&apos;absence d&apos;alerte ne veut rien
            dire tant que le contrôle n&apos;a pas tourné.
          </Notice>
        ) : null}

        {tenders.length === 0 ? (
          <EmptyState
            title="Aucun dossier en préparation"
            description="Les dossiers apparaissent ici après une décision GO."
          />
        ) : (
          <Card>
            <CardHeader title="État des dossiers" />
            <Table>
              <thead>
                <tr>
                  <Th>Affaire</Th>
                  <Th className="w-40">Étape</Th>
                  <Th className="w-28">Date limite</Th>
                  <Th className="w-64">Scores du dernier contrôle</Th>
                  <Th className="w-44">Alertes</Th>
                </tr>
              </thead>
              <tbody>
                {tenders.map((tender) => {
                  const review = tender.qualityReviews[0];
                  const blockers = (review?.blockers as unknown as Blocker[]) ?? [];
                  const blocking = blockers.filter((blocker) => blocker.severite === "bloquant");
                  const mandatory = tender.checklistItems.filter((item) => item.mandatory);
                  const done = mandatory.filter((item) => item.status === "CONFORME" || item.status === "NON_APPLICABLE");

                  return (
                    <tr key={tender.id}>
                      <Td>
                        <Link href={`/affaires/${tender.id}?onglet=controle`} className="text-[13px] font-medium text-esme-700 hover:underline">
                          {tender.title}
                        </Link>
                        <p className="mt-0.5 text-[12px] text-ink-500">
                          {tender.reference} · {tender.buyer}
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-400">
                          {done.length}/{mandatory.length} pièce(s) obligatoire(s) · {tender._count.responseDocs} document(s)
                        </p>
                      </Td>
                      <Td><Badge tone="esme">{stageLabels[tender.stage]}</Badge></Td>
                      <Td className="text-[12px]">{formatDate(tender.deadlineAt)}</Td>
                      <Td>
                        {review ? (
                          <div className="space-y-1.5">
                            <ScoreRow label="Complétude" value={review.completeness} />
                            <ScoreRow label="Qualité" value={review.quality} />
                            <ScoreRow label="Conformité" value={review.compliance} />
                            <p className="text-[11px] text-ink-400">{formatDateTime(review.createdAt)}</p>
                          </div>
                        ) : (
                          <Link
                            href={`/affaires/${tender.id}?onglet=controle`}
                            className="inline-flex items-center gap-1.5 text-[12px] text-esme-600 hover:underline"
                          >
                            <ShieldCheck className="size-3.5" aria-hidden />
                            Jamais contrôlé — lancer l&apos;analyse
                          </Link>
                        )}
                      </Td>
                      <Td>
                        {blocking.length > 0 ? (
                          <div className="space-y-1">
                            <Badge tone="danger">{blocking.length} bloquante(s)</Badge>
                            <p className="text-[11px] leading-snug text-danger-600">{blocking[0].sujet}</p>
                          </div>
                        ) : review ? (
                          <Badge tone="ok">Aucune</Badge>
                        ) : (
                          <Badge tone="neutral">Inconnu</Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}

        <Notice tone="info" title="Portée du contrôle">
          Le contrôle compare le dossier saisi dans TENDERA aux exigences relevées dans le DCE. Il ne
          relit pas les fichiers déposés chez l&apos;acheteur, ne vérifie pas les signatures et n&apos;a pas de
          valeur juridique. Les notes sont une aide à la décision, pas une garantie de recevabilité.
        </Notice>
      </div>
    </>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-ink-500">{label}</span>
        <span className="tabular-nums text-ink-800">{Math.round(value)}</span>
      </div>
      <Meter value={value} tone={value >= 80 ? "ok" : value >= 50 ? "warn" : "danger"} />
    </div>
  );
}
