"use client";

import { ActionForm } from "@/components/app/action-form";
import { Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { createTenderAction } from "@/app/(app)/affaires/nouvelle/actions";
import { amountKindLabels } from "@/lib/labels";

export function NewTenderForm() {
  return (
    <Card>
      <CardHeader
        title="Informations de la consultation"
        subtitle="Seuls l'intitulé et l'acheteur sont obligatoires. Le reste se complète au fil de l'instruction."
      />
      <div className="p-5">
        <ActionForm action={createTenderAction} submitLabel="Créer l'affaire et lancer le matching">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intitulé du marché" required className="sm:col-span-2">
              <Input name="title" required placeholder="Accompagnement à la montée en compétences des agents" />
            </Field>
            <Field label="Acheteur" required>
              <Input name="buyer" required placeholder="Nom de la collectivité ou de l'établissement" />
            </Field>
            <Field label="Numéro de consultation">
              <Input name="consultationRef" />
            </Field>

            <Field label="Objet du marché" className="sm:col-span-2" hint="Plus il est détaillé, plus le matching est fiable.">
              <Textarea name="objectSummary" rows={5} />
            </Field>

            <Field label="Procédure">
              <Input name="procedure" placeholder="Procédure adaptée (MAPA)" />
            </Field>
            <Field label="Région">
              <Input name="region" />
            </Field>

            <Field label="Date de publication">
              <Input type="date" name="publishedAt" />
            </Field>
            <Field label="Date limite de dépôt">
              <Input type="date" name="deadlineAt" />
            </Field>

            <Field label="Codes CPV" hint="Séparés par des espaces.">
              <Input name="cpvCodes" placeholder="80500000 80510000" />
            </Field>
            <Field label="Nature du montant">
              <Select name="amountKind" defaultValue="NON_COMMUNIQUE">
                {Object.entries(amountKindLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Montant HT (€)" hint="Laissez vide si l'avis n'en publie pas.">
              <Input name="amountMaxEur" inputMode="decimal" />
            </Field>

            <Field label="Lien vers l'avis" className="sm:col-span-2">
              <Input type="url" name="sourceUrl" placeholder="https://www.boamp.fr/avis/detail/…" />
            </Field>
            <Field label="Lien direct vers le DCE" className="sm:col-span-2">
              <Input type="url" name="dceSourceUrl" />
            </Field>
          </div>

          <Notice tone="info" className="mt-4">
            Après création, vous serez dirigé vers l&apos;onglet DCE pour importer les pièces du dossier.
            Le matching produit à partir du seul intitulé est signalé comme provisoire : il sera
            recalculé après l&apos;analyse du dossier.
          </Notice>
        </ActionForm>
      </div>
    </Card>
  );
}
