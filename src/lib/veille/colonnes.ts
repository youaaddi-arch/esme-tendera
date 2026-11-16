/**
 * Colonnes de l'export de veille, et sérialisation CSV.
 *
 * Une seule définition pour les deux formats : le CSV et le classeur doivent
 * porter les mêmes colonnes, dans le même ordre, sinon deux exports du même
 * état ne se comparent plus. C'est arrivé assez souvent ailleurs pour qu'on
 * s'épargne la question.
 *
 * Module pur : il ne connaît ni la base ni `xlsx`.
 */

export type TypeColonne = "texte" | "nombre" | "euros" | "date" | "oui-non";

export type LigneExport = {
  reference: string;
  objet: string;
  resume: string | null;
  acheteur: string;
  referenceConsultation: string | null;
  procedure: string | null;
  region: string | null;
  cpv: string[];
  lots: number;
  natureMontant: string;
  montantMin: number | null;
  montantMax: number | null;
  publieAt: Date | null;
  remiseAt: Date | null;
  joursRestants: number | null;
  appreciation: string | null;
  score: number | null;
  familleMatching: string | null;
  etape: string;
  decision: string;
  motifNoGo: string | null;
  motivationDecision: string | null;
  decidePar: string | null;
  decideLe: Date | null;
  etatDce: string;
  source: string | null;
  lienAvis: string | null;
  lienDce: string | null;
  lienDepot: string | null;
  responsable: string | null;
  creeeLe: Date;
  demonstration: boolean;
};

export type ColonneExport = {
  entete: string;
  type: TypeColonne;
  valeur: (ligne: LigneExport) => string | number | Date | boolean | null;
  /** Largeur indicative, en caractères, pour le classeur. */
  largeur: number;
};

/**
 * Ordre des colonnes : ce qui identifie, ce qui situe dans le temps, ce qui
 * chiffre, ce que la plateforme en pense, ce qu'on en a décidé, puis les
 * liens. On lit un tableau de gauche à droite, et les quatre premières
 * colonnes doivent suffire à reconnaître une affaire.
 */
export const COLONNES_EXPORT: ColonneExport[] = [
  { entete: "Référence", type: "texte", largeur: 14, valeur: (l) => l.reference },
  { entete: "Objet du marché", type: "texte", largeur: 60, valeur: (l) => l.objet },
  { entete: "Acheteur", type: "texte", largeur: 34, valeur: (l) => l.acheteur },
  { entete: "Référence de consultation", type: "texte", largeur: 20, valeur: (l) => l.referenceConsultation },
  { entete: "Date de publication", type: "date", largeur: 14, valeur: (l) => l.publieAt },
  { entete: "Date de remise des plis", type: "date", largeur: 16, valeur: (l) => l.remiseAt },
  { entete: "Jours restants", type: "nombre", largeur: 12, valeur: (l) => l.joursRestants },
  { entete: "Nature du montant", type: "texte", largeur: 18, valeur: (l) => l.natureMontant },
  { entete: "Montant minimum (€ HT)", type: "euros", largeur: 18, valeur: (l) => l.montantMin },
  { entete: "Montant maximum (€ HT)", type: "euros", largeur: 18, valeur: (l) => l.montantMax },
  { entete: "Procédure", type: "texte", largeur: 22, valeur: (l) => l.procedure },
  { entete: "Région", type: "texte", largeur: 18, valeur: (l) => l.region },
  { entete: "Nombre de lots", type: "nombre", largeur: 12, valeur: (l) => l.lots },
  { entete: "Codes CPV", type: "texte", largeur: 22, valeur: (l) => l.cpv.join(" ") || null },
  { entete: "Appréciation", type: "texte", largeur: 28, valeur: (l) => l.appreciation },
  { entete: "Score de matching", type: "nombre", largeur: 14, valeur: (l) => l.score },
  { entete: "Famille du matching", type: "texte", largeur: 16, valeur: (l) => l.familleMatching },
  { entete: "Étape du pipeline", type: "texte", largeur: 24, valeur: (l) => l.etape },
  { entete: "Décision", type: "texte", largeur: 12, valeur: (l) => l.decision },
  { entete: "Motif du NO GO", type: "texte", largeur: 28, valeur: (l) => l.motifNoGo },
  { entete: "Motivation de la décision", type: "texte", largeur: 50, valeur: (l) => l.motivationDecision },
  { entete: "Décidé par", type: "texte", largeur: 20, valeur: (l) => l.decidePar },
  { entete: "Décidé le", type: "date", largeur: 14, valeur: (l) => l.decideLe },
  { entete: "Responsable", type: "texte", largeur: 20, valeur: (l) => l.responsable },
  { entete: "État du DCE", type: "texte", largeur: 18, valeur: (l) => l.etatDce },
  { entete: "Source", type: "texte", largeur: 22, valeur: (l) => l.source },
  { entete: "Lien de l'avis", type: "texte", largeur: 46, valeur: (l) => l.lienAvis },
  { entete: "Lien du dossier (DCE)", type: "texte", largeur: 46, valeur: (l) => l.lienDce },
  { entete: "Lien de dépôt", type: "texte", largeur: 46, valeur: (l) => l.lienDepot },
  { entete: "Résumé de l'objet", type: "texte", largeur: 60, valeur: (l) => l.resume },
  { entete: "Créée le", type: "date", largeur: 14, valeur: (l) => l.creeeLe },
  { entete: "Donnée de démonstration", type: "oui-non", largeur: 14, valeur: (l) => l.demonstration },
];

function dateFr(valeur: Date): string {
  const jour = String(valeur.getUTCDate()).padStart(2, "0");
  const mois = String(valeur.getUTCMonth() + 1).padStart(2, "0");
  return `${jour}/${mois}/${valeur.getUTCFullYear()}`;
}

/** Valeur telle qu'elle doit apparaître dans un CSV français. */
export function cellule(colonne: ColonneExport, ligne: LigneExport): string {
  const valeur = colonne.valeur(ligne);
  if (valeur === null || valeur === undefined) return "";
  if (valeur instanceof Date) return dateFr(valeur);
  if (typeof valeur === "boolean") return valeur ? "oui" : "non";
  if (typeof valeur === "number") {
    // Virgule décimale : un tableur français lit « 1200,5 », pas « 1200.5 ».
    return Number.isInteger(valeur) ? String(valeur) : String(valeur).replace(".", ",");
  }
  return valeur;
}

function echapper(valeur: string): string {
  // Le point-virgule sépare les colonnes dans un CSV ouvert par un tableur
  // français : il faut donc protéger les valeurs qui en contiennent, et celles
  // qui contiennent un guillemet ou un saut de ligne.
  return /[";\r\n]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur;
}

/**
 * CSV destiné à être ouvert par un tableur.
 *
 * Point-virgule comme séparateur, retours chariot Windows, et marque d'ordre
 * des octets en tête : sans elle, Excel affiche « Côte-d'Or » en mojibake, et
 * l'export passe pour cassé alors que le fichier est juste.
 */
export function enCsv(lignes: LigneExport[]): string {
  const entetes = COLONNES_EXPORT.map((colonne) => echapper(colonne.entete)).join(";");
  const corps = lignes.map((ligne) =>
    COLONNES_EXPORT.map((colonne) => echapper(cellule(colonne, ligne))).join(";"),
  );
  return `﻿${[entetes, ...corps].join("\r\n")}\r\n`;
}
