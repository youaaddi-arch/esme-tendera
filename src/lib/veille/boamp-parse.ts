import type { AmountKind } from "@prisma/client";

import type { FetchOptions, NormalizedNotice } from "./types";

/**
 * Lecture des avis du BOAMP — fonctions pures.
 *
 * Isolées du connecteur pour être testables hors du contexte Next : elles ne
 * font aucun accès réseau.
 *
 * Le jeu de données expose deux niveaux d'information :
 *
 *  - des **colonnes plates** fiables et toujours présentes : `idweb`, `objet`,
 *    `nomacheteur`, `dateparution`, `datelimitereponse`, `type_procedure`,
 *    `famille`, `etat`, `url_avis`, `annonce_lie`… ;
 *  - une colonne **`donnees`** qui contient l'avis complet, dans deux formats
 *    incompatibles selon son origine : eForms/UBL pour les avis européens,
 *    structure historique du BOAMP pour les avis nationaux.
 *
 * On lit les colonnes plates nommément, et on explore `donnees` par parcours
 * générique : chercher les chemins exacts des deux formats reviendrait à
 * maintenir deux schémas complets, alors qu'on ne cherche que quelques
 * informations bien identifiables (CPV, lots, date limite, montant).
 *
 * Le jeu de données **ne contient pas de colonne `code_cpv`** : filtrer dessus
 * fait échouer la requête. Les CPV ne se trouvent que dans `donnees`.
 */

type OdsRecord = Record<string, unknown>;

/** Première valeur non vide parmi plusieurs colonnes possibles. */
export function first(record: OdsRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    // Plusieurs colonnes du BOAMP sont des tableaux (`type_marche`,
    // `code_departement`, `descripteur_libelle`).
    if (Array.isArray(value) && value.length > 0) {
      const flat = value.filter((item) => typeof item === "string" && item.trim());
      if (flat.length > 0) return flat.join(", ");
    }
  }
  return null;
}

/**
 * Lecture d'une date.
 *
 * Les avis eForms écrivent les dates au format `2026-11-18+01:00` : une date
 * sans heure, suivie d'un décalage horaire. `new Date()` ne sait pas lire
 * cette forme et renvoie une date invalide, ce qui faisait perdre toutes les
 * dates limites des avis européens. On insère l'heure manquante.
 */
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Une valeur sans heure désigne un jour de calendrier, pas un instant.
  // L'ancrer à minuit dans son fuseau la ferait basculer à la veille une fois
  // convertie en UTC — et une date limite affichée un jour trop tôt est une
  // erreur, même « prudente ». Midi UTC garde le même jour sous tous les
  // fuseaux utiles.
  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:[+-]\d{2}:\d{2}|Z)?$/.exec(trimmed);
  const normalized = dateOnly ? `${dateOnly[1]}T12:00:00Z` : trimmed;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  // Les avis d'attribution portent parfois une date sentinelle (2000-01-01) :
  // elle ne doit pas être prise pour une échéance réelle.
  if (date.getUTCFullYear() < 2005) return null;
  return date;
}

/** Les montants arrivent en texte libre : « 180 000 € HT », « 1,2 M€ ». */
export function parseAmount(value: string | null): {
  min: number | null;
  max: number | null;
  kind: AmountKind;
  note: string | null;
} {
  if (!value) return { min: null, max: null, kind: "NON_COMMUNIQUE", note: null };

  const normalized = value.replace(/ /g, " ").toLowerCase();
  const numbers: number[] = [];
  const pattern = /(\d[\d .,]*)\s*(m€|millions?|k€|€|euros?)?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const rawNumber = match[1].replace(/[ .]/g, "").replace(",", ".");
    const parsed = Number.parseFloat(rawNumber);
    if (!Number.isFinite(parsed)) continue;
    const unit = match[2] ?? "";
    const multiplier = unit.startsWith("m") ? 1_000_000 : unit.startsWith("k") ? 1_000 : 1;
    const amount = parsed * multiplier;
    // En dessous de 100 €, on est face à un numéro de lot ou à une durée.
    if (amount >= 100) numbers.push(amount);
  }

  if (numbers.length === 0) return { min: null, max: null, kind: "NON_COMMUNIQUE", note: value };

  const isMax = /maximum|maximal|plafond/.test(normalized);
  const isEstimate = /estim|prévisionnel|previsionnel|environ/.test(normalized);
  const kind: AmountKind = isMax ? "MAXIMUM" : isEstimate ? "ESTIME" : "GLOBAL";

  if (numbers.length === 1) {
    return { min: isMax ? null : numbers[0], max: numbers[0], kind, note: value };
  }
  return {
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    kind: isMax ? "MAXIMUM" : "ESTIME",
    note: value,
  };
}

// ---------------------------------------------------------------------------
// Exploration de la colonne « donnees »
// ---------------------------------------------------------------------------

type Visitor = (key: string, value: unknown, path: string[]) => void;

/** Parcours en profondeur, borné : un avis eForms peut être très profond. */
function walk(node: unknown, visit: Visitor, path: string[] = [], depth = 0): void {
  if (depth > 14 || node === null || node === undefined) return;
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

/** Valeur texte d'un nœud, qu'il soit une chaîne ou un objet eForms `{"#text": …}`. */
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

const CPV_PATTERN = /^\d{8}(-\d)?$/;

/** Codes CPV trouvés dans l'avis complet. */
export function extractCpvFromDonnees(donnees: unknown): string[] {
  const codes = new Set<string>();
  walk(donnees, (key, value) => {
    // eForms : `cbc:ItemClassificationCode`. BOAMP historique : clés contenant « cpv ».
    if (!/cpv|classificationcode|classification_code/i.test(key)) return;
    const text = textOf(value);
    if (text && CPV_PATTERN.test(text)) codes.add(text.slice(0, 8));
    if (Array.isArray(value)) {
      for (const item of value) {
        const itemText = textOf(item);
        if (itemText && CPV_PATTERN.test(itemText)) codes.add(itemText.slice(0, 8));
      }
    }
  });
  return [...codes];
}

/**
 * Date limite de réponse, cherchée dans l'avis complet.
 *
 * Un avis eForms contient plusieurs dates de fin, et elles ne veulent pas du
 * tout dire la même chose : fin d'exécution du marché
 * (`PlannedPeriod`, parfois des années plus tard), fin de la période de
 * questions (`AdditionalInformationRequestPeriod`), remise des offres
 * (`TenderSubmissionDeadlinePeriod`) ou, en procédure restreinte, remise des
 * candidatures (`ParticipationRequestReceptionPeriod`).
 *
 * On ne prend donc ni la première ni la dernière, mais celle dont le conteneur
 * désigne une échéance de réponse — et à défaut, rien.
 */
export function extractDeadlineFromDonnees(donnees: unknown): Date | null {
  // Du plus fiable au moins fiable.
  const containers = [
    /TenderSubmissionDeadlinePeriod/i,
    /ParticipationRequestReceptionPeriod/i,
    /datelimite|date_limite|dlro/i,
  ];
  const found: (Date | null)[] = containers.map(() => null);

  walk(donnees, (key, value, path) => {
    const text = textOf(value);
    const parsed = parseDate(text);
    if (!parsed) return;

    const trail = [...path, key].join("/");
    for (const [rank, container] of containers.entries()) {
      if (found[rank]) continue;
      if (!container.test(trail)) continue;
      // Dans un conteneur de période, seule la fin nous intéresse.
      if (/StartDate|StartTime|IssueDate/i.test(key)) continue;
      found[rank] = parsed;
    }
  });

  return found.find((date): date is Date => date !== null) ?? null;
}

/**
 * Vrai pour un avis d'attribution ou de résultat.
 *
 * Ces avis annoncent un marché déjà attribué : ils n'ouvrent aucune
 * consultation et n'ont pas de date limite. Les importer comme des
 * opportunités donnerait un portefeuille faux.
 */
export function isAwardNotice(record: OdsRecord): boolean {
  const nature = `${first(record, ["nature"]) ?? ""} ${first(record, ["nature_libelle"]) ?? ""} ${first(record, ["sousnature_libelle"]) ?? ""}`;
  if (/attribution|résultat|resultat|attribu/i.test(nature)) return true;

  const donnees = parseDonnees(record["donnees"]);
  if (donnees && typeof donnees === "object") {
    const eforms = (donnees as Record<string, unknown>)["EFORMS"];
    if (eforms && typeof eforms === "object") {
      return Object.keys(eforms).some((key) => /ContractAwardNotice|ResultNotice/i.test(key));
    }
  }
  return false;
}

/** Montant estimé, cherché dans l'avis complet. */
export function extractAmountFromDonnees(donnees: unknown): ReturnType<typeof parseAmount> {
  let candidate: string | null = null;
  walk(donnees, (key, value) => {
    if (candidate) return;
    if (!/estimatedoverallcontractamount|valeur_totale|valeurtotale|montant|estimatedvalue/i.test(key)) return;
    const text = textOf(value);
    if (text && /\d/.test(text)) candidate = text;
  });
  return parseAmount(candidate);
}

/**
 * Lots de la consultation.
 *
 * eForms : `cac:ProcurementProjectLot`, chacun avec son `cbc:ID` et son
 * `cac:ProcurementProject/cbc:Name`. BOAMP historique : des clés « LOT ».
 * Faute de lot identifiable, on renvoie une liste vide plutôt qu'un lot
 * inventé — l'affaire reste alors non allotie jusqu'à lecture du DCE.
 */
export function extractLotsFromDonnees(donnees: unknown): NormalizedNotice["lots"] {
  const lots: NormalizedNotice["lots"] = [];
  const seen = new Set<string>();

  walk(donnees, (key, value) => {
    if (!/^(cac:ProcurementProjectLot|LOT|LOTS|lot)$/i.test(key)) return;
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;

      // Les champs sont collectés dans un objet plutôt que dans des variables
      // locales : TypeScript ne peut pas suivre une affectation faite depuis
      // une closure passée à `walk`.
      const found: { number?: string; title?: string; description?: string } = {};

      walk(record, (innerKey, innerValue) => {
        const text = textOf(innerValue);
        if (!text) return;
        if (!found.number && /^(cbc:ID|NUM|NUMERO|numero|id)$/i.test(innerKey)) found.number = text;
        if (!found.title && /^(cbc:Name|INTITULE|TITRE|intitule|titre|libelle)$/i.test(innerKey) && text.length > 2) {
          found.title = text;
        }
        if (!found.description && /^(cbc:Description|DESCRIPTION|description|objet)$/i.test(innerKey) && text.length > 5) {
          found.description = text;
        }
      });

      const label = found.title ?? found.description;
      if (!label) continue;
      const lotNumber = found.number ?? String(lots.length + 1);
      const key2 = `${lotNumber}|${label}`.toLowerCase();
      if (seen.has(key2)) continue;
      seen.add(key2);

      lots.push({
        number: lotNumber.slice(0, 20),
        title: label.slice(0, 300),
        description:
          found.description && found.description !== label ? found.description.slice(0, 1000) : null,
      });
      if (lots.length >= 40) return;
    }
  });

  return lots;
}

// ---------------------------------------------------------------------------
// Normalisation d'un enregistrement
// ---------------------------------------------------------------------------

/** Vrai pour un avis rectificatif ou d'annulation. */
export function isRectificatif(record: OdsRecord): boolean {
  const etat = first(record, ["etat"]);
  if (etat && /rectif|modificat|annul/i.test(etat)) return true;
  const nature = first(record, ["nature_libelle", "sousnature_libelle"]);
  return Boolean(nature && /rectificatif|modificatif/i.test(nature));
}

/**
 * Convertit un enregistrement BOAMP en avis normalisé.
 *
 * Renvoie `null` si l'enregistrement n'a ni objet ni identifiant : mieux vaut
 * écarter un avis que d'en créer un à moitié renseigné.
 */
export function normalizeBoampRecord(record: OdsRecord): NormalizedNotice | null {
  const title = first(record, ["objet"]);
  const id = first(record, ["idweb", "id"]);
  if (!title || !id) return null;

  // Un avis d'attribution n'ouvre pas de consultation : il n'a pas sa place
  // dans le portefeuille d'opportunités.
  if (isAwardNotice(record)) return null;

  const donnees = parseDonnees(record["donnees"]);

  // La date limite figure en colonne plate pour les avis nationaux, et
  // seulement dans l'avis complet pour les avis européens.
  const deadline =
    parseDate(first(record, ["datelimitereponse"])) ?? extractDeadlineFromDonnees(donnees);

  const amount = extractAmountFromDonnees(donnees);
  const cpvCodes = extractCpvFromDonnees(donnees);
  const lots = extractLotsFromDonnees(donnees);
  const rectificatif = isRectificatif(record);
  const linked = record["annonce_lie"];
  const rectifies =
    rectificatif && Array.isArray(linked) && linked.length > 0 ? String(linked[0]) : null;

  return {
    sourceNoticeId: id,
    title: title.slice(0, 500),
    buyer: (first(record, ["nomacheteur"]) ?? "Acheteur non précisé dans l'avis").slice(0, 300),
    consultationRef: readableReference(record, id),
    objectSummary: title.slice(0, 4000),
    procedure: first(record, ["procedure_libelle", "type_procedure", "nature_libelle"]),
    cpvCodes,
    marketTypes: readMarketTypes(record),
    publishedAt: parseDate(first(record, ["dateparution"])),
    deadlineAt: deadline,
    executionPlace: first(record, ["code_departement_prestation", "code_departement"]),
    region: null,
    department: first(record, ["code_departement_prestation", "code_departement"]),
    contractDuration: null,
    responseTerms: null,
    amountKind: amount.kind,
    amountMinEur: amount.min,
    amountMaxEur: amount.max,
    amountNote: amount.note,
    sourceUrl: first(record, ["url_avis"]) ?? `https://www.boamp.fr/pages/avis/?q=idweb:${id}`,
    // Le BOAMP ne publie pas de lien direct vers le dossier de consultation :
    // il faut passer par le profil d'acheteur, souvent nominatif.
    dceUrl: null,
    lots,
    rectifiesNoticeId: rectifies,
    noticeType: first(record, ["nature_libelle", "nature", "etat"]),
    raw: { idweb: id, famille: first(record, ["famille"]), etat: first(record, ["etat"]) },
  };
}

/**
 * Référence de consultation lisible.
 *
 * `contractfolderid` est souvent un identifiant technique (un GUID) qui
 * n'apprend rien à personne sur une carte. L'identifiant BOAMP, lui, est la
 * référence que l'on cite réellement pour retrouver un avis.
 */
function readableReference(record: OdsRecord, idweb: string): string {
  const folder = first(record, ["contractfolderid"]);
  const isGuid = folder ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(folder) : false;
  if (folder && !isGuid && folder.length <= 60) return folder;
  return `BOAMP ${idweb}`;
}

/** Nature du marché, exposée par le BOAMP sous forme de tableau. */
function readMarketTypes(record: OdsRecord): string[] {
  const raw = record["type_marche"] ?? record["type_marche_facette"];
  if (Array.isArray(raw)) {
    return [...new Set(raw.filter((item): item is string => typeof item === "string"))];
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function parseDonnees(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Construction de la requête
// ---------------------------------------------------------------------------

/**
 * Clause `where` de l'API Explore.
 *
 * Deux contraintes dictent sa forme :
 *
 *  - il n'existe **pas** de colonne `code_cpv` : filtrer dessus renvoie une
 *    erreur `ODSQLError: Unknown field`. Les CPV ne sont lisibles qu'une fois
 *    l'avis récupéré, dans la colonne `donnees` ;
 *  - la recherche ne doit pas se limiter aux mots-clés exacts de l'intitulé :
 *    on interroge aussi les descripteurs thématiques du BOAMP, qui rattrapent
 *    les avis dont le titre ne contient pas le mot « formation ».
 */
export function buildWhereClause(
  options: Pick<FetchOptions, "lookbackDays" | "keywords">,
): string {
  const since = new Date(Date.now() - options.lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Au-delà d'une trentaine de termes la requête devient très longue sans
  // gagner en rappel : les mots-clés les plus spécifiques suffisent.
  const terms = options.keywords.filter((keyword) => keyword.trim().length > 2).slice(0, 30);
  const clauses = terms.flatMap((keyword) => [
    `search(objet, "${escape(keyword)}")`,
    `search(descripteur_libelle, "${escape(keyword)}")`,
  ]);

  const dateClause = `dateparution >= date'${since}'`;
  return clauses.length > 0 ? `${dateClause} and (${clauses.join(" or ")})` : dateClause;
}
