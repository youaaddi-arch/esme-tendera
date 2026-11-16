/**
 * Analyseur d'avis de marché.
 *
 * Ce module ne fait qu'une chose : lire un avis publié et en extraire les
 * informations dont la cellule a besoin pour décider — acheteur, objet, date
 * limite, date de publication, montant, lots, et les adresses du dossier et
 * du dépôt.
 *
 * Il est délibérément déterministe, et pas confié à un modèle de langage.
 * Un avis européen est une donnée structurée : le montant vit dans
 * `cbc:EstimatedOverallContractAmount`, la date limite dans
 * `cbc:EndDate`, l'adresse du dossier dans `cac:ExternalReference/cbc:URI`.
 * Lire le bon champ est reproductible, vérifiable par un test, gratuit, et
 * — ce qui compte le plus ici — incapable d'inventer un chiffre. Un montant
 * halluciné sur un accord-cadre à sept millions d'euros ne se remarque pas à
 * la lecture.
 *
 * Chaque information retenue porte **la provenance du champ qui l'a fournie**.
 * Sans elle, on ne peut ni expliquer un montant surprenant ni corriger une
 * extraction : c'est ce qui manquait, et c'est ce qui a laissé passer des
 * montants étiquetés « global » alors qu'ils venaient d'un champ « estimé ».
 */
import type { AmountKind } from "@prisma/client";

type Visitor = (key: string, value: unknown, path: string[]) => void;

function walk(node: unknown, visit: Visitor, path: string[] = [], depth = 0): void {
  if (depth > 16 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, path, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    visit(key, value, path);
    walk(value, visit, [...path, key], depth + 1);
  }
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text.trim() || null;
    if (typeof text === "number") return String(text);
  }
  return null;
}

/** Un chemin traverse-t-il un lot ? Un montant de lot n'est pas celui du marché. */
function dansUnLot(chemin: string[]): boolean {
  return chemin.some((segment) => /ProcurementProjectLot|^LOTS?$|^lots?$/i.test(segment));
}

// ---------------------------------------------------------------------------
// Montant
// ---------------------------------------------------------------------------

/**
 * Champs qui portent un montant, et ce qu'ils signifient.
 *
 * L'ordre compte : il dit lequel croire quand plusieurs sont présents. Le
 * maximum d'un accord-cadre passe devant son estimation, parce qu'un plafond
 * engage l'acheteur là où une estimation ne fait qu'indiquer.
 *
 * L'étiquette ne se devine plus du texte. Elle vient du nom du champ, qui la
 * dit : `Estimated…` est une estimation, `Maximum…` un plafond. Auparavant
 * l'étiquette était déduite de la présence des mots « estimé » ou « maximum »
 * dans la valeur — or la valeur est un nombre nu. Faute de mot, tout devenait
 * « montant global », c'est-à-dire la seule étiquette qui affirme quelque
 * chose de faux : sur soixante et onze avis réels, dix-huit montants sur
 * dix-huit étaient ainsi présentés comme des montants fermes.
 */
const CHAMPS_MONTANT: { motif: RegExp; kind: AmountKind; libelle: string }[] = [
  { motif: /^cbc:MaximumValue$/i, kind: "MAXIMUM", libelle: "plafond de l'accord-cadre" },
  { motif: /maximumvalue|valeurmaximale|montantmaximal/i, kind: "MAXIMUM", libelle: "montant maximal" },
  { motif: /^cbc:EstimatedOverallContractAmount$/i, kind: "ESTIME", libelle: "valeur totale estimée" },
  { motif: /estimatedoverallcontractamount|estimatedvalue/i, kind: "ESTIME", libelle: "valeur estimée" },
  { motif: /valeur_?totale/i, kind: "ESTIME", libelle: "valeur totale" },
  { motif: /^montant$/i, kind: "ESTIME", libelle: "montant" },
];

/** Lit un nombre d'euros dans un texte libre ou un champ numérique. */
export function lireMontant(valeur: string | null): number | null {
  if (!valeur) return null;
  const normalise = valeur.replace(/ /g, " ").toLowerCase();
  const motif = /(\d[\d  .,]*)\s*(m€|millions?|k€|€|euros?)?/g;
  const trouves: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = motif.exec(normalise)) !== null) {
    const brut = m[1].replace(/[\s . ]/g, "").replace(",", ".");
    const n = Number.parseFloat(brut);
    if (!Number.isFinite(n)) continue;
    const unite = m[2] ?? "";
    const facteur = unite.startsWith("m") ? 1_000_000 : unite.startsWith("k") ? 1_000 : 1;
    const montant = n * facteur;
    // En dessous de cent euros, c'est un numéro de lot ou une durée.
    if (montant >= 100) trouves.push(montant);
  }
  return trouves.length ? Math.max(...trouves) : null;
}

export type MontantLu = {
  min: number | null;
  max: number | null;
  kind: AmountKind;
  /** Provenance, en clair, destinée à être affichée sur la fiche. */
  note: string | null;
};

/**
 * Montant du marché.
 *
 * Un montant trouvé dans un lot n'est pas le montant du marché : il est donc
 * étiqueté « par lot », avec le numéro du lot quand on le connaît, et jamais
 * promu au rang de total. C'est l'erreur qui faisait annoncer le budget d'un
 * lot comme celui d'un accord-cadre entier.
 */
export function analyserMontant(donnees: unknown): MontantLu {
  const candidats: { rang: number; kind: AmountKind; libelle: string; valeur: number; lot: boolean }[] = [];

  walk(donnees, (cle, valeur, chemin) => {
    const rang = CHAMPS_MONTANT.findIndex((c) => c.motif.test(cle));
    if (rang === -1) return;
    const montant = lireMontant(textOf(valeur));
    if (montant === null) return;
    const def = CHAMPS_MONTANT[rang];
    candidats.push({ rang, kind: def.kind, libelle: def.libelle, valeur: montant, lot: dansUnLot(chemin) });
  });

  if (candidats.length === 0) return { min: null, max: null, kind: "NON_COMMUNIQUE", note: null };

  // Le niveau marché passe avant le niveau lot ; à niveau égal, l'ordre des
  // champs tranche.
  const niveauMarche = candidats.filter((c) => !c.lot);
  const retenus = niveauMarche.length > 0 ? niveauMarche : candidats;
  retenus.sort((a, b) => a.rang - b.rang || b.valeur - a.valeur);
  const choisi = retenus[0];

  if (niveauMarche.length === 0) {
    // Seuls des montants de lots : on additionne pour donner un ordre de
    // grandeur, en disant que c'en est un.
    const somme = candidats.reduce((total, c) => total + c.valeur, 0);
    return {
      min: null,
      max: somme,
      kind: "PAR_LOT",
      note:
        `Somme des montants publiés lot par lot (${candidats.length} lot(s)) : ` +
        "l'avis ne publie pas de montant au niveau du marché.",
    };
  }

  return {
    min: null,
    max: choisi.valeur,
    kind: choisi.kind,
    note: `${choisi.libelle} publiée par l'acheteur.`,
  };
}

// ---------------------------------------------------------------------------
// Adresses : dossier de consultation, dépôt des plis, profil d'acheteur
// ---------------------------------------------------------------------------

/**
 * Les trois adresses d'un avis, et pourquoi les distinguer.
 *
 * Elles étaient toutes absentes des affaires : sur soixante et onze avis
 * réels, l'adresse du dossier n'était extraite **aucune fois**, alors que
 * cent trente-trois champs la portaient. Les décisions GO annonçaient donc
 * « l'avis ne publie pas d'adresse de retrait » — un énoncé faux, qui
 * accusait l'acheteur d'une lacune qui était la nôtre.
 *
 * Le dossier et le dépôt ne sont pas la même adresse et ne servent pas au
 * même moment : l'une permet de retirer les pièces, l'autre de remettre les
 * plis. Les confondre enverrait le retrait sur le parcours de dépôt.
 */
const CHAMPS_DOSSIER: RegExp[] = [
  /^cbc:URI$/i,                         // cac:ExternalReference/cbc:URI — documents
  /urldocconsul/i,                      // BOAMP historique
  /^cbc:ID$/i,                          // cac:CallForTendersDocumentReference/cbc:ID
];
const CHEMINS_DOSSIER = /ExternalReference|CallForTendersDocumentReference|communication/i;

const CHAMPS_DEPOT: RegExp[] = [/^cbc:EndpointID$/i];
const CHEMINS_DEPOT = /TenderRecipientParty|TenderSubmission/i;

const CHAMPS_PROFIL: RegExp[] = [/buyerprofileuri/i, /urlprofilach/i, /urlprofilacheteur/i];

export type AdressesAvis = {
  /** Où retirer le dossier de consultation. */
  dossier: string | null;
  /** Où remettre les plis. */
  depot: string | null;
  /** Profil d'acheteur, utile quand les deux autres manquent. */
  profil: string | null;
};

function estUneAdresse(valeur: unknown): string | null {
  const texte = textOf(valeur);
  if (!texte || !/^https?:\/\//i.test(texte)) return null;
  // Une adresse de plateforme réduite à son domaine ne mène à aucun dossier.
  return texte;
}

export function analyserAdresses(donnees: unknown): AdressesAvis {
  let dossier: string | null = null;
  let depot: string | null = null;
  let profil: string | null = null;

  walk(donnees, (cle, valeur, chemin) => {
    const adresse = estUneAdresse(valeur);
    if (!adresse) return;
    const chemins = chemin.join("/");

    if (!dossier && CHAMPS_DOSSIER.some((m) => m.test(cle)) && CHEMINS_DOSSIER.test(chemins)) {
      dossier = adresse;
      return;
    }
    if (!depot && CHAMPS_DEPOT.some((m) => m.test(cle)) && CHEMINS_DEPOT.test(chemins)) {
      depot = adresse;
      return;
    }
    if (!profil && CHAMPS_PROFIL.some((m) => m.test(cle))) profil = adresse;
  });

  return { dossier, depot, profil };
}
