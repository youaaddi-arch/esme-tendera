"use client";

import Link from "next/link";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Notice, Table, Td, Textarea, Th } from "@/components/ui";
import { createLotAction, spawnLotAction } from "@/app/(app)/affaires/[id]/actions";
import { formatAmount } from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";
import type { Permission } from "@/lib/rbac";

/**
 * Onglet 2 — lots.
 *
 * Un marché alloti se traite lot par lot : chaque lot peut devenir une affaire
 * distincte, avec son propre matching, sa propre décision et son propre
 * dossier de réponse.
 */
export function LotsTab({ tender, permissions }: { tender: TenderDetail; permissions: Permission[] }) {
  const canEdit = permissions.includes("tender.edit");
  const canCreate = permissions.includes("tender.create");
  const spawned = new Map(tender.children.map((child) => [child.lotLabel, child]));

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Lots de la consultation"
          subtitle={`${tender.lots.length} lot(s) identifié(s). Créez une affaire par lot pertinent pour les suivre séparément.`}
        />

        {tender.lots.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Aucun lot enregistré"
              description="Soit la consultation n'est pas allotie, soit l'avis ne détaillait pas les lots. Ajoutez-les à la main si le DCE en mentionne."
            />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-16">N°</Th>
                <Th>Intitulé</Th>
                <Th className="w-44">Montant</Th>
                <Th className="w-56">Affaire dédiée</Th>
              </tr>
            </thead>
            <tbody>
              {tender.lots.map((lot) => {
                const child = spawned.get(`Lot ${lot.number}`);
                return (
                  <tr key={lot.id}>
                    <Td className="font-mono text-[12px] text-ink-500">{lot.number}</Td>
                    <Td>
                      <p className="font-medium text-esme-900">{lot.title}</p>
                      {lot.description ? <p className="mt-0.5 text-[12px] text-ink-600">{lot.description}</p> : null}
                      {lot.cpvCodes.length > 0 ? (
                        <p className="mt-1 font-mono text-[11px] text-ink-400">CPV {lot.cpvCodes.join(", ")}</p>
                      ) : null}
                    </Td>
                    <Td className="text-[13px]">
                      {formatAmount(lot.amountKind, lot.amountMinEur, lot.amountMaxEur)}
                    </Td>
                    <Td>
                      {child ? (
                        <Link href={`/affaires/${child.id}`} className="text-[13px] text-esme-600 hover:underline">
                          {child.reference}
                        </Link>
                      ) : lot.spawnedTenderId ? (
                        <Badge tone="neutral">Affaire créée</Badge>
                      ) : canCreate ? (
                        <ActionButton
                          action={() => spawnLotAction(tender.id, lot.id)}
                          label="Créer une affaire"
                          size="sm"
                        />
                      ) : (
                        <span className="text-[12px] text-ink-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="space-y-5">
        {canEdit ? (
          <Card>
            <CardHeader title="Ajouter un lot" subtitle="Quand l'avis ne les détaillait pas." />
            <div className="p-5">
              <ActionForm
                action={(formData) => createLotAction(tender.id, formData)}
                submitLabel="Ajouter le lot"
                submitSize="sm"
                resetOnSuccess
              >
                <div className="space-y-3">
                  <Field label="Numéro" required>
                    <Input name="number" placeholder="1" required />
                  </Field>
                  <Field label="Intitulé" required>
                    <Input name="title" placeholder="Sensibilisation à la sobriété énergétique" required />
                  </Field>
                  <Field label="Description">
                    <Textarea name="description" rows={3} />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Card>
        ) : null}

        <Notice tone="info" title="Pourquoi séparer les lots ?">
          Un lot a ses propres critères, son propre montant et parfois sa propre date limite. Une
          affaire par lot permet un Go/No Go et un dossier distincts — on peut répondre à un lot et
          renoncer à un autre.
        </Notice>
      </div>
    </div>
  );
}
