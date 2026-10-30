import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { InfosTab } from "@/components/app/tender/infos-tab";
import { LotsTab } from "@/components/app/tender/lots-tab";
import { DceTab } from "@/components/app/tender/dce-tab";
import { AnalyseTab } from "@/components/app/tender/analyse-tab";
import { MatchingTab } from "@/components/app/tender/matching-tab";
import { DecisionTab } from "@/components/app/tender/decision-tab";
import { ReponseTab } from "@/components/app/tender/reponse-tab";
import { ControleTab } from "@/components/app/tender/controle-tab";
import { SuiviTab } from "@/components/app/tender/suivi-tab";
import { HistoriqueTab } from "@/components/app/tender/historique-tab";
import { Badge, DemoBanner, ScorePill, cx } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { permissionsFor } from "@/lib/rbac";
import { tenderDetailInclude } from "@/lib/tender-detail";
import {
  dceStatusLabels, formatAmount, formatDeadline, goNoGoLabels, outcomeLabels, stageLabels,
} from "@/lib/labels";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "infos", label: "Informations" },
  { key: "lots", label: "Lots" },
  { key: "dce", label: "DCE" },
  { key: "analyse", label: "Analyse" },
  { key: "matching", label: "Matching" },
  { key: "decision", label: "Go / No Go" },
  { key: "reponse", label: "Documents de réponse" },
  { key: "controle", label: "Contrôle" },
  { key: "suivi", label: "Dépôt & résultat" },
  { key: "historique", label: "Historique" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tender = await prisma.tender.findUnique({
    where: { id },
    select: { reference: true, title: true },
  });
  return { title: tender ? `${tender.reference} — ${tender.title.slice(0, 60)}` : "Affaire" };
}

export default async function TenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { onglet } = await searchParams;
  const tab: TabKey = (TABS.find((item) => item.key === onglet)?.key ?? "infos") as TabKey;

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: tenderDetailInclude,
  });

  if (!tender) notFound();

  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  const permissions = permissionsFor(session.role);
  const deadline = formatDeadline(tender.deadlineAt);

  return (
    <div className="min-h-dvh">
      {/* --- En-tête de la fiche --- */}
      <header className="border-b border-ink-200 bg-white">
        <div className="px-6 pt-5">
          <nav className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-500" aria-label="Fil d'Ariane">
            <Link href="/pipeline" className="hover:text-esme-600 hover:underline">
              Pipeline
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono">{tender.reference}</span>
            {tender.parent ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/affaires/${tender.parent.id}`} className="hover:text-esme-600 hover:underline">
                  Consultation mère : {tender.parent.reference}
                </Link>
              </>
            ) : null}
          </nav>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold leading-snug tracking-tight text-esme-900">{tender.title}</h1>
              <p className="mt-1 text-sm text-ink-600">
                {tender.buyer}
                {tender.consultationRef ? ` · ${tender.consultationRef}` : ""}
                {tender.lotLabel ? ` · ${tender.lotLabel}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tender.matchResult ? (
                <ScorePill value={tender.matchResult.scoreGlobal} label="Score global" />
              ) : null}
              <Badge tone="esme">{stageLabels[tender.stage]}</Badge>
              <Badge
                tone={tender.goNoGo === "GO" ? "ok" : tender.goNoGo === "NO_GO" ? "danger" : "warn"}
              >
                {goNoGoLabels[tender.goNoGo]}
              </Badge>
              {tender.sourceUrl ? (
                <a
                  href={tender.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-full border border-ink-300 px-3 py-1 text-[12px] text-esme-700 hover:border-esme-400 hover:bg-esme-50"
                >
                  Avis d&apos;origine
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Date limite">
              <span className="flex items-center gap-2">
                {tender.deadlineAt ? tender.deadlineAt.toLocaleDateString("fr-FR") : "Non communiquée"}
                <Badge tone={deadline.tone === "ok" ? "neutral" : deadline.tone}>{deadline.text}</Badge>
              </span>
            </Fact>
            <Fact label="Montant">
              {formatAmount(tender.amountKind, tender.amountMinEur, tender.amountMaxEur)}
            </Fact>
            <Fact label="DCE">
              <Badge tone={tender.dceStatus === "NON_RECUPERE" ? "danger" : tender.documents.length > 0 ? "ok" : "neutral"}>
                {dceStatusLabels[tender.dceStatus]}
              </Badge>
            </Fact>
            <Fact label="Résultat">{outcomeLabels[tender.outcome]}</Fact>
          </dl>
        </div>

        {/* --- Onglets --- */}
        <nav className="mt-4 flex gap-0.5 overflow-x-auto px-4" aria-label="Sections de la fiche">
          {TABS.map((item) => {
            const active = item.key === tab;
            const count =
              item.key === "lots" ? tender.lots.length
              : item.key === "dce" ? tender.documents.length
              : item.key === "reponse" ? tender.responseDocs.length
              : null;
            return (
              <Link
                key={item.key}
                href={`/affaires/${tender.id}?onglet=${item.key}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors",
                  active
                    ? "border-framboise-400 font-medium text-esme-900"
                    : "border-transparent text-ink-500 hover:border-ink-300 hover:text-esme-700",
                )}
              >
                {item.label}
                {count !== null && count > 0 ? (
                  <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-[10px] tabular-nums text-ink-600">
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="space-y-5 p-6">
        {tender.isDemo ? <DemoBanner /> : null}

        {tab === "infos" ? <InfosTab tender={tender} users={users} permissions={permissions} /> : null}
        {tab === "lots" ? <LotsTab tender={tender} permissions={permissions} /> : null}
        {tab === "dce" ? <DceTab tender={tender} permissions={permissions} /> : null}
        {tab === "analyse" ? <AnalyseTab tender={tender} permissions={permissions} /> : null}
        {tab === "matching" ? <MatchingTab tender={tender} permissions={permissions} /> : null}
        {tab === "decision" ? <DecisionTab tender={tender} permissions={permissions} /> : null}
        {tab === "reponse" ? <ReponseTab tender={tender} users={users} permissions={permissions} /> : null}
        {tab === "controle" ? <ControleTab tender={tender} permissions={permissions} /> : null}
        {tab === "suivi" ? <SuiviTab tender={tender} users={users} permissions={permissions} /> : null}
        {tab === "historique" ? <HistoriqueTab tender={tender} /> : null}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-ink-800">{children}</dd>
    </div>
  );
}
