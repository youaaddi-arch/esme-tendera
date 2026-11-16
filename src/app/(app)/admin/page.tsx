import Link from "next/link";

import { Users } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { Card, CardHeader, Field, Input, Notice, PageHeader } from "@/components/ui";
import {
  recomputeAllAction, updateBrandAction, updateRemindersAction, updateScoringAction,
} from "./actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
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

  const [brand, scoring, reminders, users, actifs, trainingCounts] = await Promise.all([
    getSetting("brand"),
    getSetting("scoring"),
    getSetting("reminders"),
    prisma.user.count(),
    prisma.user.count({ where: { active: true } }),
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

        {/* --- Comptes --- */}
        {canUsers ? (
          <Card className="xl:col-span-2">
            <CardHeader
              title="Comptes et accès"
              subtitle={`${actifs} compte(s) actif(s) sur ${users}. La création d'identifiants, les rôles et les mots de passe ont leur propre page.`}
              action={
                <Link
                  href="/admin/comptes"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-esme-600 px-3 text-[13px] font-medium text-white hover:bg-esme-700"
                >
                  <Users className="size-3.5" aria-hidden />
                  Gérer les comptes
                </Link>
              }
            />
            <p className="px-5 pb-5 text-[13px] leading-relaxed text-ink-600">
              Créer un identifiant, changer un rôle, remplacer un mot de passe oublié, désactiver le
              compte de quelqu&apos;un qui part. Un compte ne se supprime jamais : il se désactive,
              sinon l&apos;historique des décisions perdrait son auteur.
            </p>
          </Card>
        ) : null}

      </div>
    </>
  );
}
