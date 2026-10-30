import { Clock, Play, Radar } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import Link from "next/link";

import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Table, Td, Textarea, Th } from "@/components/ui";
import { runConnectorAction, toggleConnectorAction, updateVeilleSettingsAction } from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  connectorStatusLabels, formatAmount, formatDate, formatDateTime, natureLabels, natureOrder,
  natureTone,
} from "@/lib/labels";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Veille" };
export const dynamic = "force-dynamic";

export default async function VeillePage({
  searchParams,
}: {
  searchParams: Promise<{ nature?: string; jours?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const canRun = can(session.role, "veille.run");
  const canConfigure = can(session.role, "veille.configure");

  // Fenêtre d'affichage des avis récupérés : tout ce que la veille a ramené
  // reste accessible, sans aucun pré-filtrage par pertinence.
  const windowDays = Math.max(1, Math.min(90, Number.parseInt(params.jours ?? "7", 10) || 7));
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const [connectors, runs, settings, harvested, natureCounts] = await Promise.all([
    prisma.sourceConnector.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.veilleRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { connector: { select: { name: true } } },
    }),
    getSetting("veille"),
    prisma.tender.findMany({
      where: {
        createdAt: { gte: since },
        sourceConnector: { isNot: null },
        ...(params.nature ? { matchResult: { nature: params.nature as never } } : {}),
      },
      orderBy: [{ matchResult: { scoreGlobal: "desc" } }, { createdAt: "desc" }],
      take: 400,
      select: {
        id: true, reference: true, title: true, buyer: true, deadlineAt: true,
        amountKind: true, amountMinEur: true, amountMaxEur: true, createdAt: true,
        sourceConnector: { select: { name: true } },
        matchResult: { select: { scoreGlobal: true, nature: true, natureLabel: true } },
        _count: { select: { lots: true } },
      },
    }),
    prisma.matchResult.groupBy({
      by: ["nature"],
      where: { tender: { createdAt: { gte: since }, sourceConnector: { isNot: null } } },
      _count: { _all: true },
    }),
  ]);

  const byNature = Object.fromEntries(natureCounts.map((row) => [row.nature, row._count._all]));
  const totalHarvested = natureCounts.reduce((sum, row) => sum + row._count._all, 0);

  const operational = connectors.filter((connector) => connector.status === "OPERATIONNEL");
  const lastRun = runs[0];

  return (
    <>
      <PageHeader
        title="Veille des consultations"
        subtitle={`${operational.length} connecteur(s) opérationnel(s) sur ${connectors.length}. Synchronisation quotidienne prévue à ${settings.dailyHour} h (${settings.timezone}).`}
        actions={
          lastRun ? (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-500">
              <Clock className="size-3.5" aria-hidden />
              Dernière synchronisation : {formatDateTime(lastRun.startedAt)}
            </span>
          ) : null
        }
      />

      <div className="space-y-5 p-6">
        <Notice tone="info" title="Ce que fait la veille, et ce qu'elle ne fait pas">
          <p>
            La veille n&apos;utilise que des API officielles, des jeux de données ouverts et des flux
            publics. Elle ne contourne aucune protection technique et ne moissonne aucun espace
            nécessitant un compte qui ne lui a pas été fourni. Un connecteur qui n&apos;est pas
            implémenté, ou dont l&apos;hôte est injoignable, est affiché comme tel : il ne produit jamais
            d&apos;affaire.
          </p>
        </Notice>

        {/* --- Tout ce que la veille a ramené --- */}
        <Card>
          <CardHeader
            title="Avis récupérés"
            subtitle={`${totalHarvested} avis sur les ${windowDays} derniers jours. Tous sont conservés et accessibles : l'appréciation est une aide au tri, pas un filtre.`}
            action={
              <form method="get" className="flex items-center gap-2">
                <label className="text-[12px] text-ink-600">
                  Fenêtre
                  <select
                    name="jours"
                    defaultValue={String(windowDays)}
                    className="ml-1.5 h-8 rounded-lg border border-ink-300 bg-white px-2 text-[12px]"
                  >
                    <option value="1">24 heures</option>
                    <option value="7">7 jours</option>
                    <option value="30">30 jours</option>
                    <option value="90">90 jours</option>
                  </select>
                </label>
                <input type="hidden" name="nature" value={params.nature ?? ""} />
                <button
                  type="submit"
                  className="h-8 rounded-full border border-ink-300 bg-white px-3 text-[12px] text-esme-800 hover:bg-esme-50"
                >
                  Appliquer
                </button>
              </form>
            }
          />

          {/* Répartition par appréciation, qui sert aussi de filtre. */}
          <div className="flex flex-wrap gap-2 border-b border-ink-100 px-5 py-3">
            <Link
              href={`/veille?jours=${windowDays}`}
              className={`rounded-full px-3 py-1 text-[12px] ring-1 ring-inset ${
                params.nature ? "bg-white text-ink-600 ring-ink-200" : "bg-esme-600 text-white ring-esme-600"
              }`}
            >
              Tous ({totalHarvested})
            </Link>
            {natureOrder.map((nature) => (
              <Link
                key={nature}
                href={`/veille?jours=${windowDays}&nature=${nature}`}
                className={`rounded-full px-3 py-1 text-[12px] ring-1 ring-inset ${
                  params.nature === nature
                    ? "bg-esme-600 text-white ring-esme-600"
                    : "bg-white text-ink-600 ring-ink-200 hover:bg-esme-50"
                }`}
              >
                {natureLabels[nature]} ({byNature[nature] ?? 0})
              </Link>
            ))}
          </div>

          {harvested.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-500">
              Aucun avis sur cette fenêtre. Lancez une synchronisation, ou élargissez la période.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-28">Référence</Th>
                  <Th>Marché</Th>
                  <Th className="w-56">Appréciation</Th>
                  <Th className="w-28">Date limite</Th>
                  <Th className="w-36">Montant</Th>
                  <Th className="w-20">Score</Th>
                </tr>
              </thead>
              <tbody>
                {harvested.map((tender) => (
                  <tr key={tender.id}>
                    <Td>
                      <Link
                        href={`/affaires/${tender.id}`}
                        className="font-mono text-[12px] font-medium text-esme-700 hover:underline"
                      >
                        {tender.reference}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {tender.sourceConnector?.name?.split(" — ")[0] ?? "—"}
                      </p>
                    </Td>
                    <Td>
                      <Link
                        href={`/affaires/${tender.id}`}
                        className="text-[13px] font-medium text-esme-900 hover:text-esme-600"
                      >
                        {tender.title}
                      </Link>
                      <p className="mt-0.5 text-[12px] text-ink-500">
                        {tender.buyer}
                        {tender._count.lots > 0 ? ` · ${tender._count.lots} lot(s)` : ""}
                      </p>
                    </Td>
                    <Td>
                      {tender.matchResult ? (
                        <>
                          <Badge tone={natureTone(tender.matchResult.nature)}>
                            {natureLabels[tender.matchResult.nature]}
                          </Badge>
                          {tender.matchResult.natureLabel ? (
                            <p className="mt-1 text-[11px] leading-snug text-ink-500">
                              {tender.matchResult.natureLabel}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[12px] text-ink-400">Matching non calculé</span>
                      )}
                    </Td>
                    <Td className="text-[12px]">{formatDate(tender.deadlineAt)}</Td>
                    <Td className="text-[12px]">
                      {formatAmount(tender.amountKind, tender.amountMinEur, tender.amountMaxEur)}
                    </Td>
                    <Td className="text-[13px] font-semibold tabular-nums text-esme-900">
                      {tender.matchResult ? Math.round(tender.matchResult.scoreGlobal) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {/* --- Connecteurs --- */}
        <Card>
          <CardHeader
            title="Connecteurs"
            subtitle="L'état affiché est l'état réel du code, pas une intention."
          />
          <Table>
            <thead>
              <tr>
                <Th>Source</Th>
                <Th className="w-36">État</Th>
                <Th className="w-44">Dernière exécution</Th>
                <Th className="w-56">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((connector) => (
                <tr key={connector.id}>
                  <Td>
                    <p className="text-[13px] font-medium text-esme-900">{connector.name}</p>
                    {connector.description ? (
                      <p className="mt-0.5 text-[12px] text-ink-600">{connector.description}</p>
                    ) : null}
                    {connector.requirement ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-warn-700">
                        <strong>Pour l&apos;activer :</strong> {connector.requirement}
                      </p>
                    ) : null}
                    {connector.baseUrl ? (
                      <p className="mt-1 font-mono text-[11px] text-ink-400">{connector.baseUrl}</p>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(connector.status)}>{connectorStatusLabels[connector.status]}</Badge>
                    {connector.enabled ? (
                      <Badge tone="esme" className="mt-1">Activé</Badge>
                    ) : (
                      <Badge tone="neutral" className="mt-1">Désactivé</Badge>
                    )}
                  </Td>
                  <Td>
                    <p className="text-[12px] text-ink-600">{formatDateTime(connector.lastRunAt)}</p>
                    {connector.lastError ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-danger-600">{connector.lastError}</p>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="space-y-1.5">
                      {canRun && connector.key !== "import-manuel" && connector.status !== "A_IMPLEMENTER" ? (
                        <ActionButton
                          action={runConnectorAction.bind(null, connector.key)}
                          label="Lancer la veille maintenant"
                          pendingLabel="Interrogation de la source…"
                          variant="primary"
                          size="sm"
                          icon={<Play className="size-3.5" aria-hidden />}
                        />
                      ) : null}
                      {canConfigure && connector.key !== "import-manuel" ? (
                        <ActionButton
                          action={toggleConnectorAction.bind(null, connector.key, !connector.enabled)}
                          label={connector.enabled ? "Désactiver" : "Activer"}
                          variant="secondary"
                          size="sm"
                        />
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="grid gap-5 lg:grid-cols-3">
          {/* --- Journal des synchronisations --- */}
          <Card className="lg:col-span-2">
            <CardHeader
              title="Journal des synchronisations"
              subtitle="Nombre d'avis récupérés, affaires créées, doublons écartés et erreurs rencontrées."
            />
            {runs.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink-500">
                Aucune synchronisation n&apos;a encore été lancée.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th className="w-32">Début</Th>
                    <Th className="w-24">État</Th>
                    <Th>Résultat</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <Td className="text-[13px]">{run.connector.name}</Td>
                      <Td className="text-[12px] text-ink-600">
                        {formatDateTime(run.startedAt)}
                        <span className="mt-0.5 block text-[11px] text-ink-400">
                          {run.trigger === "planifiee" ? "planifiée" : "manuelle"}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={run.status === "SUCCES" ? "ok" : run.status === "ECHEC" ? "danger" : "warn"}>
                          {run.status}
                        </Badge>
                      </Td>
                      <Td className="text-[12px]">
                        <p className="text-ink-700">
                          {run.fetched} avis · {run.created} créées · {run.updated} mises à jour ·{" "}
                          {run.duplicates} doublons
                          {run.rectificatifs > 0 ? ` · ${run.rectificatifs} rectificatif(s)` : ""}
                        </p>
                        {run.errors.length > 0 ? (
                          <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-danger-600">
                            {run.errors.slice(0, 3).map((error, index) => (
                              <li key={index}>— {error}</li>
                            ))}
                            {run.errors.length > 3 ? <li>— et {run.errors.length - 3} autre(s).</li> : null}
                          </ul>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* --- Paramètres --- */}
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Critères de recherche"
                subtitle="Appliqués par tous les connecteurs."
              />
              <div className="p-5">
                {canConfigure ? (
                  <ActionForm action={updateVeilleSettingsAction} submitLabel="Enregistrer" submitSize="sm">
                    <div className="space-y-3">
                      <Field
                        label="Mots-clés"
                        hint="Un par ligne. La recherche porte sur les intitulés et les descriptions, pas seulement sur les codes CPV."
                      >
                        <Textarea name="keywords" rows={10} defaultValue={settings.keywords.join("\n")} />
                      </Field>
                      <Field label="Codes CPV" hint="Séparés par des espaces ou des virgules.">
                        <Textarea name="cpvCodes" rows={3} defaultValue={settings.cpvCodes.join(" ")} />
                      </Field>
                      <Field label="Heure de la synchronisation quotidienne" hint={`Fuseau ${settings.timezone}.`}>
                        <Input name="dailyHour" type="number" min={0} max={23} defaultValue={settings.dailyHour} />
                      </Field>
                    </div>
                  </ActionForm>
                ) : (
                  <div className="space-y-3 text-[13px]">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-ink-400">Mots-clés</p>
                      <p className="mt-1 text-ink-700">{settings.keywords.join(" · ")}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-ink-400">Codes CPV</p>
                      <p className="mt-1 font-mono text-ink-700">{settings.cpvCodes.join(" ")}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Synchronisation quotidienne" />
              <div className="space-y-2 p-5 text-[12px] leading-relaxed text-ink-600">
                <p className="flex items-start gap-1.5">
                  <Radar className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden />
                  <span>
                    L&apos;exécution automatique à {settings.dailyHour} h ({settings.timezone}) est déclenchée
                    par un appel externe à <code className="font-mono">POST /api/veille/quotidienne</code>,
                    protégé par un jeton.
                  </span>
                </p>
                <p>
                  Selon l&apos;hébergement, ce déclencheur est un <em>cron job</em> Vercel, une tâche
                  planifiée systemd, ou un ordonnanceur interne. Tant qu&apos;aucun déclencheur n&apos;est
                  configuré, seule la synchronisation manuelle fonctionne.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function statusTone(status: string): "ok" | "warn" | "danger" | "neutral" {
  if (status === "OPERATIONNEL") return "ok";
  if (status === "INDISPONIBLE") return "danger";
  if (status === "A_IMPLEMENTER") return "warn";
  return "neutral";
}
