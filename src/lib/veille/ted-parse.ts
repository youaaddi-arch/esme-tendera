import type { AmountKind } from "@prisma/client";

import type { NormalizedNotice } from "./types";

/**
 * Lecture des avis TED — fonctions pures.
 *
 * TED est le supplément au Journal officiel de l'Union européenne : il publie
 * les marchés au-dessus des seuils européens. C'est la source qui manquait au
 * BOAMP, et elle n'est pas redondante avec lui : un accord-cadre de formation
 * de plusieurs millions d'euros peut n'y figurer qu'au JOUE.
 *
 * L'API v3 renvoie des champs multilingues de deux formes selon le champ :
 * `{"fra": "texte"}` pour ce qui est unique dans l'avis, `{"fra": ["a", "b"]}`
 * pour ce qui est répété par lot. Les deux sont lus par la même fonction.
 *
 * Aucun accès réseau ici : le connecteur s'en charge, ce module se teste seul.
 */

/** Champ multilingue tel que l'API le renvoie. */
type Multilingual = Record<string, string | string[]> | string | string[] | null | undefined;

export type TedRecord = Record<string, unknown>;

/**
 * Langues retenues, par ordre de préférence.
 *
 * Le français d'abord : les avis d'acheteurs français y sont rédigés, et c'est
 * la langue de l'application. L'anglais sert de secours pour les avis
 * d'organismes européens implantés en France.
 */
const LANGUES = ["fra", "FRA", "eng", "ENG"];

/** Premier texte lisible d'un champ multilingue. */
export function pickText(value: Multilingual): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return first ? first.trim() : null;
  }

  for (const langue of LANGUES) {
    const texte = value[langue];
    if (typeof texte === "string" && texte.trim()) return texte.trim();
    if (Array.isArray(texte)) {
      const first = texte.find((item) => typeof item === "string" && item.trim());
      if (first) return first.trim();
    }
  }

  // Langue non prévue : on prend ce qui existe plutôt que de perdre l'avis.
  for (const texte of Object.values(value)) {
    if (typeof texte === "string" && texte.trim()) return texte.trim();
    if (Array.isArray(texte)) {
      const first = texte.find((item) => typeof item === "string" && item.trim());
      if (first) return first.trim();
    }
  }
  return null;
}

/** Toutes les valeurs d'un champ répété par lot, dans l'ordre. */
export function pickList(value: Multilingual): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));

  for (const langue of LANGUES) {
    const texte = value[langue];
    if (Array.isArray(texte)) return texte.filter((item) => typeof item === "string" && item.trim());
    if (typeof texte === "string" && texte.trim()) return [texte.trim()];
  }
  return [];
}

/**
 * Date TED.
 *
 * Le format porte son décalage horaire : « 2026-10-14+02:00 ». Une date sans
 * heure est ancrée à midi UTC, pour qu'aucune conversion de fuseau ne la fasse
 * basculer sur la veille — une date limite affichée un jour trop tôt ferait
 * manquer un dépôt.
 */
export function parseTedDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateSeule = /^(\d{4}-\d{2}-\d{2})(?:([+-]\d{2}:\d{2})|Z)?$/.exec(trimmed);
  const normalise = dateSeule ? `${dateSeule[1]}T12:00:00Z` : trimmed;

  const date = new Date(normalise);
  if (Number.isNaN(date.getTime())) return null;
  // Garde-fou contre les dates sentinelles de certains avis.
  if (date.getUTCFullYear() < 2005) return null;
  return date;
}

/**
 * Types d'avis qui ne sont pas un appel à concurrence.
 *
 * Les préfixes suivent la nomenclature eForms : `can-` pour les attributions,
 * `pin-` pour les avis de préinformation — utiles à connaître mais sans date
 * limite ni dossier —, `veat` pour les transparences ex-ante volontaires.
 * Les importer créerait des affaires sur lesquelles il n'y a rien à déposer.
 */
export function isAppelAConcurrence(noticeType: unknown): boolean {
  if (typeof noticeType !== "string") return false;
  const type = noticeType.trim().toLowerCase();
  if (!type) return false;
  return type.startsWith("cn-") || type === "cn" || type === "subco";
}

/** Lien vers la page de l'avis, en français de préférence. */
export function pickLink(links: unknown): string | null {
  if (!links || typeof links !== "object") return null;
  const groupes = links as Record<string, Record<string, string> | undefined>;
  for (const groupe of ["html", "htmlDirect", "pdfs", "pdf"]) {
    const valeurs = groupes[groupe];
    if (!valeurs) continue;
    for (const langue of ["FRA", "ENG"]) {
      const lien = valeurs[langue];
      if (typeof lien === "string" && lien.startsWith("http")) return lien;
    }
  }
  return null;
}

/**
 * Requête d'interrogation, en langage expert TED.
 *
 * Trois filtres :
 *
 *  - la division CPV 80 — « services d'enseignement et de formation ». TED
 *    traite ce code comme une racine : un avis classé 80530000 est retenu ;
 *  - le pays de l'acheteur, pour ne pas ramener toute l'Union ;
 *  - la fenêtre de publication, et le type d'avis.
 *
 * Le filtrage par type se fait côté serveur plutôt qu'après réception : sur
 * cette source les attributions sont nombreuses, et les rapatrier pour les
 * jeter consommerait la pagination sans rien apporter.
 */
export function buildTedQuery(options: {
  lookbackDays: number;
  cpvRoot?: string;
  country?: string;
}): string {
  // Une valeur absente, nulle ou négative vaut « non renseigné », et retombe
  // sur trente jours. Elle ne vaut surtout pas un jour : une fenêtre d'un jour
  // rétrécirait la veille sans que personne s'en aperçoive, ce qui est le
  // genre de panne silencieuse qu'on ne découvre qu'en ratant un marché.
  const demande = Number.isFinite(options.lookbackDays) && options.lookbackDays > 0
    ? Math.round(options.lookbackDays)
    : 30;
  const jours = Math.min(demande, 365);
  const cpv = options.cpvRoot ?? "80000000";
  const pays = options.country ?? "FRA";
  return [
    `classification-cpv IN (${cpv})`,
    `buyer-country=${pays}`,
    `publication-date>=today(-${jours})`,
    "notice-type IN (cn-standard cn-social cn-desg)",
  ].join(" AND ");
}

/** Champs demandés à l'API. Un champ inconnu fait échouer toute la requête. */
export const TED_FIELDS = [
  "publication-number",
  "title-proc",
  "description-proc",
  "organisation-name-buyer",
  "publication-date",
  "deadline-receipt-tender-date-lot",
  "classification-cpv",
  "notice-type",
  "procedure-type",
  "total-value",
  "title-lot",
  "description-lot",
  "links",
] as const;

/**
 * Date limite retenue parmi celles des lots.
 *
 * TED publie une échéance par lot. Lorsqu'elles diffèrent, c'est la plus
 * proche qui engage : la manquer ferme la porte sur ce lot, même si les autres
 * restent ouverts. On retient donc la plus précoce, et la fiche détaille les
 * lots.
 */
export function pickDeadline(values: unknown): Date | null {
  const liste = Array.isArray(values) ? values : [values];
  const dates = liste
    .map((value) => parseTedDate(value))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

/**
 * Convertit un enregistrement TED en avis normalisé.
 *
 * Renvoie `null` quand l'avis n'est pas exploitable : pas d'identifiant, pas
 * d'objet, ou type d'avis qui n'appelle pas d'offre. Mieux vaut écarter un
 * avis que créer une affaire vide.
 */
export function normalizeTedNotice(record: TedRecord): NormalizedNotice | null {
  const numero = typeof record["publication-number"] === "string" ? record["publication-number"].trim() : "";
  if (!numero) return null;

  if (!isAppelAConcurrence(record["notice-type"])) return null;

  const title = pickText(record["title-proc"] as Multilingual);
  if (!title) return null;

  const buyer = pickText(record["organisation-name-buyer"] as Multilingual) ?? "Acheteur non précisé";

  const cpvBruts = Array.isArray(record["classification-cpv"]) ? record["classification-cpv"] : [];
  const cpvCodes = [...new Set(cpvBruts.filter((code): code is string => typeof code === "string" && Boolean(code.trim())))];

  const valeur = record["total-value"];
  const montant = typeof valeur === "number" && Number.isFinite(valeur) && valeur > 0 ? valeur : null;

  // Les intitulés et descriptions de lots arrivent en deux listes parallèles,
  // appariées par position. Une description sans intitulé reste un lot : on
  // parcourt donc la plus longue des deux.
  const titresLots = pickList(record["title-lot"] as Multilingual);
  const descriptionsLots = pickList(record["description-lot"] as Multilingual);
  const nombreLots = Math.max(titresLots.length, descriptionsLots.length);
  const lots: NormalizedNotice["lots"] = [];
  for (let index = 0; index < nombreLots; index += 1) {
    const intitule = titresLots[index] ?? descriptionsLots[index];
    if (!intitule) continue;
    lots.push({
      number: String(index + 1),
      title: intitule.slice(0, 500),
      description: descriptionsLots[index] ?? null,
      cpvCodes: [],
    });
  }

  const amountKind: AmountKind = montant === null ? "NON_COMMUNIQUE" : "ESTIME";

  return {
    sourceNoticeId: `TED-${numero}`,
    title: title.slice(0, 500),
    buyer: buyer.slice(0, 300),
    consultationRef: numero,
    objectSummary: pickText(record["description-proc"] as Multilingual),
    procedure: typeof record["procedure-type"] === "string" ? record["procedure-type"] : null,
    cpvCodes,
    // TED ne publie pas la nature du marché parmi ces champs. Le filtre CPV 80
    // porte déjà cette information : laisser la liste vide évite d'affirmer
    // une nature qu'on n'a pas lue.
    marketTypes: [],
    publishedAt: parseTedDate(record["publication-date"]),
    deadlineAt: pickDeadline(record["deadline-receipt-tender-date-lot"]),
    amountKind,
    amountMinEur: null,
    amountMaxEur: montant,
    amountNote: montant === null ? null : "Valeur totale estimée publiée au JOUE.",
    sourceUrl: pickLink(record["links"]),
    lots,
    noticeType: typeof record["notice-type"] === "string" ? record["notice-type"] : null,
    raw: record,
  };
}
