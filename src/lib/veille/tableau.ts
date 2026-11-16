/**
 * Lecture d'un tableau de veille tenu à la main.
 *
 * Avant cette plateforme, la veille vivait dans un classeur. Ce classeur
 * existe toujours, il continue de se remplir, et personne ne va ressaisir
 * deux cents lignes dans un formulaire. Ce module lit ce genre de tableau.
 *
 * Il ne suppose rien de sa forme. Les en-têtes ne sont pas à la première
 * ligne — il y a presque toujours un titre au-dessus —, ils ne sont pas
 * nommés comme ici, ils ne sont pas tous là, et il y en a d'autres qui ne
 * nous concernent pas. Ce qui est reconnu est repris ; le reste est signalé,
 * jamais devin, jamais complété.
 *
 * Module pur : aucune base, aucun réseau, aucun `xlsx`. Il reçoit une matrice
 * de cellules et rend des lignes. C'est ce qui permet de l'éprouver sur des
 * cas tordus sans ouvrir un classeur.
 */

export type Cellule = string | number | boolean | Date | null | undefined;

/**
 * Intitulé réduit à sa substance : sans accent, sans ponctuation, en
 * minuscules, espaces resserrés. « N° Consultation » et « n. consultation »
 * doivent se rejoindre.
 */
export function normaliserEntete(valeur: Cellule): string {
  if (valeur === null || valeur === undefined) return "";
  return String(valeur)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Synonymes acceptés pour chaque champ.
 *
 * Reconnaissance par inclusion, du plus spécifique au plus général : « date de
 * remise des plis » doit l'emporter sur « date », et « lien dce » sur « lien ».
 * L'ordre des entrées dans chaque liste n'importe pas, mais l'ordre des champs
 * compte, parce qu'une colonne n'est attribuée qu'une fois.
 */
const SYNONYMES = {
  remiseAt: [
    "date de remise des plis", "date remise des plis", "remise des plis", "date limite de remise",
    "date limite de reception", "date limite", "date de cloture", "cloture", "echeance",
    "date butoir", "deadline",
  ],
  publieAt: [
    "date de publication", "date publication", "date de parution", "publication", "publie le",
    "parution", "date de mise en ligne",
  ],
  montant: [
    "montant estime", "montant maximum", "montant maxi", "montant du marche", "montant",
    "estimation", "budget", "valeur estimee", "valeur du marche", "enveloppe",
  ],
  acheteur: [
    "acheteur", "client", "pouvoir adjudicateur", "organisme", "entite adjudicatrice",
    "maitre d ouvrage", "donneur d ordre", "etablissement", "beneficiaire",
  ],
  lienDce: [
    "lien dce", "lien du dce", "url dce", "dce", "retrait du dossier", "telechargement du dossier",
    "lien de telechargement",
  ],
  lienDepot: ["lien de depot", "adresse de depot", "depot des plis", "lieu de depot"],
  lien: [
    "lien de l avis", "lien avis", "lien de la consultation", "lien", "url", "adresse",
    "source", "site", "plateforme",
  ],
  reference: [
    "reference de consultation", "reference consultation", "numero de consultation",
    "n consultation", "numero d avis", "reference", "ref", "numero", "id",
  ],
  objet: [
    "objet du marche", "objet de la consultation", "objet", "intitule du marche", "intitule",
    "titre", "libelle", "designation", "marche", "consultation", "appel d offres",
  ],
  resume: ["description", "resume", "detail", "objet detaille", "perimetre"],
  procedure: ["type de procedure", "procedure", "type de marche", "forme du marche"],
  region: ["region", "departement", "lieu d execution", "lieu", "localisation", "territoire", "ville"],
  cpv: ["codes cpv", "code cpv", "cpv"],
  lots: ["lots", "nombre de lots", "allotissement", "lot"],
  decision: ["go no go", "go nogo", "decision", "arbitrage", "avis", "statut", "suite a donner"],
  commentaire: ["commentaire", "observation", "remarque", "note", "notes"],
} as const;

export type ChampTableau = keyof typeof SYNONYMES;

/** Ordre de résolution : le champ le plus spécifique réclame sa colonne d'abord. */
const ORDRE: ChampTableau[] = [
  "remiseAt", "publieAt", "montant", "acheteur", "lienDce", "lienDepot", "lien", "reference",
  "objet", "resume", "procedure", "region", "cpv", "lots", "decision", "commentaire",
];

export type Entetes = {
  /** Colonne retenue pour chaque champ reconnu. */
  colonnes: Partial<Record<ChampTableau, number>>;
  /** Intitulé réel de la colonne retenue, pour le dire à qui importe. */
  intitules: Partial<Record<ChampTableau, string>>;
  /** Colonnes non reconnues : signalées, jamais devinées. */
  inconnues: string[];
};

/**
 * Attribution des colonnes d'une ligne d'en-têtes.
 *
 * Un même synonyme peut correspondre à deux colonnes (« date » et « date de
 * publication ») : c'est la correspondance la plus longue qui gagne, et une
 * colonne déjà prise n'est pas réattribuée.
 */
export function reconnaitreEntetes(ligne: Cellule[]): Entetes {
  const normalisees = ligne.map(normaliserEntete);
  const colonnes: Partial<Record<ChampTableau, number>> = {};
  const intitules: Partial<Record<ChampTableau, string>> = {};
  const prises = new Set<number>();

  for (const champ of ORDRE) {
    let meilleure: { index: number; longueur: number } | null = null;
    for (const [index, entete] of normalisees.entries()) {
      if (!entete || prises.has(index)) continue;
      for (const synonyme of SYNONYMES[champ]) {
        if (!entete.includes(synonyme)) continue;
        if (!meilleure || synonyme.length > meilleure.longueur) {
          meilleure = { index, longueur: synonyme.length };
        }
      }
    }
    if (meilleure) {
      colonnes[champ] = meilleure.index;
      intitules[champ] = String(ligne[meilleure.index] ?? "").trim();
      prises.add(meilleure.index);
    }
  }

  const inconnues = normalisees
    .map((entete, index) => ({ entete, index }))
    .filter(({ entete, index }) => entete.length > 0 && !prises.has(index))
    .map(({ index }) => String(ligne[index] ?? "").trim());

  return { colonnes, intitules, inconnues };
}

/**
 * Repérage de la ligne d'en-têtes.
 *
 * Elle n'est presque jamais la première : un tableau tenu à la main commence
 * par un titre, parfois une date d'édition, parfois une ligne vide. On prend
 * donc la ligne des dix premières qui reconnaît le plus de champs, à condition
 * d'en reconnaître au moins deux — en dessous, ce n'est pas un en-tête, c'est
 * une coïncidence.
 */
export function trouverEntetes(matrice: Cellule[][]): { index: number; entetes: Entetes } | null {
  let meilleur: { index: number; entetes: Entetes; score: number } | null = null;
  for (const [index, ligne] of matrice.slice(0, 10).entries()) {
    const entetes = reconnaitreEntetes(ligne);
    const score = Object.keys(entetes.colonnes).length;
    if (score >= 2 && (!meilleur || score > meilleur.score)) meilleur = { index, entetes, score };
  }
  return meilleur ? { index: meilleur.index, entetes: meilleur.entetes } : null;
}

// ---------------------------------------------------------------------------
// Lecture des valeurs
// ---------------------------------------------------------------------------

const MOIS: Record<string, number> = {
  janvier: 0, janv: 0, jan: 0, fevrier: 1, fevr: 1, fev: 1, mars: 2, mar: 2,
  avril: 3, avr: 3, mai: 4, juin: 5, juillet: 6, juil: 6, aout: 7,
  septembre: 8, sept: 8, sep: 8, octobre: 9, oct: 9, novembre: 10, nov: 10,
  decembre: 11, dec: 11,
};

/** Date valide à midi UTC, pour qu'aucun fuseau ne la fasse changer de jour. */
function composer(annee: number, mois: number, jour: number, heure = 12, minute = 0): Date | null {
  if (mois < 0 || mois > 11 || jour < 1 || jour > 31) return null;
  if (annee < 100) annee += annee < 70 ? 2000 : 1900;
  if (annee < 1990 || annee > 2100) return null;
  const date = new Date(Date.UTC(annee, mois, jour, heure, minute));
  // Le 31 février se replie sur mars : la date composée doit redonner le jour
  // demandé, sinon la cellule ne portait pas une date.
  if (date.getUTCDate() !== jour || date.getUTCMonth() !== mois) return null;
  return date;
}

/**
 * Date d'une cellule.
 *
 * Les jours et les mois se lisent à la française — 03/12/2026 est le 3
 * décembre. C'est l'usage de ces tableaux, et une convention affichée vaut
 * mieux qu'une heuristique qui se trompe une fois sur douze.
 */
export function lireDate(valeur: Cellule): Date | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;

  if (typeof valeur === "number") {
    // Numéro de série Excel, borné à des dates plausibles : 2026 tout seul est
    // une année, pas un 18 juillet 1905.
    if (valeur < 20_000 || valeur > 80_000) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(valeur) * 86_400_000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const texte = String(valeur).trim();
  if (!texte) return null;

  // 2026-03-12, éventuellement suivi d'une heure.
  const iso = texte.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    return composer(
      Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]),
      iso[4] ? Number(iso[4]) : 12, iso[5] ? Number(iso[5]) : 0,
    );
  }

  // 12/03/2026, 12-03-26, 12.03.2026, éventuellement suivi d'une heure.
  const fr = texte.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2,4})(?:[T ,]+(?:a )?(\d{1,2})[h:](\d{2})?)?/);
  if (fr) {
    return composer(
      Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]),
      fr[4] ? Number(fr[4]) : 12, fr[5] ? Number(fr[5]) : 0,
    );
  }

  // 12 mars 2026, 3 déc. 2026.
  const lettres = texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/^(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{2,4})/);
  if (lettres && lettres[2] in MOIS) {
    return composer(Number(lettres[3]), MOIS[lettres[2]], Number(lettres[1]));
  }

  return null;
}

export type MontantLu = {
  valeur: number;
  /** Lecture explicitée quand elle ne va pas de soi, pour la montrer au lecteur. */
  interpretation: string | null;
};

/**
 * Montant d'une cellule, en euros.
 *
 * Les abréviations d'échelle (« 80 k€ », « 1,2 M€ ») sont acceptées parce
 * qu'elles sont sans ambiguïté et très répandues dans ces tableaux ; la
 * lecture retenue est alors rendue au lecteur, qui peut la démentir. Tout ce
 * qui reste douteux — une fourchette, un « selon besoin », un montant par an
 * sans durée — n'est pas lu : une absence de montant vaut mieux qu'un montant
 * inventé.
 */
export function lireMontant(valeur: Cellule): MontantLu | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) && valeur > 0 ? { valeur, interpretation: null } : null;
  }

  let texte = String(valeur)
    .replace(/ | /g, " ")
    .trim()
    .toLowerCase();
  if (!texte || /^(?:n\/?a|nc|non communique|non communiqué|\?|-|—)$/.test(texte)) return null;

  // Une fourchette n'est pas un montant : « 50 000 à 80 000 » demande un
  // arbitrage que personne ne nous a délégué.
  if (/\d\s*(?:a|à|-|–|et)\s*\d{2}/.test(texte.replace(/\s/g, " "))) {
    const bornes = texte.match(/(\d[\d  .,]*)\s*(?:a|à|-|–|et)\s*(\d[\d  .,]*)/);
    if (bornes) return null;
  }

  let echelle = 1;
  const suffixe = texte.match(/(\d)\s*(k|m)\s*(?:€|eur|euros)?\b/);
  if (suffixe) {
    echelle = suffixe[2] === "k" ? 1_000 : 1_000_000;
    texte = texte.replace(/\s*(k|m)\s*(?=€|eur|euros|$)/, "");
  }

  const brut = texte.match(/-?\d[\d  .,]*/);
  if (!brut) return null;
  let nombre = brut[0].replace(/[  ]/g, "");

  // Séparateurs : la virgule décimale française, et le point qui groupe les
  // milliers. « 1.200.000 » n'est pas mille deux cents.
  if (nombre.includes(",")) {
    nombre = nombre.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{3}(?:\D|$)/.test(nombre) || /\.\d{3}$/.test(nombre)) {
    nombre = nombre.replace(/\./g, "");
  }

  const montant = Number.parseFloat(nombre) * echelle;
  if (!Number.isFinite(montant) || montant <= 0) return null;

  return {
    valeur: Math.round(montant * 100) / 100,
    interpretation: echelle > 1 ? `« ${String(valeur).trim()} » lu ${montant.toLocaleString("fr-FR")} €` : null,
  };
}

/** Décision portée par une colonne de tri. « no go » avant « go ». */
export function lireDecision(valeur: Cellule): "GO" | "NO_GO" | "A_DECIDER" | null {
  const texte = normaliserEntete(valeur);
  if (!texte) return null;
  if (/\bno\s*go\b|\bnogo\b|\bnon\b|\babandon|\becarte|\brefus/.test(texte)) return "NO_GO";
  if (/\bgo\b|\boui\b|\bretenu|\ba repondre\b/.test(texte)) return "GO";
  if (/arbitr|en cours|a etudier|a voir|a decider|attente|\?/.test(texte)) return "A_DECIDER";
  return null;
}

function texteDe(valeur: Cellule): string | null {
  if (valeur === null || valeur === undefined) return null;
  const texte = String(valeur).replace(/\s+/g, " ").trim();
  return texte.length > 0 ? texte : null;
}

function lienDe(valeur: Cellule): string | null {
  const texte = texteDe(valeur);
  if (!texte) return null;
  // Un lien peut arriver avec son libellé, ou dans une phrase.
  const trouve = texte.match(/https?:\/\/\S+/);
  const lien = trouve ? trouve[0] : texte.startsWith("www.") ? `https://${texte}` : null;
  return lien ? lien.replace(/[),.;]+$/, "") : null;
}

export type LigneTableau = {
  /** Numéro de ligne dans le classeur, tel que le tableur l'affiche. */
  ligne: number;
  objet: string | null;
  acheteur: string | null;
  reference: string | null;
  resume: string | null;
  procedure: string | null;
  region: string | null;
  cpv: string[];
  lien: string | null;
  lienDce: string | null;
  lienDepot: string | null;
  publieAt: Date | null;
  remiseAt: Date | null;
  montant: MontantLu | null;
  decision: "GO" | "NO_GO" | "A_DECIDER" | null;
  commentaire: string | null;
  /** Vrai si la ligne ne porte rien du tout : elle sera passée sans bruit. */
  vide: boolean;
};

/** Lignes de données, à partir de la ligne qui suit les en-têtes. */
export function lireLignes(
  matrice: Cellule[][],
  entetes: Entetes,
  indexEntete: number,
): LigneTableau[] {
  const { colonnes } = entetes;
  const cellule = (ligne: Cellule[], champ: ChampTableau): Cellule => {
    const index = colonnes[champ];
    return index === undefined ? null : ligne[index];
  };

  return matrice.slice(indexEntete + 1).map((ligne, decalage) => {
    const cpv = texteDe(cellule(ligne, "cpv"));
    const lu: LigneTableau = {
      ligne: indexEntete + decalage + 2,
      objet: texteDe(cellule(ligne, "objet")),
      acheteur: texteDe(cellule(ligne, "acheteur")),
      reference: texteDe(cellule(ligne, "reference")),
      resume: texteDe(cellule(ligne, "resume")),
      procedure: texteDe(cellule(ligne, "procedure")),
      region: texteDe(cellule(ligne, "region")),
      cpv: cpv ? cpv.split(/[\s,;]+/).filter((code) => /^\d{6,8}$/.test(code)) : [],
      lien: lienDe(cellule(ligne, "lien")),
      lienDce: lienDe(cellule(ligne, "lienDce")),
      lienDepot: lienDe(cellule(ligne, "lienDepot")),
      publieAt: lireDate(cellule(ligne, "publieAt")),
      remiseAt: lireDate(cellule(ligne, "remiseAt")),
      montant: lireMontant(cellule(ligne, "montant")),
      decision: lireDecision(cellule(ligne, "decision")),
      commentaire: texteDe(cellule(ligne, "commentaire")),
      vide: false,
    };
    lu.vide = ligne.every((valeur) => texteDe(valeur) === null);
    return lu;
  });
}
