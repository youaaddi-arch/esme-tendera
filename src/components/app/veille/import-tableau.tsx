"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FileSpreadsheet, Upload } from "lucide-react";

import { Badge, Card, CardHeader, Field, Notice, Table, Td, Th } from "@/components/ui";
import { importerTableauAction, type ImportState } from "@/app/(app)/veille/actions";
import type { EtatLigne } from "@/lib/veille/import-tableau";

const ETATS: Record<EtatLigne, { libelle: string; tone: "ok" | "warn" | "danger" | "neutral" | "esme" }> = {
  creee: { libelle: "Créée", tone: "ok" },
  "deja-presente": { libelle: "Déjà suivie", tone: "neutral" },
  "doublon-fichier": { libelle: "Doublon", tone: "neutral" },
  incomplete: { libelle: "Incomplète", tone: "warn" },
  "non-traitee": { libelle: "Non traitée", tone: "warn" },
  echec: { libelle: "Échec", tone: "danger" },
};

function Boutons() {
  // `useFormStatus` doit être lu depuis un enfant du formulaire, sinon il
  // renvoie toujours « au repos ».
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        name="appliquer"
        value="0"
        disabled={pending}
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-4 text-[13px] font-medium text-esme-800 hover:border-esme-400 hover:bg-esme-50 disabled:opacity-60"
      >
        <FileSpreadsheet className="size-4" aria-hidden />
        {pending ? "Lecture du tableau…" : "Analyser sans rien créer"}
      </button>
      <button
        type="submit"
        name="appliquer"
        value="1"
        disabled={pending}
        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-esme-600 px-4 text-[13px] font-medium text-white hover:bg-esme-700 disabled:opacity-60"
      >
        <Upload className="size-4" aria-hidden />
        {pending ? "Import en cours…" : "Importer dans le pipeline"}
      </button>
    </div>
  );
}

/**
 * Import d'un tableau de veille.
 *
 * L'aperçu est le chemin normal, et le bouton le plus discret n'est pas celui
 * qui écrit : on lit d'abord ce que la plateforme a compris du classeur, parce
 * qu'un en-tête mal reconnu produit deux cents fiches à reprendre.
 */
export function ImportTableau() {
  const [etat, action] = useActionState<ImportState | null, FormData>(importerTableauAction, null);
  const rapport = etat?.rapport;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Déposer le tableau"
          subtitle="Formats acceptés : .xlsx, .xls, .ods et .csv. 4 Mo au plus."
        />
        <form action={action} className="space-y-4 p-5">
          <Field
            label="Fichier"
            required
            hint="La première feuille remplie est lue. Les en-têtes sont cherchés dans les dix premières lignes : un titre au-dessus du tableau ne gêne pas."
          >
            <input
              type="file"
              name="fichier"
              required
              accept=".xlsx,.xls,.ods,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet"
              className="block w-full cursor-pointer rounded-lg border border-ink-300 bg-white p-2 text-[13px] text-ink-700 file:mr-3 file:rounded-full file:border-0 file:bg-esme-50 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-esme-800"
            />
          </Field>

          <Field
            label="Colonne de décision du tableau"
            hint="Si le tableau porte une colonne « Go / No Go », dites ce qu'il faut en faire."
          >
            <select
              name="reprise"
              defaultValue="aucune"
              className="h-10 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm sm:max-w-md"
            >
              <option value="aucune">Ne rien reprendre — les affaires arrivent « à décider »</option>
              <option value="no-go">Reprendre les NO GO seulement</option>
              <option value="toutes">Reprendre les GO et les NO GO</option>
            </select>
          </Field>

          <Notice tone="info">
            Un GO repris crée aussitôt l&apos;espace de réponse et demande le retrait du dossier, pour
            chaque ligne concernée. Sur un tableau qui en compte vingt, cela fait vingt chantiers
            ouverts d&apos;un coup : ne le choisissez qu&apos;en connaissance de cause.
          </Notice>

          <Boutons />
        </form>
      </Card>

      {etat ? (
        <Notice tone={etat.ok ? (rapport?.applique ? "ok" : "info") : "danger"} title={etat.ok ? undefined : "Import refusé"}>
          {etat.message}
        </Notice>
      ) : null}

      {rapport ? (
        <>
          <Card>
            <CardHeader
              title="Ce qui a été compris du classeur"
              subtitle={`Fichier « ${rapport.fichier} », feuille « ${rapport.feuille} ».`}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-400">Colonnes reconnues</p>
                <ul className="mt-1.5 space-y-1 text-[12px] text-ink-700">
                  {rapport.colonnes.map((colonne) => (
                    <li key={colonne.champ}>
                      <span className="font-medium text-esme-900">{colonne.champ}</span>
                      {" ← "}
                      <span className="font-mono text-[11px] text-ink-500">« {colonne.intitule} »</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-400">
                  Colonnes laissées de côté
                </p>
                {rapport.inconnues.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-ink-500">Aucune.</p>
                ) : (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-700">
                    {rapport.inconnues.map((entete) => `« ${entete} »`).join(", ")}. Elles ne sont pas
                    interprétées : rien de leur contenu n&apos;entre dans les fiches.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-ink-100 px-5 py-3 text-[12px]">
              <Badge tone="ok">
                {rapport.compte.creees} {rapport.applique ? "créée(s)" : "à créer"}
              </Badge>
              <Badge tone="neutral">{rapport.compte.dejaPresentes} déjà suivie(s)</Badge>
              {rapport.compte.doublonsFichier > 0 ? (
                <Badge tone="neutral">{rapport.compte.doublonsFichier} doublon(s) dans le fichier</Badge>
              ) : null}
              {rapport.compte.incompletes > 0 ? (
                <Badge tone="warn">{rapport.compte.incompletes} incomplète(s)</Badge>
              ) : null}
              {rapport.compte.nonTraitees > 0 ? (
                <Badge tone="warn">{rapport.compte.nonTraitees} non traitée(s)</Badge>
              ) : null}
              {rapport.compte.echecs > 0 ? (
                <Badge tone="danger">{rapport.compte.echecs} échec(s)</Badge>
              ) : null}
              {rapport.compte.decisions > 0 ? (
                <Badge tone="esme">{rapport.compte.decisions} décision(s) reprise(s)</Badge>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Ligne à ligne"
              subtitle={`${rapport.lignes.length} ligne(s) lue(s). Les lignes vides du classeur ne sont pas comptées.`}
            />
            <Table>
              <thead>
                <tr>
                  <Th className="w-16">Ligne</Th>
                  <Th>Marché</Th>
                  <Th className="w-32">État</Th>
                  <Th>Ce qui s&apos;est passé</Th>
                </tr>
              </thead>
              <tbody>
                {rapport.lignes.map((ligne) => (
                  <tr key={ligne.ligne}>
                    <Td className="font-mono text-[12px] text-ink-500">{ligne.ligne}</Td>
                    <Td>
                      <p className="text-[13px] text-esme-900">{ligne.objet ?? "—"}</p>
                      <p className="mt-0.5 text-[12px] text-ink-500">{ligne.acheteur ?? "Acheteur absent"}</p>
                    </Td>
                    <Td>
                      <Badge tone={ETATS[ligne.etat].tone}>{ETATS[ligne.etat].libelle}</Badge>
                      {ligne.reference ? (
                        <Link
                          href={`/affaires?q=${encodeURIComponent(ligne.reference)}`}
                          className="mt-1 block font-mono text-[11px] text-esme-700 hover:underline"
                        >
                          {ligne.reference}
                        </Link>
                      ) : null}
                    </Td>
                    <Td className="text-[12px] text-ink-700">
                      {ligne.message}
                      {ligne.precisions.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-ink-500">
                          {ligne.precisions.map((precision, index) => (
                            <li key={index}>— {precision}</li>
                          ))}
                        </ul>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
