import type { AmountKind } from "@prisma/client";

/** Avis normalisé : format pivot entre les connecteurs et le moteur de veille. */
export type NormalizedNotice = {
  /** Identifiant de l'avis chez la source. Sert à la déduplication. */
  sourceNoticeId: string;
  title: string;
  buyer: string;
  buyerSiret?: string | null;
  consultationRef?: string | null;
  objectSummary?: string | null;
  procedure?: string | null;
  cpvCodes: string[];
  /// Nature du marché : SERVICES, TRAVAUX, FOURNITURES.
  marketTypes: string[];
  publishedAt?: Date | null;
  deadlineAt?: Date | null;
  executionPlace?: string | null;
  region?: string | null;
  department?: string | null;
  contractDuration?: string | null;
  responseTerms?: string | null;
  amountKind: AmountKind;
  amountMinEur?: number | null;
  amountMaxEur?: number | null;
  amountNote?: string | null;
  sourceUrl?: string | null;
  /** Lien direct vers le dossier de consultation, quand la source le publie. */
  dceUrl?: string | null;
  lots: {
    number: string;
    title: string;
    description?: string | null;
    cpvCodes?: string[];
    amountKind?: AmountKind;
    amountMinEur?: number | null;
    amountMaxEur?: number | null;
  }[];
  /** Avis rectificatif : identifiant de l'avis initial. */
  rectifiesNoticeId?: string | null;
  /** Nature de l'avis : appel à concurrence, rectificatif, attribution… */
  noticeType?: string | null;
  /** Données brutes conservées pour audit et reprise. */
  raw?: unknown;
};

export type FetchOptions = {
  /** Profondeur de recherche, en jours. */
  lookbackDays: number;
  keywords: string[];
  cpvCodes: string[];
  pageSize: number;
  maxPages: number;
  /** Paramètres propres au connecteur (clé d'API, filtres). */
  config: Record<string, unknown>;
  signal?: AbortSignal;
};

export type FetchResult = {
  notices: NormalizedNotice[];
  /** Erreurs non bloquantes : une page en échec n'annule pas les autres. */
  errors: string[];
  /** Diagnostic affiché dans le journal de la synchronisation. */
  log: Record<string, unknown>;
};

export class ConnectorUnavailableError extends Error {
  constructor(
    message: string,
    public readonly remedy: string,
  ) {
    super(message);
    this.name = "ConnectorUnavailableError";
  }
}

export interface Connector {
  key: string;
  fetchNotices(options: FetchOptions): Promise<FetchResult>;
}
