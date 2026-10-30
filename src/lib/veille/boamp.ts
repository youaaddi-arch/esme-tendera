import "server-only";

import {
  ConnectorUnavailableError, type Connector, type FetchOptions, type FetchResult,
  type NormalizedNotice,
} from "./types";
import { buildWhereClause, isAwardNotice, normalizeBoampRecord } from "./boamp-parse";

/**
 * Connecteur BOAMP.
 *
 * Source : jeu de données ouvert du Bulletin officiel des annonces de marchés
 * publics, exposé par l'API Explore v2.1 d'Opendatasoft. Aucune
 * authentification n'est nécessaire et aucune protection n'est contournée :
 * l'API est publique et documentée.
 *
 * Note d'exploitation : le `fetch` natif de Node ignore les variables
 * `HTTPS_PROXY`. Derrière un proxy sortant, démarrer le serveur avec
 * `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21), sinon les appels partent en direct et
 * échouent.
 */

const DATASET = "boamp";
const DEFAULT_BASE = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1";
/** Maximum accepté par l'API Explore pour `limit`. */
const MAX_PAGE_SIZE = 100;

type OdsResponse = {
  total_count?: number;
  results?: Record<string, unknown>[];
  error_code?: string;
  message?: string;
};

/**
 * Appel réseau avec reprise.
 *
 * Le portail coupe régulièrement des connexions sans réponse. Une erreur
 * réseau isolée ne doit pas faire échouer toute la synchronisation : on
 * réessaie avec une attente croissante, et on n'abandonne qu'ensuite.
 */
async function fetchWithRetry(
  url: URL,
  signal: AbortSignal | undefined,
  attempts = 8,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ESME-TENDERA/0.1 (veille marchés publics)",
        },
        signal,
        cache: "no-store",
      });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) break;
      // Attente croissante, plafonnée : le portail coupe des connexions par
      // rafales, et insister trop vite ne fait qu'allonger la rafale.
      const wait = Math.min(1500 * 2 ** attempt, 20_000);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw new ConnectorUnavailableError(
    `BOAMP injoignable depuis ce serveur après ${attempts} tentatives (${(lastError as Error)?.message ?? "erreur réseau"}).`,
    "Vérifiez la sortie réseau du serveur : l'hôte boamp-datadila.opendatasoft.com doit être joignable. " +
      "Derrière un proxy sortant, démarrez le serveur avec NODE_USE_ENV_PROXY=1, car le fetch natif de Node ignore HTTPS_PROXY.",
  );
}

export const boampConnector: Connector = {
  key: "boamp",

  async fetchNotices(options: FetchOptions): Promise<FetchResult> {
    const base = typeof options.config.baseUrl === "string" && options.config.baseUrl.trim()
      ? options.config.baseUrl
      : DEFAULT_BASE;
    const where = buildWhereClause(options);
    const pageSize = Math.min(options.pageSize, MAX_PAGE_SIZE);

    const notices: NormalizedNotice[] = [];
    const errors: string[] = [];
    let total: number | undefined;
    let pages = 0;
    let discarded = 0;
    let awards = 0;

    for (let page = 0; page < options.maxPages; page += 1) {
      const url = new URL(`${base}/catalog/datasets/${DATASET}/records`);
      url.searchParams.set("where", where);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(page * pageSize));
      url.searchParams.set("order_by", "dateparution desc");

      const response = await fetchWithRetry(url, options.signal);

      if (response.status === 404) {
        throw new ConnectorUnavailableError(
          `Le jeu de données « ${DATASET} » est introuvable à cette adresse.`,
          "Le portail a pu changer d'adresse ou de nom de jeu de données. Vérifiez l'URL de base dans les paramètres du connecteur.",
        );
      }

      const payload = (await response.json().catch(() => null)) as OdsResponse | null;

      if (!response.ok || payload?.error_code) {
        // L'API renvoie un message précis en cas de requête invalide : on le
        // remonte tel quel plutôt que de masquer la cause.
        const detail = payload?.message ?? `${response.status} ${response.statusText}`;
        errors.push(`Page ${page + 1} : ${payload?.error_code ?? "HTTP " + response.status} — ${detail}`);
        break;
      }

      total = payload?.total_count ?? total;
      const results = payload?.results ?? [];
      pages += 1;

      for (const record of results) {
        // Les avis d'attribution sont comptés à part : les écarter est le
        // comportement attendu, pas une anomalie de lecture.
        if (isAwardNotice(record)) {
          awards += 1;
          continue;
        }
        const notice = normalizeBoampRecord(record);
        if (notice) notices.push(notice);
        else discarded += 1;
      }

      if (results.length < pageSize) break;
    }

    if (discarded > 0) {
      errors.push(
        `${discarded} avis illisible(s) : objet ou identifiant absent de l'enregistrement.`,
      );
    }

    return {
      notices,
      errors,
      log: {
        dataset: DATASET,
        where,
        pagesLues: pages,
        totalDisponible: total ?? null,
        retenus: notices.length,
        avisAttributionIgnores: awards,
        illisibles: discarded,
      },
    };
  },
};
