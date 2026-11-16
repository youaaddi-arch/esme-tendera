import "server-only";

/**
 * Export de la veille.
 *
 * Ce que la veille a ramené doit pouvoir sortir d'ici. Pas pour quitter la
 * plateforme : pour être lu ailleurs — en comité, dans un courriel, à côté
 * d'un tableau de charge. Un outil qui retient ses données force à les
 * ressaisir, et la ressaisie fabrique une seconde vérité.
 *
 * Les filtres portent sur ce qui sert réellement à découper un portefeuille :
 * les deux dates qui comptent, le montant, l'acheteur, l'appréciation, le
 * stade et la décision.
 */
import type { GoNoGoStatus, PipelineStage, TenderNature } from "@prisma/client";
import * as XLSX from "xlsx";

import { prisma } from "../db";
import {
  amountKindLabels, dceStatusLabels, goNoGoLabels, natureLabels, noGoReasonLabels, stageLabels,
} from "../labels";
import { COLONNES_EXPORT, cellule, type LigneExport } from "./colonnes";

export type FiltresExport = {
  /** Fenêtre sur la date de publication de l'avis. */
  publieDu?: Date | null;
  publieAu?: Date | null;
  /** Fenêtre sur la date limite de remise des plis. */
  remiseDu?: Date | null;
  remiseAu?: Date | null;
  /** Bornes sur le montant retenu : le maximum s'il est connu, sinon le minimum. */
  montantMin?: number | null;
  montantMax?: number | null;
  /** Fragment du nom de l'acheteur. */
  client?: string | null;
  /** Fragment de l'objet ou de l'intitulé. */
  objet?: string | null;
  nature?: TenderNature | null;
  scoreMin?: number | null;
  etape?: PipelineStage | null;
  decision?: GoNoGoStatus | null;
  /** Clé du connecteur d'origine. */
  source?: string | null;
  /** Nombre de jours écoulés depuis la création de la fiche. */
  depuisJours?: number | null;
  /** Inclure les affaires archivées. Exclues par défaut. */
  avecArchivees?: boolean;
  /** Inclure les fiches de démonstration. Exclues par défaut. */
  avecDemo?: boolean;
  /** Garde-fou : un export n'est pas une sauvegarde. */
  limite?: number;
};

export const LIMITE_EXPORT = 5_000;

const FAMILLES: Record<number, string> = { 1: "Catalogue ESME", 2: "Formation voisine", 3: "Groupe IONIS" };

function joursRestants(echeance: Date | null): number | null {
  if (!echeance) return null;
  const jour = 86_400_000;
  const aujourdhui = Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
  );
  const cible = Date.UTC(echeance.getUTCFullYear(), echeance.getUTCMonth(), echeance.getUTCDate());
  return Math.round((cible - aujourdhui) / jour);
}

/**
 * Montant retenu pour le filtre : le maximum s'il est connu, sinon le
 * minimum. C'est le montant que l'œil lit sur la fiche, et il serait absurde
 * de filtrer sur un autre.
 */
function montantRetenu(ligne: { montantMin: number | null; montantMax: number | null }): number | null {
  return ligne.montantMax ?? ligne.montantMin;
}

export async function collecterExport(
  filtres: FiltresExport,
): Promise<{ lignes: LigneExport[]; tronque: boolean }> {
  const limite = Math.max(1, Math.min(LIMITE_EXPORT, filtres.limite ?? LIMITE_EXPORT));

  const creeeApres = filtres.depuisJours
    ? new Date(Date.now() - filtres.depuisJours * 86_400_000)
    : null;

  const affaires = await prisma.tender.findMany({
    where: {
      ...(filtres.avecArchivees ? {} : { archived: false }),
      ...(filtres.avecDemo ? {} : { isDemo: false }),
      ...(creeeApres ? { createdAt: { gte: creeeApres } } : {}),
      ...(filtres.publieDu || filtres.publieAu
        ? {
            publishedAt: {
              ...(filtres.publieDu ? { gte: filtres.publieDu } : {}),
              ...(filtres.publieAu ? { lte: filtres.publieAu } : {}),
            },
          }
        : {}),
      ...(filtres.remiseDu || filtres.remiseAu
        ? {
            deadlineAt: {
              ...(filtres.remiseDu ? { gte: filtres.remiseDu } : {}),
              ...(filtres.remiseAu ? { lte: filtres.remiseAu } : {}),
            },
          }
        : {}),
      ...(filtres.client ? { buyer: { contains: filtres.client, mode: "insensitive" as const } } : {}),
      ...(filtres.objet
        ? {
            OR: [
              { title: { contains: filtres.objet, mode: "insensitive" as const } },
              { objectSummary: { contains: filtres.objet, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(filtres.etape ? { stage: filtres.etape } : {}),
      ...(filtres.decision ? { goNoGo: filtres.decision } : {}),
      ...(filtres.source ? { sourceConnector: { key: filtres.source } } : {}),
      ...(filtres.nature || filtres.scoreMin !== null && filtres.scoreMin !== undefined
        ? {
            matchResult: {
              ...(filtres.nature ? { nature: filtres.nature } : {}),
              ...(filtres.scoreMin !== null && filtres.scoreMin !== undefined
                ? { scoreGlobal: { gte: filtres.scoreMin } }
                : {}),
            },
          }
        : {}),
    },
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
    take: limite + 1,
    select: {
      reference: true, title: true, objectSummary: true, buyer: true, consultationRef: true,
      procedure: true, region: true, cpvCodes: true, publishedAt: true, deadlineAt: true,
      amountKind: true, amountMinEur: true, amountMaxEur: true, stage: true, goNoGo: true,
      dceStatus: true, sourceUrl: true, dceSourceUrl: true, depotUrl: true, isDemo: true,
      createdAt: true,
      owner: { select: { name: true } },
      sourceConnector: { select: { name: true } },
      matchResult: { select: { scoreGlobal: true, nature: true, natureLabel: true, rang: true } },
      decisions: {
        where: { superseded: false },
        orderBy: { decidedAt: "desc" },
        take: 1,
        select: {
          reason: true, rationale: true, decidedAt: true, decidedBy: { select: { name: true } },
        },
      },
      _count: { select: { lots: true } },
    },
  });

  const lignes: LigneExport[] = affaires.map((affaire) => {
    const decision = affaire.decisions[0] ?? null;
    return {
      reference: affaire.reference,
      objet: affaire.title,
      resume: affaire.objectSummary,
      acheteur: affaire.buyer,
      referenceConsultation: affaire.consultationRef,
      procedure: affaire.procedure,
      region: affaire.region,
      cpv: affaire.cpvCodes,
      lots: affaire._count.lots,
      natureMontant: amountKindLabels[affaire.amountKind],
      montantMin: affaire.amountMinEur === null ? null : Number(affaire.amountMinEur),
      montantMax: affaire.amountMaxEur === null ? null : Number(affaire.amountMaxEur),
      publieAt: affaire.publishedAt,
      remiseAt: affaire.deadlineAt,
      joursRestants: joursRestants(affaire.deadlineAt),
      appreciation: affaire.matchResult
        ? (affaire.matchResult.natureLabel ?? natureLabels[affaire.matchResult.nature])
        : null,
      score: affaire.matchResult ? Math.round(affaire.matchResult.scoreGlobal) : null,
      familleMatching: affaire.matchResult?.rang ? (FAMILLES[affaire.matchResult.rang] ?? null) : null,
      etape: stageLabels[affaire.stage],
      decision: goNoGoLabels[affaire.goNoGo],
      motifNoGo: decision?.reason ? noGoReasonLabels[decision.reason] : null,
      motivationDecision: decision?.rationale ?? null,
      decidePar: decision?.decidedBy?.name ?? null,
      decideLe: decision?.decidedAt ?? null,
      etatDce: dceStatusLabels[affaire.dceStatus],
      source: affaire.sourceConnector?.name ?? null,
      lienAvis: affaire.sourceUrl,
      lienDce: affaire.dceSourceUrl,
      lienDepot: affaire.depotUrl,
      responsable: affaire.owner?.name ?? null,
      creeeLe: affaire.createdAt,
      demonstration: affaire.isDemo,
    };
  });

  // Le montant se filtre après la requête : le montant retenu est le maximum
  // s'il existe et le minimum sinon, ce qu'une clause SQL n'exprime pas sans
  // devenir illisible. Les volumes en jeu — quelques milliers de lignes — ne
  // justifient pas de l'y forcer.
  const bornes = lignes.filter((ligne) => {
    const montant = montantRetenu(ligne);
    if (filtres.montantMin !== null && filtres.montantMin !== undefined) {
      if (montant === null || montant < filtres.montantMin) return false;
    }
    if (filtres.montantMax !== null && filtres.montantMax !== undefined) {
      if (montant === null || montant > filtres.montantMax) return false;
    }
    return true;
  });

  return { lignes: bornes.slice(0, limite), tronque: bornes.length > limite };
}

/**
 * Classeur `.xlsx`.
 *
 * Les dates y sont de vraies dates et les montants de vrais nombres : un
 * export qui ne se trie ni ne se somme n'est qu'une image de tableau. Le filtre
 * automatique est posé sur la plage, et la largeur des colonnes fixée, pour que
 * le fichier soit lisible à l'ouverture sans un quart d'heure de mise en forme.
 */
export function enXlsx(lignes: LigneExport[]): Buffer {
  const entetes = COLONNES_EXPORT.map((colonne) => colonne.entete);
  const corps = lignes.map((ligne) =>
    COLONNES_EXPORT.map((colonne) => {
      const valeur = colonne.valeur(ligne);
      if (valeur === null || valeur === undefined) return null;
      if (typeof valeur === "boolean") return valeur ? "oui" : "non";
      if (valeur instanceof Date || typeof valeur === "number") return valeur;
      return valeur;
    }),
  );

  const feuille = XLSX.utils.aoa_to_sheet([entetes, ...corps], { cellDates: true });
  feuille["!cols"] = COLONNES_EXPORT.map((colonne) => ({ wch: colonne.largeur }));
  if (lignes.length > 0) {
    feuille["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: lignes.length, c: COLONNES_EXPORT.length - 1 },
      }),
    };
  }

  // Format d'affichage par colonne : une date qui s'affiche en numéro de série
  // et un montant sans séparateur de milliers passent pour des données fausses.
  for (const [index, colonne] of COLONNES_EXPORT.entries()) {
    if (colonne.type !== "date" && colonne.type !== "euros") continue;
    for (let rang = 1; rang <= lignes.length; rang += 1) {
      const adresse = XLSX.utils.encode_cell({ r: rang, c: index });
      const cellule = feuille[adresse];
      if (!cellule || cellule.v === null || cellule.v === undefined) continue;
      cellule.z = colonne.type === "date" ? "dd/mm/yyyy" : "# ##0 €";
    }
  }

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, "Veille");
  return XLSX.write(classeur, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Nom de fichier daté : deux exports du même jour ne doivent pas se confondre. */
export function nomFichier(extension: "csv" | "xlsx"): string {
  const maintenant = new Date();
  const horodatage = [
    maintenant.getFullYear(),
    String(maintenant.getMonth() + 1).padStart(2, "0"),
    String(maintenant.getDate()).padStart(2, "0"),
  ].join("-");
  return `veille-esme-tendera-${horodatage}.${extension}`;
}

/** Récapitulatif des filtres appliqués, en clair, pour l'afficher ou le journaliser. */
export function decrireFiltres(filtres: FiltresExport): string {
  const parties: string[] = [];
  const jour = (date: Date) => cellule({ entete: "", type: "date", largeur: 0, valeur: () => date }, {} as LigneExport);
  if (filtres.publieDu || filtres.publieAu) {
    parties.push(
      `publiés ${filtres.publieDu ? `du ${jour(filtres.publieDu)}` : ""}${filtres.publieAu ? ` au ${jour(filtres.publieAu)}` : ""}`.trim(),
    );
  }
  if (filtres.remiseDu || filtres.remiseAu) {
    parties.push(
      `remise ${filtres.remiseDu ? `du ${jour(filtres.remiseDu)}` : ""}${filtres.remiseAu ? ` au ${jour(filtres.remiseAu)}` : ""}`.trim(),
    );
  }
  if (filtres.montantMin) parties.push(`montant ≥ ${filtres.montantMin.toLocaleString("fr-FR")} €`);
  if (filtres.montantMax) parties.push(`montant ≤ ${filtres.montantMax.toLocaleString("fr-FR")} €`);
  if (filtres.client) parties.push(`acheteur « ${filtres.client} »`);
  if (filtres.objet) parties.push(`objet « ${filtres.objet} »`);
  if (filtres.nature) parties.push(natureLabels[filtres.nature]);
  if (filtres.scoreMin) parties.push(`score ≥ ${filtres.scoreMin}`);
  if (filtres.etape) parties.push(stageLabels[filtres.etape]);
  if (filtres.decision) parties.push(goNoGoLabels[filtres.decision]);
  if (filtres.source) parties.push(`source ${filtres.source}`);
  if (filtres.depuisJours) parties.push(`créées depuis ${filtres.depuisJours} jour(s)`);
  if (filtres.avecArchivees) parties.push("archivées incluses");
  if (filtres.avecDemo) parties.push("démonstration incluse");
  return parties.length > 0 ? parties.join(", ") : "aucun filtre";
}
