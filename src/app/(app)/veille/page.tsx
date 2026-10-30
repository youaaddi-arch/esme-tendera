import { Clock, Play, Radar } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Table, Td, Textarea, Th } from "@/components/ui";
import { runConnectorAction, toggleConnectorAction, updateVeilleSettingsAction } from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { connectorStatusLabels, formatDateTime } from "@/lib/labels";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Veille" };
export const dynamic = "force-dynamic";

export default async function VeillePage() {
  const session = await requireSession();
  const canRun = can(session.role, "veille.run");
  const canConfigure = can(session.role, "veille.configure");

  const [connectors, runs, settings] = await Promise.all([
    prisma.sourceConnector.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.veilleRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { connector: { select: { name: true } } },
    }),
    getSetting("veille"),
  ]);

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
