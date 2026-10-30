import Link from "next/link";

import { ActionButton, ActionForm, ActionSelect } from "@/components/app/action-form";
import { Card, CardHeader, Field, Input, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import {
  createUserAction, recomputeAllAction, resetPasswordAction, toggleUserActiveAction,
  updateBrandAction, updateRemindersAction, updateScoringAction, updateUserRoleAction,
} from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, roleLabels } from "@/lib/rbac";
import { formatDateTime } from "@/lib/labels";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireSession();
  const canSettings = can(session.role, "admin.settings");
  const canUsers = can(session.role, "admin.users");

  if (!canSettings && !canUsers) {
    return (
      <>
        <PageHeader title="Administration" />
        <div className="p-6">
          <Notice tone="danger">Cette section est réservée à l&apos;administration.</Notice>
        </div>
      </>
    );
  }

  const [brand, scoring, reminders, users, trainingCounts] = await Promise.all([
    getSetting("brand"),
    getSetting("scoring"),
    getSetting("reminders"),
    prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.training.groupBy({ by: ["origin"], where: { archived: false }, _count: { _all: true } }),
  ]);

  const byOrigin = Object.fromEntries(trainingCounts.map((row) => [row.origin, row._count._all]));

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Marque, pondérations du matching, rappels, utilisateurs et référentiel."
        actions={
          <>
            <Link
              href="/admin/catalogue"
              className="inline-flex h-8 items-center rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
            >
              Référentiel ({(byOrigin.CATALOGUE_ESME ?? 0) + (byOrigin.VOISINE ?? 0) + (byOrigin.IONIS ?? 0)})
            </Link>
            <Link
              href="/admin/journal"
              className="inline-flex h-8 items-center rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
            >
              Journal d&apos;audit
            </Link>
          </>
        }
      />

      <div className="grid gap-5 p-6 xl:grid-cols-2">
        {canSettings ? (
          <>
            {/* --- Marque --- */}
            <Card>
              <CardHeader
                title="Identité du produit"
                subtitle="Le nom et la signature sont repris partout dans l'interface."
              />
              <div className="p-5">
                <ActionForm action={updateBrandAction} submitLabel="Enregistrer la marque" submitSize="sm">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nom du produit" required>
                      <Input name="productName" defaultValue={brand.productName} required />
                    </Field>
                    <Field label="Signature">
                      <Input name="signature" defaultValue={brand.signature} />
                    </Field>
                    <Field label="Établissement" required>
                      <Input name="institution" defaultValue={brand.institution} required />
                    </Field>
                    <Field label="Groupe">
                      <Input name="group" defaultValue={brand.group} />
                    </Field>
                    <Field label="Logo sur fond clair" hint="Chemin sous /public.">
                      <Input name="logoLight" defaultValue={brand.logoLight} />
                    </Field>
                    <Field label="Logo sur fond foncé" hint="Chemin sous /public.">
                      <Input name="logoDark" defaultValue={brand.logoDark} />
                    </Field>
                  </div>
                  <Notice tone="info" className="mt-3">
                    Les couleurs restent celles de la charte ESME ({brand.primaryColor} et{" "}
                    {brand.accentColor}). Les modifier suppose une mise à jour des jetons de design
                    dans <code className="font-mono text-[11px]">globals.css</code>, pour conserver
                    les contrastes validés.
                  </Notice>
                </ActionForm>
              </div>
            </Card>

            {/* --- Pondérations --- */}
            <Card>
              <CardHeader
                title="Pondération du score global"
                subtitle="Modifier ces valeurs recalcule immédiatement les affaires actives."
              />
              <div className="p-5">
                <ActionForm action={updateScoringAction} submitLabel="Enregistrer et recalculer" submitSize="sm">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Catalogue ESME (%)">
                      <Input name="catalogue" inputMode="decimal" defaultValue={Math.round(scoring.catalogue)} />
                    </Field>
                    <Field label="Formations voisines (%)">
                      <Input name="voisines" inputMode="decimal" defaultValue={Math.round(scoring.voisines)} />
                    </Field>
                    <Field label="Groupe IONIS (%)">
                      <Input name="ionis" inputMode="decimal" defaultValue={Math.round(scoring.ionis)} />
                    </Field>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-500">
                    Les valeurs sont normalisées pour totaliser 100 %. Les trois scores par famille
                    restent inchangés : seule leur combinaison en score global dépend de cette
                    pondération.
                  </p>
                </ActionForm>

                <div className="mt-4 border-t border-ink-100 pt-4">
                  <ActionButton
                    action={recomputeAllAction}
                    label="Recalculer toutes les affaires actives"
                    variant="secondary"
                    size="sm"
                  />
                </div>
              </div>
            </Card>

            {/* --- Rappels --- */}
            <Card>
              <CardHeader title="Rappels et seuils d'alerte" />
              <div className="p-5">
                <ActionForm action={updateRemindersAction} submitLabel="Enregistrer" submitSize="sm">
                  <div className="space-y-3">
                    <Field
                      label="Jalons de rappel avant la date limite"
                      hint="En jours, séparés par des espaces. 0 correspond au jour du dépôt."
                    >
                      <Input name="daysBefore" defaultValue={reminders.daysBefore.join(" ")} />
                    </Field>
                    <Field
                      label="Score signalant une consultation fortement pertinente"
                      hint="Sur 100. Déclenche une alerte lors de la veille."
                    >
                      <Input name="highRelevanceScore" inputMode="numeric" defaultValue={reminders.highRelevanceScore} />
                    </Field>
                  </div>
                </ActionForm>
              </div>
            </Card>
          </>
        ) : null}

        {/* --- Utilisateurs --- */}
        {canUsers ? (
          <Card className="xl:col-span-2">
            <CardHeader
              title="Utilisateurs et permissions"
              subtitle={`${users.filter((user) => user.active).length} compte(s) actif(s) sur ${users.length}.`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Compte</Th>
                  <Th className="w-56">Rôle</Th>
                  <Th className="w-40">Dernière connexion</Th>
                  <Th className="w-72">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.active ? "" : "opacity-55"}>
                    <Td>
                      <p className="text-[13px] font-medium text-esme-900">{user.name}</p>
                      <p className="mt-0.5 text-[12px] text-ink-500">{user.email}</p>
                      {user.jobTitle ? <p className="text-[11px] text-ink-400">{user.jobTitle}</p> : null}
                    </Td>
                    <Td>
                      <ActionSelect
                        label={`Rôle de ${user.name}`}
                        value={user.role}
                        action={updateUserRoleAction.bind(null, user.id)}
                        options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
                      />
                    </Td>
                    <Td className="text-[12px] text-ink-600">{formatDateTime(user.lastLoginAt)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-start gap-2">
                        <ActionButton
                          action={toggleUserActiveAction.bind(null, user.id, !user.active)}
                          label={user.active ? "Désactiver" : "Réactiver"}
                          variant="secondary"
                          size="sm"
                        />
                        <ActionForm
                          action={resetPasswordAction.bind(null, user.id)}
                          submitLabel="Changer"
                          submitVariant="ghost"
                          submitSize="sm"
                          className="flex items-end gap-1"
                          resetOnSuccess
                        >
                          <Input
                            type="password"
                            name="password"
                            placeholder="Nouveau mot de passe"
                            autoComplete="new-password"
                            className="h-8 w-44 text-[12px]"
                          />
                        </ActionForm>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="border-t border-ink-100 p-5">
              <h3 className="mb-3 text-[13px] font-semibold text-esme-900">Créer un compte</h3>
              <ActionForm action={createUserAction} submitLabel="Créer le compte" submitSize="sm" resetOnSuccess>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Nom" required>
                    <Input name="name" required />
                  </Field>
                  <Field label="Adresse professionnelle" required>
                    <Input type="email" name="email" required />
                  </Field>
                  <Field label="Rôle" required>
                    <select
                      name="role"
                      defaultValue="LECTEUR"
                      className="h-10 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm"
                    >
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Mot de passe initial" required hint="10 caractères au minimum.">
                    <Input type="password" name="password" required autoComplete="new-password" />
                  </Field>
                  <Field label="Fonction" className="sm:col-span-2">
                    <Input name="jobTitle" />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Card>
        ) : null}

        {/* --- Rôles --- */}
        <Card className="xl:col-span-2">
          <CardHeader title="Matrice des rôles" subtitle="Ce que chaque rôle peut faire." />
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(roleLabels).map(([role, label]) => (
              <div key={role} className="rounded-xl border border-ink-200 p-3">
                <p className="text-[13px] font-semibold text-esme-900">{label}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-600">{roleDescription(role)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function roleDescription(role: string): string {
  switch (role) {
    case "ADMINISTRATEUR":
      return "Tous les droits, y compris la gestion des comptes, des paramètres et du référentiel.";
    case "RESPONSABLE_AO":
      return "Pilote le portefeuille : création et modification d'affaires, décision Go/No Go, validation des documents, enregistrement des dépôts et des résultats, configuration de la veille.";
    case "REDACTEUR":
      return "Prépare les réponses : import et analyse des DCE, rédaction des documents, contrôle qualité. Ne décide pas du Go/No Go et n'enregistre pas de dépôt.";
    case "EXPERT_PEDAGOGIQUE":
      return "Intervient sur le contenu pédagogique : ajustement du matching, édition du référentiel et des documents de réponse.";
    case "RELECTEUR":
      return "Lecture, commentaires et contrôle qualité. Ne modifie pas directement les documents.";
    default:
      return "Consultation seule : pipeline, affaires, référentiel et base de connaissances non confidentielle.";
  }
}
