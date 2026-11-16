import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserPlus } from "lucide-react";

import { ActionButton, ActionForm, ActionSelect } from "@/components/app/action-form";
import { PasswordField } from "@/components/app/admin/password-field";
import {
  Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Table, Td, Th,
} from "@/components/ui";
import {
  createUserAction, resetPasswordAction, toggleUserActiveAction, updateUserRoleAction,
} from "../actions";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, roleLabels } from "@/lib/rbac";
import { formatDateTime } from "@/lib/labels";

export const metadata = { title: "Comptes et accès" };
export const dynamic = "force-dynamic";

/**
 * Comptes et accès.
 *
 * Page à part, et non une carte de plus sur la page d'administration : créer
 * un identifiant n'a rien à voir avec régler une pondération de matching, et
 * le formulaire se perdait entre la marque, le scoring et les rappels. C'est
 * aussi la page qu'on ouvre avec quelqu'un à côté de soi, le jour où il
 * arrive — elle doit tenir seule.
 *
 * Le mot de passe n'est jamais relu depuis la base : il n'y est pas, seule son
 * empreinte bcrypt y est. Un mot de passe oublié se remplace, il ne se
 * retrouve pas.
 */
export default async function ComptesPage() {
  const session = await requireSession();
  if (!can(session.role, "admin.users")) {
    return (
      <>
        <PageHeader title="Comptes et accès" />
        <div className="p-6">
          <Notice tone="danger">
            La gestion des comptes est réservée à l&apos;administration. Votre rôle ne la permet pas.
          </Notice>
        </div>
      </>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true, email: true, name: true, role: true, jobTitle: true,
      active: true, lastLoginAt: true, createdAt: true,
    },
  });

  const actifs = users.filter((user) => user.active).length;
  const jamaisConnectes = users.filter((user) => user.active && !user.lastLoginAt);
  const administrateurs = users.filter((user) => user.active && user.role === "ADMINISTRATEUR").length;

  return (
    <>
      <PageHeader
        title="Comptes et accès"
        subtitle={`${actifs} compte(s) actif(s) sur ${users.length}. ${administrateurs} administrateur(s).`}
        actions={
          <Link
            href="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Administration
          </Link>
        }
      />

      <div className="space-y-5 p-6">
        <Notice tone="info" title="Comment transmettre un identifiant">
          <p>
            Le mot de passe initial n&apos;est stocké nulle part en clair : seule son empreinte est
            enregistrée. Communiquez-le de vive voix, par téléphone ou par message éphémère, jamais
            dans un courriel conservé. Demandez à la personne de le changer à sa première connexion —
            chacun peut changer le sien depuis sa fiche.
          </p>
        </Notice>

        {/* --- Création --- */}
        <Card>
          <CardHeader
            title="Créer un compte"
            subtitle="L'adresse professionnelle sert d'identifiant de connexion."
            action={
              <span className="flex items-center gap-1.5 text-[12px] text-ink-500">
                <UserPlus className="size-3.5" aria-hidden />
                Nouvel arrivant
              </span>
            }
          />
          <div className="p-5">
            <ActionForm action={createUserAction} submitLabel="Créer le compte" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom et prénom" required>
                  <Input name="name" required autoComplete="off" placeholder="Camille Durand" />
                </Field>
                <Field label="Adresse professionnelle" required hint="C'est l'identifiant de connexion.">
                  <Input type="email" name="email" required autoComplete="off" placeholder="prenom.nom@esme.fr" />
                </Field>
                <Field label="Fonction" hint="Apparaît sur les affaires dont la personne est responsable.">
                  <Input name="jobTitle" placeholder="Chargée de réponse aux appels d'offres" />
                </Field>
                <Field label="Rôle" required hint="Ce que le compte pourra faire. La matrice est en bas de page.">
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
                <Field
                  label="Mot de passe initial"
                  required
                  className="sm:col-span-2"
                  hint="10 caractères au minimum. Le bouton en engendre un de 14, lisible et tiré au hasard."
                >
                  <PasswordField name="password" required />
                </Field>
              </div>
            </ActionForm>
          </div>
        </Card>

        {/* --- Comptes existants --- */}
        <Card>
          <CardHeader
            title="Comptes existants"
            subtitle="Un compte ne se supprime pas : il se désactive, pour que l'historique des décisions garde son auteur."
          />
          {jamaisConnectes.length > 0 ? (
            <p className="border-b border-ink-100 bg-warn-50 px-5 py-2 text-[12px] leading-snug text-warn-700">
              {jamaisConnectes.length} compte(s) actif(s) ne s&apos;est jamais connecté :{" "}
              {jamaisConnectes.map((user) => user.email).join(", ")}. Le mot de passe a-t-il bien été
              transmis ?
            </p>
          ) : null}
          <Table>
            <thead>
              <tr>
                <Th>Compte</Th>
                <Th className="w-52">Rôle</Th>
                <Th className="w-36">Dernière connexion</Th>
                <Th className="w-72">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={user.active ? "" : "opacity-55"}>
                  <Td>
                    <p className="text-[13px] font-medium text-esme-900">
                      {user.name}
                      {user.id === session.id ? (
                        <Badge tone="esme" className="ml-1.5">vous</Badge>
                      ) : null}
                      {user.active ? null : <Badge tone="neutral" className="ml-1.5">désactivé</Badge>}
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-ink-500">{user.email}</p>
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
                  <Td className="text-[12px] text-ink-600">
                    {user.lastLoginAt ? (
                      formatDateTime(user.lastLoginAt)
                    ) : (
                      <span className="text-ink-400">Jamais</span>
                    )}
                    <span className="mt-0.5 block text-[11px] text-ink-400">
                      Créé le {formatDateTime(user.createdAt)}
                    </span>
                  </Td>
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
                        submitLabel="Remplacer"
                        submitVariant="ghost"
                        submitSize="sm"
                        className="flex items-end gap-1"
                        resetOnSuccess
                      >
                        <PasswordField name="password" compact placeholder="Nouveau mot de passe" />
                      </ActionForm>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {/* --- Matrice des rôles --- */}
        <Card>
          <CardHeader
            title="Matrice des rôles"
            subtitle="Ce que chaque rôle peut faire. Un rôle se change à tout moment, et prend effet à la requête suivante."
            action={
              <span className="flex items-center gap-1.5 text-[12px] text-ink-500">
                <ShieldCheck className="size-3.5" aria-hidden />
                {Object.keys(roleLabels).length} rôles
              </span>
            }
          />
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
