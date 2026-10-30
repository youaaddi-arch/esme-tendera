import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, Radar, Target } from "lucide-react";

import { PipelineFunnel, RankedBars, TrendArea } from "@/components/app/charts";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, ScorePill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatAmount, formatDeadline, stageLabels } from "@/lib/labels";
import { getDashboardStats } from "@/lib/stats";

export const metadata = { title: "Tableau de bord" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSession();

  const [stats, urgent, toDecide, lastRun, demoCount] = await Promise.all([
    getDashboardStats(),
    prisma.tender.findMany({
      where: {
        archived: false,
        deadlineAt: { gte: new Date() },
        stage: { in: ["PREPARATION", "CONTROLE_QUALITE", "PRET_AU_DEPOT", "GO_NO_GO"] },
      },
      orderBy: { deadlineAt: "asc" },
      take: 6,
      select: { id: true, reference: true, title: true, buyer: true, deadlineAt: true, stage: true, isDemo: true },
    }),
    prisma.tender.findMany({
      where: { archived: false, goNoGo: "A_DECIDER", stage: { in: ["MATCHING", "GO_NO_GO"] } },
      orderBy: [{ matchResult: { scoreGlobal: "desc" } }, { deadlineAt: "asc" }],
      take: 6,
      select: {
        id: true, reference: true, title: true, buyer: true, deadlineAt: true, isDemo: true,
        matchResult: { select: { scoreGlobal: true } },
      },
    }),
    prisma.veilleRun.findFirst({
      orderBy: { startedAt: "desc" },
      include: { connector: { select: { name: true } } },
    }),
    prisma.tender.count({ where: { isDemo: true, archived: false } }),
  ]);

  const funnelSteps = (
    ["AO_IDENTIFIES", "MATCHING", "GO_NO_GO", "PREPARATION", "CONTROLE_QUALITE", "PRET_AU_DEPOT", "DEPOT_EFFECTUE", "MARCHE_ATTRIBUE"] as const
  ).map((stage) => ({
    label: stageLabels[stage],
    value: stats.stageCounts[stage] ?? 0,
    href: `/pipeline#${stage}`,
  }));

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle="Pilotage des consultations, de la détection au résultat."
        actions={
          <>
            <LinkButton href="/veille" variant="secondary" size="sm">
              <Radar className="size-4" aria-hidden />
              Veille
            </LinkButton>
            <LinkButton href="/pipeline" size="sm">
              Ouvrir le pipeline
              <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
          </>
        }
      />

      <div className="space-y-5 p-6">
        {demoCount > 0 ? (
          <Notice tone="warn" title={`${demoCount} affaire${demoCount > 1 ? "s" : ""} de démonstration`}>
            Des affaires fictives sont présentes pour la prise en main. Elles portent un badge
            « Démonstration » et sont comptées dans les indicateurs. Supprimez-les avant la mise en
            service, ou réinitialisez la base avec <code className="font-mono text-[12px]">TENDERA_SEED_DEMO=0</code>.
          </Notice>
        ) : null}

        {/* --- Indicateurs clés --- */}
        <section aria-label="Indicateurs clés" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Détectées aujourd'hui"
            value={stats.detectedToday}
            hint={`${stats.detectedThisWeek} cette semaine`}
            icon={Radar}
          />
          <StatTile
            label="Consultations pertinentes"
            value={stats.relevant}
            hint={`Score global ≥ ${stats.relevanceThreshold}/100`}
            icon={Target}
          />
          <StatTile
            label="Go / No Go à décider"
            value={stats.toDecide}
            hint={`${stats.goCount} GO · ${stats.noGoCount} NO GO`}
            icon={AlertTriangle}
            tone={stats.toDecide > 0 ? "accent" : "neutral"}
            href="/pipeline#GO_NO_GO"
          />
          <StatTile
            label="Dépôts sous 15 jours"
            value={stats.deadlinesSoon}
            hint={`${stats.inDrafting} en rédaction · ${stats.toReview} à contrôler`}
            icon={CalendarClock}
            tone={stats.deadlinesSoon > 0 ? "accent" : "neutral"}
          />
        </section>

        {/* --- Montants : trois natures, jamais additionnées --- */}
        <section aria-label="Montants" className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-[12px] text-ink-500">Montant potentiel</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-esme-900">
              {formatAmount("MAXIMUM", null, stats.amounts.potential)}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-ink-500">
              Somme des montants publiés des affaires en jeu.
              {stats.amounts.unknownCount > 0
                ? ` ${stats.amounts.unknownCount} affaire(s) sans montant communiqué, non comptée(s).`
                : ""}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[12px] text-ink-500">Montant remporté</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-esme-900">
              {stats.amounts.won > 0 ? formatAmount("GLOBAL", null, stats.amounts.won) : "—"}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-ink-500">
              Montants des marchés notifiés, tels que saisis à l&apos;attribution.
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[12px] text-ink-500">Taux de transformation</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-esme-900">
              {stats.winRate === null ? "—" : `${stats.winRate} %`}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-ink-500">
              {stats.awarded} attribué(s) sur {stats.awarded + stats.rejected} résultat(s) connu(s).
              Les dossiers en attente sont exclus du calcul.
            </p>
          </Card>
        </section>

        <div className="grid gap-5 xl:grid-cols-3">
          {/* --- Entonnoir --- */}
          <Card className="xl:col-span-1">
            <CardHeader
              title="Entonnoir du pipeline"
              subtitle="Effectif de chaque étape, et rapport à l'étape précédente. Ce rapport compare des stocks à un instant donné : il peut dépasser 100 %."
            />
            <div className="p-5">
              <PipelineFunnel steps={funnelSteps} />
            </div>
          </Card>

          {/* --- Évolution --- */}
          <Card className="xl:col-span-2">
            <CardHeader
              title="Détections par semaine"
              subtitle="Affaires créées, douze dernières semaines."
              action={
                stats.averageResponseDays !== null ? (
                  <Badge tone="esme">Délai moyen de réponse : {stats.averageResponseDays} j</Badge>
                ) : null
              }
            />
            <div className="p-5">
              <TrendArea points={stats.weekly} valueLabel="affaires" />
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* --- À décider --- */}
          <Card>
            <CardHeader
              title="En attente de décision Go / No Go"
              subtitle="Classées par score d'adéquation décroissant."
              action={
                <Link href="/pipeline#GO_NO_GO" className="text-[13px] font-medium text-esme-600 hover:underline">
                  Tout voir
                </Link>
              }
            />
            <ul className="divide-y divide-ink-100">
              {toDecide.length === 0 ? (
                <li className="px-5 py-8 text-center text-[13px] text-ink-500">
                  Aucune décision en attente.
                </li>
              ) : (
                toDecide.map((tender) => (
                  <li key={tender.id}>
                    <Link href={`/affaires/${tender.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-esme-50/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-esme-900">{tender.title}</p>
                        <p className="mt-0.5 truncate text-[12px] text-ink-500">
                          {tender.reference} · {tender.buyer}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {tender.matchResult ? <ScorePill value={tender.matchResult.scoreGlobal} size="sm" /> : null}
                        {tender.isDemo ? <Badge tone="warn">Démo</Badge> : null}
                      </div>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </Card>

          {/* --- Échéances --- */}
          <Card>
            <CardHeader title="Prochaines échéances" subtitle="Dossiers en cours, par date limite." />
            <ul className="divide-y divide-ink-100">
              {urgent.length === 0 ? (
                <li className="px-5 py-8 text-center text-[13px] text-ink-500">
                  Aucune échéance à venir sur les dossiers en cours.
                </li>
              ) : (
                urgent.map((tender) => {
                  const deadline = formatDeadline(tender.deadlineAt);
                  return (
                    <li key={tender.id}>
                      <Link href={`/affaires/${tender.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-esme-50/60">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-esme-900">{tender.title}</p>
                          <p className="mt-0.5 truncate text-[12px] text-ink-500">
                            {stageLabels[tender.stage]} · {tender.buyer}
                          </p>
                        </div>
                        <Badge tone={deadline.tone === "ok" ? "neutral" : deadline.tone}>{deadline.text}</Badge>
                      </Link>
                    </li>
                  );
                })
              )}
            </ul>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader
              title="Répartition par domaine"
              subtitle="Domaine de la consultation, d'après la meilleure correspondance du matching."
            />
            <div className="p-5">
              <RankedBars data={stats.byDomain} unit="" emptyLabel="Lancez le matching pour obtenir une répartition." />
            </div>
          </Card>
          <Card>
            <CardHeader title="Principaux acheteurs" subtitle="Nombre de consultations détectées." />
            <div className="p-5">
              <RankedBars data={stats.byBuyer} />
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Établissements IONIS sollicités"
              subtitle="Compétences du groupe identifiées comme mobilisables."
            />
            <div className="p-5">
              <RankedBars
                data={stats.byInstitution}
                emptyLabel="Aucune compétence du groupe identifiée sur les affaires en cours."
              />
            </div>
          </Card>
        </div>

        {/* --- État de la veille --- */}
        <Card>
          <CardHeader
            title="Dernière synchronisation de veille"
            action={
              <Link href="/veille" className="text-[13px] font-medium text-esme-600 hover:underline">
                Gérer les connecteurs
              </Link>
            }
          />
          <div className="p-5">
            {lastRun ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
                <span className="font-medium text-esme-900">{lastRun.connector.name}</span>
                <Badge tone={lastRun.status === "SUCCES" ? "ok" : lastRun.status === "ECHEC" ? "danger" : "warn"}>
                  {lastRun.status}
                </Badge>
                <span className="text-ink-600">
                  {lastRun.startedAt.toLocaleString("fr-FR")} — {lastRun.fetched} avis récupérés,{" "}
                  {lastRun.created} affaires créées, {lastRun.duplicates} doublons écartés
                </span>
                {lastRun.errors.length > 0 ? (
                  <span className="text-danger-600">{lastRun.errors[0]}</span>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-ink-500">
                Aucune synchronisation n&apos;a encore été lancée. Les affaires présentes proviennent
                d&apos;un import manuel ou du jeu de démonstration.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Radar;
  tone?: "neutral" | "accent";
  href?: string;
}) {
  const content = (
    <Card className="h-full p-4 transition-shadow hover:shadow-[0_2px_4px_rgb(17_27_69/0.06),0_18px_40px_-18px_rgb(17_27_69/0.22)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] text-ink-500">{label}</p>
        <Icon
          className={tone === "accent" ? "size-4 text-framboise-400" : "size-4 text-ink-300"}
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <p className="mt-1.5 text-3xl font-semibold tabular-nums leading-none text-esme-900">{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] text-ink-500">{hint}</p> : null}
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

