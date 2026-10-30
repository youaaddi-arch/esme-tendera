import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, ScorePill, Table, Td, Th } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  dceStatusLabels, formatAmount, formatDate, formatDeadline, goNoGoLabels, outcomeLabels,
  stageLabels, stageOrder,
} from "@/lib/labels";

export const metadata = { title: "Affaires" };
export const dynamic = "force-dynamic";

/**
 * Vue tableau des affaires.
 *
 * Complète le Kanban : tri, filtres et recherche globale sur l'ensemble du
 * portefeuille, y compris les affaires archivées.
 */
export default async function AffairesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; etape?: string; responsable?: string; resultat?: string;
    region?: string; archivees?: string; tri?: string;
  }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const orderBy: Prisma.TenderOrderByWithRelationInput =
    params.tri === "score"
      ? { matchResult: { scoreGlobal: "desc" } }
      : params.tri === "montant"
        ? { amountMaxEur: "desc" }
        : params.tri === "recentes"
          ? { createdAt: "desc" }
          : { deadlineAt: "asc" };

  const [tenders, users, regions] = await Promise.all([
    prisma.tender.findMany({
      where: {
        archived: params.archivees === "1" ? true : false,
        ...(params.etape ? { stage: params.etape as never } : {}),
        ...(params.responsable ? { ownerId: params.responsable } : {}),
        ...(params.resultat ? { outcome: params.resultat as never } : {}),
        ...(params.region ? { region: params.region } : {}),
        ...(params.q
          ? {
              OR: [
                { title: { contains: params.q, mode: "insensitive" } },
                { buyer: { contains: params.q, mode: "insensitive" } },
                { reference: { contains: params.q, mode: "insensitive" } },
                { consultationRef: { contains: params.q, mode: "insensitive" } },
                { objectSummary: { contains: params.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy,
      take: 300,
      include: {
        owner: { select: { name: true } },
        matchResult: { select: { scoreGlobal: true } },
        _count: { select: { documents: true, lots: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.tender.findMany({
      where: { region: { not: null } },
      select: { region: true },
      distinct: ["region"],
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Affaires"
        subtitle={`${tenders.length} affaire(s) affichée(s)${params.archivees === "1" ? " — archives" : ""}.`}
        actions={
          <>
            <LinkButton href="/pipeline" variant="secondary" size="sm">Vue Kanban</LinkButton>
            {can(session.role, "tender.create") ? (
              <LinkButton href="/affaires/nouvelle" size="sm">Nouvelle affaire</LinkButton>
            ) : null}
          </>
        }
      />

      <div className="space-y-5 p-6">
        <Card>
          <form method="get" className="flex flex-wrap items-end gap-3 p-4">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-[12px] font-medium text-ink-700">Recherche globale</span>
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Marché, acheteur, référence, objet…"
                className="h-9 w-full rounded-lg border border-ink-300 px-3 text-sm placeholder:text-ink-400 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25"
              />
            </label>
            <Picker name="etape" label="Étape" value={params.etape} options={stageOrder.map((stage) => ({ value: stage, label: stageLabels[stage] }))} />
            <Picker name="responsable" label="Responsable" value={params.responsable} options={users.map((user) => ({ value: user.id, label: user.name }))} />
            <Picker name="resultat" label="Résultat" value={params.resultat} options={Object.entries(outcomeLabels).map(([value, label]) => ({ value, label }))} />
            <Picker
              name="region"
              label="Région"
              value={params.region}
              options={regions.filter((row) => row.region).map((row) => ({ value: row.region!, label: row.region! }))}
            />
            <Picker
              name="tri"
              label="Tri"
              value={params.tri}
              options={[
                { value: "echeance", label: "Date limite" },
                { value: "score", label: "Score" },
                { value: "montant", label: "Montant" },
                { value: "recentes", label: "Plus récentes" },
              ]}
              allLabel="Date limite"
            />
            <label className="flex items-center gap-1.5 pb-2 text-[13px] text-ink-700">
              <input type="checkbox" name="archivees" value="1" defaultChecked={params.archivees === "1"} className="size-4 accent-[var(--color-esme-600)]" />
              Archives
            </label>
            <button type="submit" className="h-9 rounded-full bg-esme-600 px-4 text-sm font-medium text-white hover:bg-esme-700">
              Filtrer
            </button>
            <Link href="/affaires" className="pb-2 text-[13px] text-esme-600 hover:underline">Réinitialiser</Link>
          </form>
        </Card>

        {tenders.length === 0 ? (
          <EmptyState
            title="Aucune affaire ne correspond"
            description="Élargissez les filtres, ou lancez une synchronisation de veille."
          />
        ) : (
          <Card>
            <CardHeader title={`${tenders.length} affaire(s)`} />
            <Table>
              <thead>
                <tr>
                  <Th className="w-32">Référence</Th>
                  <Th>Marché</Th>
                  <Th className="w-44">Étape</Th>
                  <Th className="w-32">Date limite</Th>
                  <Th className="w-40">Montant</Th>
                  <Th className="w-24">Score</Th>
                  <Th className="w-36">Responsable</Th>
                </tr>
              </thead>
              <tbody>
                {tenders.map((tender) => {
                  const deadline = formatDeadline(tender.deadlineAt);
                  return (
                    <tr key={tender.id}>
                      <Td>
                        <Link href={`/affaires/${tender.id}`} className="font-mono text-[12px] font-medium text-esme-700 hover:underline">
                          {tender.reference}
                        </Link>
                        {tender.isDemo ? <Badge tone="warn" className="mt-1">Démo</Badge> : null}
                      </Td>
                      <Td>
                        <Link href={`/affaires/${tender.id}`} className="text-[13px] font-medium text-esme-900 hover:text-esme-600">
                          {tender.title}
                        </Link>
                        <p className="mt-0.5 text-[12px] text-ink-500">{tender.buyer}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tender._count.lots > 0 ? <Badge tone="neutral">{tender._count.lots} lot(s)</Badge> : null}
                          <Badge tone={tender._count.documents > 0 ? "ok" : "neutral"}>
                            {tender._count.documents > 0 ? `${tender._count.documents} pièce(s)` : dceStatusLabels[tender.dceStatus]}
                          </Badge>
                          {tender.goNoGo !== "A_DECIDER" ? (
                            <Badge tone={tender.goNoGo === "GO" ? "ok" : "danger"}>{goNoGoLabels[tender.goNoGo]}</Badge>
                          ) : null}
                        </div>
                      </Td>
                      <Td className="text-[12px]">
                        <Badge tone="esme">{stageLabels[tender.stage]}</Badge>
                        {tender.outcome !== "EN_ATTENTE" ? (
                          <p className="mt-1 text-[11px] text-ink-500">{outcomeLabels[tender.outcome]}</p>
                        ) : null}
                      </Td>
                      <Td className="text-[12px]">
                        {formatDate(tender.deadlineAt)}
                        <Badge tone={deadline.tone === "ok" ? "neutral" : deadline.tone} className="mt-1">
                          {deadline.text}
                        </Badge>
                      </Td>
                      <Td className="text-[12px]">
                        {formatAmount(tender.amountKind, tender.amountMinEur, tender.amountMaxEur)}
                      </Td>
                      <Td>
                        {tender.matchResult ? <ScorePill value={tender.matchResult.scoreGlobal} size="sm" /> : <span className="text-[12px] text-ink-400">—</span>}
                      </Td>
                      <Td className="text-[12px] text-ink-600">{tender.owner?.name ?? "Non affecté"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}

function Picker({
  name,
  label,
  value,
  options,
  allLabel = "Toutes",
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-[12px] font-medium text-ink-700">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="h-9 max-w-44 rounded-lg border border-ink-300 bg-white px-2 text-sm"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
