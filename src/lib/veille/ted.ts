import "server-only";

import {
  ConnectorUnavailableError, type Connector, type FetchOptions, type FetchResult,
  type NormalizedNotice,
} from "./types";
import { buildTedQuery, normalizeTedNotice, TED_FIELDS, type TedRecord } from "./ted-parse";

/**
 * Connecteur TED — supplément au Journal officiel de l'Union européenne.
 *
 * Source : API de recherche publique de l'Office des publications. Aucune
 * authentification, aucune protection contournée.
 *
 * Le registre des connecteurs annonçait qu'une clé d'API nominative était
 * exigée. C'est faux pour la v3 : les appels passent sans aucun jeton, ce qui
 * a été vérifié avant d'écrire ce connecteur. L'entrée du registre a été
 * corrigée en conséquence.
 *
 * Pourquoi cette source compte : TED publie les marchés au-dessus des seuils
 * européens, et un accord-cadre de formation de plusieurs millions d'euros
 * peut n'y figurer qu'au JOUE, sans jamais passer par le BOAMP. Mesuré sur un
 * export France Marchés du 27/10/2026 : sur 125 consultations retenues à la
 * main, 35 manquaient à la veille BOAMP seule.
 *
 * Note d'exploitation identique au BOAMP : le `fetch` natif de Node ignore
 * `HTTPS_PROXY`. Derrière un proxy sortant, démarrer le serveur avec
 * `NODE_USE_ENV_PROXY=1`.
 */

const DEFAULT_BASE = "https://api.ted.europa.eu/v3";
/** Plafond de l'API pour `limit`. */
const MAX_PAGE_SIZE = 100;

type TedResponse = {
  notices?: TedRecord[];
  totalNoticeCount?: number;
  message?: string;
  error?: unknown;
};

/**
 * Appel réseau avec reprise.
 *
 * Même politique que le BOAMP : une coupure isolée ne doit pas faire échouer
 * la synchronisation entière, et insister trop vite ne fait qu'allonger la
 * rafale de refus.
 */
async function fetchWithRetry(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  attempts = 8,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "ESME-TENDERA/0.1 (veille marchés publics)",
        },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) break;
      const wait = Math.min(1500 * 2 ** attempt, 20_000);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw new ConnectorUnavailableError(
    `TED injoignable depuis ce serveur après ${attempts} tentatives (${(lastError as Error)?.message ?? "erreur réseau"}).`,
    "Vérifiez la sortie réseau du serveur : l'hôte api.ted.europa.eu doit être joignable. " +
      "Derrière un proxy sortant, démarrez le serveur avec NODE_USE_ENV_PROXY=1, car le fetch natif de Node ignore HTTPS_PROXY.",
  );
}

export const tedConnector: Connector = {
  key: "ted",

  async fetchNotices(options: FetchOptions): Promise<FetchResult> {
    const base = typeof options.config.baseUrl === "string" && options.config.baseUrl.trim()
      ? options.config.baseUrl
      : DEFAULT_BASE;
    const country = typeof options.config.country === "string" ? options.config.country : "FRA";
    const cpvRoot = typeof options.config.cpvRoot === "string" ? options.config.cpvRoot : "80000000";

    const query = buildTedQuery({ lookbackDays: options.lookbackDays, country, cpvRoot });
    const pageSize = Math.min(options.pageSize || 100, MAX_PAGE_SIZE);

    const notices: NormalizedNotice[] = [];
    const errors: string[] = [];
    let total: number | undefined;
    let pages = 0;
    let discarded = 0;

    // La pagination TED est en numéros de page, à partir de 1.
    for (let page = 1; page <= options.maxPages; page += 1) {
      const response = await fetchWithRetry(
        `${base}/notices/search`,
        { query, fields: [...TED_FIELDS], limit: pageSize, page },
        options.signal,
      );

      const payload = (await response.json().catch(() => null)) as TedResponse | null;

      if (!response.ok || payload?.message) {
        // L'API décrit précisément ce qu'elle refuse — un champ inconnu, une
        // requête mal formée. Remonter son message évite de chercher à
        // l'aveugle.
        const detail = payload?.message ?? `HTTP ${response.status}`;
        throw new ConnectorUnavailableError(
          `TED a refusé la requête : ${detail}`,
          "Vérifiez la requête et les champs demandés dans les paramètres du connecteur. " +
            "Un seul champ inconnu fait échouer l'appel entier.",
        );
      }

      const lot = payload?.notices ?? [];
      if (typeof payload?.totalNoticeCount === "number") total = payload.totalNoticeCount;
      pages += 1;

      for (const record of lot) {
        const notice = normalizeTedNotice(record);
        if (notice) notices.push(notice);
        else discarded += 1;
      }

      if (lot.length < pageSize) break;
    }

    return {
      notices,
      errors,
      log: {
        source: "TED",
        requete: query,
        pays: country,
        racineCpv: cpvRoot,
        pagesLues: pages,
        avisDisponibles: total ?? null,
        avisRetenus: notices.length,
        avisEcartes: discarded,
      },
    };
  },
};
