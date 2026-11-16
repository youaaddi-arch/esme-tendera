import "server-only";

/**
 * Import d'un tableau de veille dans le pipeline.
 *
 * Le classeur tenu à la main est la source la plus riche dont dispose
 * l'établissement : il contient des procédures adaptées qui ne sont publiées
 * nulle part, et des lignes vues par quelqu'un. Il n'a pas à être retapé.
 *
 * Deux règles tiennent tout ce module :
 *
 *   — Rien n'est inventé. Une ligne sans objet ou sans acheteur n'est pas
 *     importée : elle est rapportée comme incomplète. Un montant qu'on ne
 *     sait pas lire reste absent plutôt que d'être approché.
 *   — Rien n'est écrasé. Un avis déjà présent est reconnu et laissé tel quel ;
 *     l'import ne corrige pas une fiche existante, parce qu'un tableau tenu à
 *     la main n'est pas plus récent par nature que ce que la veille a ramené.
 *
 * L'analyse et la création sont le même chemin, à un drapeau près. C'est
 * voulu : un aperçu qui n'emprunte pas le code de l'écriture finit par
 * annoncer autre chose que ce qui se produit.
 */
import * as XLSX from "xlsx";

import { prisma } from "../db";
import { recordAudit } from "../audit";
import { recordDecision } from "../decisions";
import { createManualTender } from "../tender-manuel";
import { clefIdentifiant, identifiantDepuisLien } from "./liens";
import { lireLignes, trouverEntetes, type Cellule, type LigneTableau } from "./tableau";

/** Ce que l'import fait des décisions lues dans le tableau. */
export type RepriseDecisions = "aucune" | "no-go" | "toutes";

export type EtatLigne =
  | "creee"
  | "deja-presente"
  | "doublon-fichier"
  | "incomplete"
  | "non-traitee"
  | "echec";

export type RapportLigne = {
  ligne: number;
  etat: EtatLigne;
  objet: string | null;
  acheteur: string | null;
  /** Référence de l'affaire créée, ou de celle qui existait déjà. */
  reference: string | null;
  message: string;
  /** Décision lue dans le tableau, et ce qu'on en a fait. */
  decision: string | null;
  /** Lectures explicitées : un montant abrégé, une date ambiguë. */
  precisions: string[];
};

export type RapportImport = {
  fichier: string;
  feuille: string;
  /** Colonnes reconnues : champ interne et intitulé réel du classeur. */
  colonnes: { champ: string; intitule: string }[];
  /** Colonnes du classeur qu'on ne sait pas interpréter. */
  inconnues: string[];
  /** Faux : rien n'a été écrit, c'est un aperçu. */
  applique: boolean;
  reprise: RepriseDecisions;
  lignes: RapportLigne[];
  compte: {
    total: number;
    creees: number;
    dejaPresentes: number;
    doublonsFichier: number;
    incompletes: number;
    nonTraitees: number;
    echecs: number;
    decisions: number;
  };
};

export type EchecImport = { erreur: string };

/** Taille acceptée : au-delà, ce n'est plus un tableau de veille. */
export const TAILLE_MAX = 4 * 1024 * 1024;

/**
 * Budget de temps.
 *
 * L'hébergement coupe une requête à soixante secondes, et chaque création
 * entraîne un calcul de matching. Plutôt que d'échouer à la cinquantième ligne
 * en laissant quarante-neuf affaires créées et aucun compte rendu, on s'arrête
 * à temps et on dit où on s'est arrêté : le même fichier, réimporté, reprendra
 * la suite, puisque ce qui est déjà là est reconnu.
 */
const BUDGET_MS = 40_000;

const NORMALISE = (valeur: string): string =>
  valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const LIBELLE_CHAMP: Record<string, string> = {
  objet: "Objet du marché",
  acheteur: "Acheteur",
  reference: "Référence de consultation",
  resume: "Résumé de l'objet",
  procedure: "Procédure",
  region: "Région",
  cpv: "Codes CPV",
  lien: "Lien de l'avis",
  lienDce: "Lien du dossier",
  lienDepot: "Lien de dépôt",
  publieAt: "Date de publication",
  remiseAt: "Date de remise des plis",
  montant: "Montant",
  decision: "Décision",
  commentaire: "Commentaire",
  lots: "Lots",
};

/** Matrice de la première feuille non vide du classeur. */
function lireClasseur(octets: Buffer): { matrice: Cellule[][]; feuille: string } | EchecImport {
  let classeur: XLSX.WorkBook;
  try {
    classeur = XLSX.read(octets, { cellDates: true, raw: false });
  } catch {
    return {
      erreur:
        "Le fichier n'a pas pu être ouvert. Les formats acceptés sont .xlsx, .xls, .ods et .csv.",
    };
  }

  for (const nom of classeur.SheetNames) {
    const feuille = classeur.Sheets[nom];
    if (!feuille) continue;
    const matrice = XLSX.utils.sheet_to_json<Cellule[]>(feuille, {
      header: 1,
      defval: null,
      blankrows: true,
      raw: true,
    });
    if (matrice.some((ligne) => ligne.some((cellule) => cellule !== null && cellule !== ""))) {
      return { matrice, feuille: nom };
    }
  }
  return { erreur: "Le classeur ne contient aucune feuille remplie." };
}

type Connue = {
  id: string;
  reference: string;
  title: string;
  buyer: string;
  consultationRef: string | null;
  sourceNoticeId: string | null;
};

/** Index des affaires existantes, par identifiant d'avis, référence, et objet+acheteur. */
async function indexerExistantes(): Promise<{
  parAvis: Map<string, Connue>;
  parReference: Map<string, Connue>;
  parObjet: Map<string, Connue>;
}> {
  const affaires = await prisma.tender.findMany({
    select: {
      id: true, reference: true, title: true, buyer: true, consultationRef: true,
      sourceNoticeId: true,
    },
    take: 20_000,
  });

  const parAvis = new Map<string, Connue>();
  const parReference = new Map<string, Connue>();
  const parObjet = new Map<string, Connue>();
  for (const affaire of affaires) {
    if (affaire.sourceNoticeId) parAvis.set(clefAvis(affaire.sourceNoticeId), affaire);
    if (affaire.consultationRef) parReference.set(NORMALISE(affaire.consultationRef), affaire);
    parObjet.set(`${NORMALISE(affaire.title)}|${NORMALISE(affaire.buyer)}`, affaire);
  }
  return { parAvis, parReference, parObjet };
}

/**
 * Forme comparable d'un identifiant d'avis.
 *
 * Le même avis TED s'écrit « 725368-2026 » dans un lien et
 * « TED-00725368-2026 » dans notre base : comparer les chaînes telles quelles
 * ferait manquer la correspondance, et l'import créerait un doublon de ce que
 * la veille a déjà ramené.
 */
function clefAvis(identifiant: string): string {
  return NORMALISE(clefIdentifiant(identifiant));
}

/** Identifiant de l'avis déduit d'un lien, quand le lien en porte un. */
function avisDe(ligne: LigneTableau): { source: "BOAMP" | "TED"; identifiant: string } | null {
  for (const lien of [ligne.lien, ligne.lienDce, ligne.lienDepot]) {
    if (!lien) continue;
    const trouve = identifiantDepuisLien(lien);
    if (trouve) return trouve;
  }
  return null;
}

/**
 * Identifiant tel qu'il sera écrit sur la fiche.
 *
 * On reprend la forme qu'emploie le connecteur de la source — « TED- » et le
 * numéro complété à huit chiffres — afin que la veille reconnaisse plus tard
 * le même avis au lieu d'en recréer une fiche. C'est une mise en forme, pas
 * une donnée ajoutée : le numéro reste celui du lien.
 */
function avisCanonique(avis: { source: "BOAMP" | "TED"; identifiant: string }): string {
  if (avis.source !== "TED") return avis.identifiant;
  const parties = avis.identifiant.match(/^(\d+)-(20\d\d)$/);
  return parties ? `TED-${parties[1].padStart(8, "0")}-${parties[2]}` : `TED-${avis.identifiant}`;
}

export async function importerTableau(options: {
  nom: string;
  octets: Buffer;
  /** Faux : on analyse et on rend compte, sans rien écrire. */
  appliquer: boolean;
  reprise: RepriseDecisions;
  userId: string;
}): Promise<RapportImport | EchecImport> {
  if (options.octets.byteLength > TAILLE_MAX) {
    return {
      erreur: `Le fichier dépasse ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo. Exportez la seule feuille de veille, sans les images ni les onglets annexes.`,
    };
  }

  const lecture = lireClasseur(options.octets);
  if ("erreur" in lecture) return lecture;

  const trouve = trouverEntetes(lecture.matrice);
  if (!trouve) {
    return {
      erreur:
        "Aucune ligne d'en-têtes reconnue dans les dix premières lignes. Le tableau doit comporter au moins deux colonnes identifiables, par exemple « Objet du marché » et « Acheteur ».",
    };
  }

  const { colonnes, intitules, inconnues } = trouve.entetes;
  if (colonnes.objet === undefined || colonnes.acheteur === undefined) {
    const manquantes = [
      colonnes.objet === undefined ? "l'objet du marché" : null,
      colonnes.acheteur === undefined ? "l'acheteur" : null,
    ].filter(Boolean);
    return {
      erreur: `Colonne(s) introuvable(s) : ${manquantes.join(" et ")}. Sans elles, une affaire n'a pas d'identité et rien ne peut être créé. Intitulés reconnus : ${Object.values(intitules).join(", ") || "aucun"}.`,
    };
  }

  const lignes = lireLignes(lecture.matrice, trouve.entetes, trouve.index).filter(
    (ligne) => !ligne.vide,
  );
  const index = await indexerExistantes();
  const vuesDansLeFichier = new Map<string, number>();
  const rapport: RapportLigne[] = [];
  const debut = Date.now();
  let creees = 0;
  let decisionsAppliquees = 0;

  for (const ligne of lignes) {
    const base = {
      ligne: ligne.ligne,
      objet: ligne.objet,
      acheteur: ligne.acheteur,
      decision: ligne.decision,
      precisions: ligne.montant?.interpretation ? [ligne.montant.interpretation] : [],
    };

    if (!ligne.objet || !ligne.acheteur) {
      rapport.push({
        ...base,
        etat: "incomplete",
        reference: null,
        message: !ligne.objet
          ? "Objet du marché absent : rien ne permettrait de reconnaître cette affaire."
          : "Acheteur absent : une consultation sans acheteur ne peut pas être suivie.",
      });
      continue;
    }

    const avis = avisDe(ligne);
    const clefObjet = `${NORMALISE(ligne.objet)}|${NORMALISE(ligne.acheteur)}`;

    // Doublon à l'intérieur du fichier lui-même : fréquent, parce qu'un
    // tableau tenu à la main répète une ligne par lot.
    const clef = avis ? `avis:${clefAvis(avis.identifiant)}` : `objet:${clefObjet}`;
    const dejaVue = vuesDansLeFichier.get(clef);
    if (dejaVue !== undefined) {
      rapport.push({
        ...base,
        etat: "doublon-fichier",
        reference: null,
        message: `Même marché que la ligne ${dejaVue} du fichier.`,
      });
      continue;
    }
    vuesDansLeFichier.set(clef, ligne.ligne);

    const connue =
      (avis ? index.parAvis.get(clefAvis(avis.identifiant)) : undefined) ??
      (ligne.reference ? index.parReference.get(NORMALISE(ligne.reference)) : undefined) ??
      index.parObjet.get(clefObjet);

    if (connue) {
      rapport.push({
        ...base,
        etat: "deja-presente",
        reference: connue.reference,
        message: avis
          ? `Avis ${avis.source} ${avis.identifiant} déjà suivi. La fiche existante n'est pas modifiée.`
          : "Même objet et même acheteur qu'une affaire existante. La fiche n'est pas modifiée.",
      });
      continue;
    }

    if (Date.now() - debut > BUDGET_MS) {
      rapport.push({
        ...base,
        etat: "non-traitee",
        reference: null,
        message: "Temps imparti atteint. Réimportez le même fichier : ce qui est déjà créé sera reconnu.",
      });
      continue;
    }

    if (!options.appliquer) {
      rapport.push({
        ...base,
        etat: "creee",
        reference: null,
        message: "Serait créée.",
      });
      creees += 1;
      continue;
    }

    try {
      const affaire = await createManualTender({
        title: ligne.objet,
        buyer: ligne.acheteur,
        consultationRef: ligne.reference,
        objectSummary: ligne.resume,
        procedure: ligne.procedure,
        deadlineAt: ligne.remiseAt,
        publishedAt: ligne.publieAt,
        sourceUrl: ligne.lien,
        dceSourceUrl: ligne.lienDce,
        depotUrl: ligne.lienDepot,
        sourceNoticeId: avis ? avisCanonique(avis) : null,
        region: ligne.region,
        cpvCodes: ligne.cpv,
        amountKind: ligne.montant ? "ESTIME" : "NON_COMMUNIQUE",
        amountMaxEur: ligne.montant?.valeur ?? null,
        amountNote: ligne.montant
          ? `Montant repris du tableau « ${options.nom} », ligne ${ligne.ligne}.`
          : null,
        userId: options.userId,
        provenance:
          `tableau de veille « ${options.nom} », feuille « ${lecture.feuille} », ligne ${ligne.ligne}` +
          (ligne.commentaire ? ` — note du tableau : ${ligne.commentaire}` : ""),
      });

      // L'index s'enrichit au fur et à mesure : deux lignes identiques dans
      // deux fichiers successifs ne doivent pas produire deux fiches.
      const ajoutee: Connue = {
        id: affaire.id, reference: affaire.reference, title: ligne.objet,
        buyer: ligne.acheteur, consultationRef: ligne.reference,
        sourceNoticeId: avis ? avisCanonique(avis) : null,
      };
      if (avis) index.parAvis.set(clefAvis(avis.identifiant), ajoutee);
      if (ligne.reference) index.parReference.set(NORMALISE(ligne.reference), ajoutee);
      index.parObjet.set(clefObjet, ajoutee);

      const precisions = [...base.precisions];
      const reprendre =
        ligne.decision === "NO_GO"
          ? options.reprise !== "aucune"
          : ligne.decision === "GO"
            ? options.reprise === "toutes"
            : false;

      if (reprendre && ligne.decision) {
        const issue = await recordDecision(affaire.id, {
          status: ligne.decision,
          rationale:
            `Décision reprise du tableau de veille « ${options.nom} », ligne ${ligne.ligne}` +
            (ligne.commentaire ? ` : ${ligne.commentaire}` : "."),
          sansLots: true,
          userId: options.userId,
        });
        if (issue.ok) {
          decisionsAppliquees += 1;
          precisions.push(`${ligne.decision === "GO" ? "GO" : "NO GO"} repris du tableau.`);
        } else {
          precisions.push(`Décision non reprise : ${issue.message}`);
        }
      } else if (ligne.decision === "GO" && options.reprise !== "toutes") {
        precisions.push(
          "GO lu dans le tableau, non repris : un GO crée l'espace de réponse et demande le retrait du dossier. À poser depuis la fiche.",
        );
      }

      creees += 1;
      rapport.push({
        ...base,
        etat: "creee",
        reference: affaire.reference,
        message: "Affaire créée.",
        precisions,
      });
    } catch (erreur) {
      console.error("[import-tableau] ligne", ligne.ligne, erreur);
      rapport.push({
        ...base,
        etat: "echec",
        reference: null,
        message: "La création a échoué. Consultez le journal du serveur.",
      });
    }
  }

  const compte = {
    total: rapport.length,
    creees,
    dejaPresentes: rapport.filter((l) => l.etat === "deja-presente").length,
    doublonsFichier: rapport.filter((l) => l.etat === "doublon-fichier").length,
    incompletes: rapport.filter((l) => l.etat === "incomplete").length,
    nonTraitees: rapport.filter((l) => l.etat === "non-traitee").length,
    echecs: rapport.filter((l) => l.etat === "echec").length,
    decisions: decisionsAppliquees,
  };

  if (options.appliquer) {
    await recordAudit({
      action: "veille.import",
      entity: "Tender",
      entityId: "import",
      userId: options.userId,
      summary:
        `Import du tableau « ${options.nom} » (feuille « ${lecture.feuille} ») : ` +
        `${compte.creees} affaire(s) créée(s), ${compte.dejaPresentes} déjà présente(s), ` +
        `${compte.incompletes} ligne(s) incomplète(s), ${compte.decisions} décision(s) reprise(s).`,
      payload: {
        colonnes: intitules,
        inconnues,
        reprise: options.reprise,
        lignes: rapport.map((l) => ({ ligne: l.ligne, etat: l.etat, reference: l.reference })),
      },
    });
  }

  return {
    fichier: options.nom,
    feuille: lecture.feuille,
    colonnes: Object.entries(intitules).map(([champ, intitule]) => ({
      champ: LIBELLE_CHAMP[champ] ?? champ,
      intitule,
    })),
    inconnues,
    applique: options.appliquer,
    reprise: options.reprise,
    lignes: rapport,
    compte,
  };
}
