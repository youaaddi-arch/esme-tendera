import "server-only";

/**
 * Reprise d'une sélection d'affaires depuis les sources officielles.
 *
 * Le tri des consultations a d'abord été fait à la main, dans un tableur. Au
 * moment de le rapprocher du pipeline, une partie des lignes n'a pas retrouvé
 * son affaire : libellé d'acheteur différent, intitulé reformulé, ou
 * consultation jamais entrée dans la veille parce qu'elle n'était publiée
 * qu'au JOUE.
 *
 * Archiver tout ce qui n'est pas dans le tableau aurait fait disparaître ces
 * lignes-là, qui portent pourtant des décisions. Ce module fait l'inverse : il
 * va rechercher chaque ligne non rapprochée **chez la source**, et ne crée la
 * fiche qu'à partir de l'avis réellement publié.
 *
 * C'est la seule manière acceptable. Un tableau donne un acheteur, un objet
 * résumé et une date ; il ne donne ni les lots, ni les CPV, ni les modalités
 * de réponse, ni l'adresse du dossier. Fabriquer une fiche à partir de cela
 * produirait une affaire d'apparence complète dont la moitié des champs
 * seraient inventés. Ce qui n'est retrouvé chez aucune source est donc
 * signalé, pas créé.
 */
import { prisma } from "../db";
import { ingestNotice } from "./ingest";
import { normalizeBoampRecord } from "./boamp-parse";
import { identifiantDepuisLien } from "./liens";
import { normalizeTedNotice, TED_FIELDS, type TedRecord } from "./ted-parse";
import { persistMatching } from "../matching/persist";
import type { NormalizedNotice } from "./types";

const BOAMP = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const TED = "https://api.ted.europa.eu/v3/notices/search";

export type Ligne = {
  acheteur: string;
  objet: string;
  decision: string;
  limite: string;
  remarques: string;
  lien: string;
  identifiant: string | null;
  source: "BOAMP" | "TED" | "INCONNU";
};

/**
 * Appel réseau avec reprise, puis abandon silencieux.
 *
 * Une reprise de sélection lance une requête par piste et par ligne : près de
 * quatre-vingts appels pour vingt-six lignes. Le portail BOAMP coupe des
 * connexions par rafales, et une seule coupure faisait échouer la reprise
 * entière — on perdait les vingt-cinq autres lignes avec elle.
 *
 * On réessaie donc, puis on renonce à cette piste-là sans faire tomber le
 * reste. Renoncer est sans danger ici : une piste perdue ne produit pas une
 * fausse correspondance, elle laisse la ligne dans celles qu'on signale comme
 * non retrouvées. Le silence va vers le signalement, jamais vers la création.
 */
async function appel(url: URL, tentatives = 4): Promise<Record<string, unknown>[] | null> {
  for (let n = 0; n < tentatives; n += 1) {
    try {
      const reponse = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "ESME-TENDERA/0.1 (reprise de sélection)" },
        cache: "no-store",
      });
      if (!reponse.ok) return null;
      const corps = (await reponse.json()) as { results?: Record<string, unknown>[] };
      return corps.results ?? [];
    } catch {
      if (n < tentatives - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** n, 8000)));
      }
    }
  }
  return null;
}

/** Mots porteurs d'un libellé d'acheteur, pour une recherche plein texte. */
function motsAcheteur(acheteur: string): string[] {
  const nettoye = acheteur
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(\d{5})\b/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const vides = new Set([
    "de", "du", "des", "la", "le", "les", "et", "d", "l", "en", "sur", "pour",
    "autres", "organismes", "vraisemblablement", "ministere", "ministeres",
    "departement", "ville", "region", "societe", "nationale", "syndicat", "mixte",
  ]);
  return [...new Set(nettoye.toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 4 && !vides.has(m)))];
}

/**
 * Mots porteurs de l'objet du marché.
 *
 * On écarte le vocabulaire commun à tous les marchés de formation — le mot
 * « formation » lui-même en tête. Il est dans presque chaque avis du jeu de
 * données : l'exiger ne réduit rien et le faire compter dans la ressemblance
 * ferait passer pour proches deux marchés qui n'ont que ce mot en partage.
 */
function motsObjet(objet: string): string[] {
  const vides = new Set([
    "formation", "formations", "prestation", "prestations", "marche", "marches",
    "public", "publics", "accord", "cadre", "service", "services", "bons",
    "commande", "commandes", "realisation", "mise", "oeuvre", "place",
    "professionnelle", "professionnel", "agents", "personnel", "divers",
    "diverses", "present", "objet", "pour", "avec", "dans", "les", "des",
  ]);
  return [...new Set(
    objet
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 5 && !vides.has(m)),
  )].slice(0, 4);
}

async function boampParIdweb(idweb: string): Promise<NormalizedNotice | null> {
  const url = new URL(BOAMP);
  url.searchParams.set("where", `idweb = "${idweb}"`);
  url.searchParams.set("limit", "1");
  const resultats = await appel(url);
  const brut = resultats?.[0];
  return brut ? normalizeBoampRecord(brut) : null;
}

/**
 * Recherche plein texte au BOAMP.
 *
 * Trois requêtes plutôt qu'une, parce qu'une seule échouait pour deux raisons
 * opposées. Chercher sur l'acheteur seul retrouvait bien la collectivité mais
 * rapportait ses derniers marchés — des denrées pour un zoo, du transport de
 * conteneurs — et jamais celui de formation. Chercher sur l'objet seul
 * ramenait le bon type de marché chez n'importe quel acheteur.
 *
 * On croise donc les deux, puis on relâche chaque contrainte à son tour : le
 * libellé d'acheteur du tableau peut différer de celui de l'avis (« CMAR
 * Guadeloupe » contre « CMA Guadeloupe »), et l'objet peut avoir été reformulé.
 * Le classement par ressemblance tranche ensuite entre les candidats.
 */
async function boampRecherche(ligne: Ligne, parRequete = 20): Promise<NormalizedNotice[]> {
  const acheteur = motsAcheteur(ligne.acheteur);
  const objet = motsObjet(ligne.objet);

  const clause = (mots: string[]) => mots.map((m) => `search(*, "${m}")`).join(" AND ");
  const requetes = [
    [...acheteur, ...objet.slice(0, 2)],
    acheteur,
    objet,
  ].filter((mots) => mots.length > 0);

  const vus = new Map<string, NormalizedNotice>();
  for (const mots of requetes) {
    const url = new URL(BOAMP);
    url.searchParams.set("where", clause(mots));
    url.searchParams.set("limit", String(parRequete));
    url.searchParams.set("order_by", "dateparution DESC");
    const resultats = await appel(url);
    if (!resultats) continue;
    for (const brut of resultats) {
      const avis = normalizeBoampRecord(brut);
      if (avis && !vus.has(avis.sourceNoticeId)) vus.set(avis.sourceNoticeId, avis);
    }
  }
  return [...vus.values()];
}

async function tedParNumeros(numeros: string[]): Promise<NormalizedNotice[]> {
  if (numeros.length === 0) return [];
  const reponse = await fetch(TED, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `publication-number IN (${numeros.map((n) => `"${n}"`).join(" ")})`,
      fields: TED_FIELDS,
      limit: Math.min(100, numeros.length * 2),
      page: 1,
    }),
  });
  if (!reponse.ok) {
    console.error(`  TED a refusé la requête (${reponse.status}) : ${(await reponse.text()).slice(0, 300)}`);
    return [];
  }
  const corps = (await reponse.json()) as { notices?: TedRecord[] };
  return (corps.notices ?? []).map(normalizeTedNotice).filter((n): n is NormalizedNotice => n !== null);
}

/**
 * Dates limites plausibles d'après la ligne du tableau.
 *
 * La colonne est hétérogène, et il faut le prendre au sérieux : un même
 * tableur a produit « 14/11/2026 » (jour/mois) et « 11/19/2026 » (mois/jour),
 * selon la façon dont chaque cellule a été saisie ou convertie. Choisir une
 * lecture et s'y tenir, c'était se tromper sur la moitié des lignes — et se
 * tromper silencieusement, puisqu'une date inversée reste une date.
 *
 * On retient donc les deux lectures quand les deux sont des dates réelles, et
 * la seule qui tient quand l'autre ne tient pas : « 19 » ne désigne aucun mois,
 * « 14/11 » n'est ambigu que parce que 14 pourrait être un mois — il ne peut
 * pas. L'ambiguïté qui reste, les jours de 1 à 12, est levée par le reste de
 * la comparaison.
 */
export function limitesPlausibles(brut: string): string[] {
  const m = brut.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return [];
  const [a, b, annee] = [Number(m[1]), Number(m[2]), m[3]];
  const valide = (jour: number, mois: number) => {
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
    const date = new Date(Date.UTC(Number(annee), mois - 1, jour));
    // Un 31 février se replie sur mars : la date existe, la lecture est fausse.
    if (date.getUTCMonth() !== mois - 1 || date.getUTCDate() !== jour) return null;
    return date.toISOString().slice(0, 10);
  };
  return [...new Set([valide(a, b), valide(b, a)].filter((v): v is string => v !== null))];
}

/**
 * Ressemblance entre une ligne du tableau et un avis retrouvé.
 *
 * La date limite est éliminatoire, et c'est le cœur de cette fonction.
 *
 * Sans elle, la ressemblance lexicale suffisait à produire des fiches fausses,
 * et de la pire espèce : vraisemblables. Pour « RRTP 66 » elle rapportait un
 * marché de formation du même organisme, mais publié deux ans plus tôt ; pour
 * l'agglomération de Pornic, un contrôle d'assainissement, parce que le nom de
 * la collectivité pesait plus que l'objet. Rien dans la fiche créée n'aurait
 * signalé l'erreur : le bon acheteur, un objet plausible, et une décision du
 * tableau posée sur une consultation qui n'est pas la sienne.
 *
 * Deux marchés distincts du même acheteur ne se closent pratiquement jamais le
 * même jour. Quand le tableau donne une date limite et que l'avis en publie
 * une, l'égalité au jour près est donc exigée.
 */
/**
 * Ce qu'il faut pour être comparé à une ligne de tableau.
 *
 * Un avis normalisé le porte, et une affaire en base aussi. La comparaison
 * sert dans les deux sens : retrouver l'avis d'une ligne, et vérifier qu'une
 * affaire qu'on s'apprête à archiver ne correspond pas à une ligne qu'on
 * croyait absente.
 */
export type Rapprochable = {
  buyer: string;
  title: string;
  objectSummary?: string | null;
  deadlineAt?: Date | null;
};

export function proximite(ligne: Ligne, avis: Rapprochable): number {
  const attendues = limitesPlausibles(ligne.limite);
  const limiteAvis = avis.deadlineAt?.toISOString().slice(0, 10) ?? null;
  if (attendues.length > 0 && limiteAvis && !attendues.includes(limiteAvis)) return 0;

  const norm = (v: string) =>
    v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const mots = (v: string) => new Set(norm(v).split(" ").filter((m) => m.length >= 4));

  // Les sigles d'un même organisme varient d'un avis à l'autre — « CMAR » et
  // « CMA » désignent la même chambre de métiers. Un mot compte donc aussi
  // lorsqu'il est le préfixe de l'autre, à partir de quatre lettres.
  const proche = (a: string, b: Set<string>) =>
    b.has(a) || [...b].some((m) => (a.length >= 4 && m.startsWith(a)) || (m.length >= 4 && a.startsWith(m)));

  const achA = mots(ligne.acheteur);
  const achB = mots(avis.buyer);
  const communsAcheteur = [...achA].filter((m) => proche(m, achB)).length;
  const scoreAcheteur = achA.size === 0 ? 0 : communsAcheteur / achA.size;

  const objA = mots(ligne.objet);
  const objB = mots(`${avis.title} ${avis.objectSummary ?? ""}`);
  const communsObjet = [...objA].filter((m) => objB.has(m)).length;
  const scoreObjet = objA.size === 0 ? 0 : communsObjet / objA.size;

  // Une date limite concordante confirme ; elle ne porte pas à elle seule.
  const bonusDate = attendues.length > 0 && limiteAvis ? 0.15 : 0;
  return Math.min(1, scoreAcheteur * 0.5 + scoreObjet * 0.35 + bonusDate);
}

/** Au-dessus de ce seuil, l'avis retrouvé est tenu pour être la bonne ligne. */
export const SEUIL_CERTITUDE = 0.55;

export type RepriseLigne = {
  acheteur: string;
  decision: string;
  trouve: boolean;
  source: "boamp" | "ted" | null;
  avisId: string | null;
  avisAcheteur: string | null;
  avisTitre: string | null;
  avisLimite: string | null;
  /** Lien vers l'avis, pour que la ligne non retrouvée puisse être tranchée. */
  avisUrl: string | null;
  lots: number;
  proximite: number;
  issue: string;
  resultat?: "created" | "updated" | "duplicate";
  reference?: string | null;
  appreciation?: string | null;
};

export type RepriseRapport = {
  simulation: boolean;
  demandees: number;
  retrouvees: number;
  tedServis: string;
  creees: number;
  misesAJour: number;
  dejaConnues: number;
  lignes: RepriseLigne[];
};

export async function repriseSelection(
  lignes: Ligne[],
  options: { appliquer: boolean },
): Promise<RepriseRapport> {
  const connecteurs = await prisma.sourceConnector.findMany({ where: { key: { in: ["boamp", "ted"] } } });
  const parCle = new Map(connecteurs.map((c) => [c.key, c]));
  if (!parCle.get("boamp") || !parCle.get("ted")) {
    throw new Error("Les connecteurs boamp et ted doivent être enregistrés en base.");
  }

  // L'identifiant est déduit du lien quand l'appelant ne l'a pas fourni : une
  // ligne de tableau se donne telle quelle, lien compris.
  const resolues = lignes.map((ligne) => {
    if (ligne.identifiant && ligne.source !== "INCONNU") return ligne;
    const trouve = identifiantDepuisLien(ligne.lien);
    return trouve ? { ...ligne, source: trouve.source, identifiant: trouve.identifiant } : ligne;
  });

  // Les avis TED se demandent en une seule requête : inutile d'en faire sept.
  const numerosTed = resolues
    .filter((l) => l.source === "TED" && l.identifiant)
    .map((l) => l.identifiant as string);
  const avisTed = await tedParNumeros(numerosTed);

  // L'identifiant d'un avis TED s'écrit de plusieurs façons : « 741685-2026 »
  // dans un lien de France Marchés, « 00741685-2026 » dans la réponse de
  // l'API, et « TED-00741685-2026 » dans notre base. On indexe donc sur les
  // chiffres significatifs plutôt que sur la chaîne, sinon la recherche
  // retombait sur le plein texte du BOAMP alors que l'avis était là.
  const clef = (valeur: string) => valeur.replace(/^TED-/, "").replace(/^0+/, "");
  const tedParNumero = new Map(avisTed.map((a) => [clef(a.sourceNoticeId), a]));

  const trouvailles: { ligne: Ligne; avis: NormalizedNotice; source: "boamp" | "ted"; score: number }[] = [];
  const rapport: RepriseLigne[] = [];

  for (const ligne of resolues) {
    let avis: NormalizedNotice | null = null;
    let source: "boamp" | "ted" | null = null;
    let score = 1;

    if (ligne.source === "TED" && ligne.identifiant) {
      avis = tedParNumero.get(clef(ligne.identifiant)) ?? null;
      source = avis ? "ted" : null;
    } else if (ligne.source === "BOAMP" && ligne.identifiant) {
      avis = await boampParIdweb(ligne.identifiant);
      source = avis ? "boamp" : null;
    }

    // Sans identifiant — ou si l'identifiant n'a rien donné — on cherche.
    if (!avis) {
      const candidats = await boampRecherche(ligne);
      const classes = candidats
        .map((c) => ({ c, s: proximite(ligne, c) }))
        .sort((a, b) => b.s - a.s);
      const meilleur = classes[0];
      if (meilleur && meilleur.s >= SEUIL_CERTITUDE) {
        avis = meilleur.c;
        source = "boamp";
        score = meilleur.s;
      } else {
        rapport.push({
          acheteur: ligne.acheteur,
          decision: ligne.decision,
          trouve: false,
          source: null,
          avisId: null,
          avisAcheteur: meilleur?.c.buyer ?? null,
          avisTitre: meilleur?.c.title ?? null,
          avisLimite: meilleur?.c.deadlineAt?.toISOString().slice(0, 10) ?? null,
          avisUrl: meilleur?.c.sourceUrl ?? null,
          lots: 0,
          proximite: Math.round((meilleur?.s ?? 0) * 100),
          issue: meilleur
            ? "aucun avis assez proche : le plus ressemblant est en dessous du seuil"
            : "aucun avis retrouvé au BOAMP",
        });
        continue;
      }
    }

    trouvailles.push({ ligne, avis, source: source as "boamp" | "ted", score });
    rapport.push({
      acheteur: ligne.acheteur,
      decision: ligne.decision,
      trouve: true,
      source,
      avisId: avis.sourceNoticeId,
      avisAcheteur: avis.buyer,
      avisTitre: avis.title,
      avisLimite: avis.deadlineAt?.toISOString().slice(0, 10) ?? null,
      avisUrl: avis.sourceUrl ?? null,
      lots: avis.lots.length,
      proximite: Math.round(score * 100),
      issue: "retrouvé",
    });
  }

  const base: RepriseRapport = {
    simulation: !options.appliquer,
    demandees: lignes.length,
    retrouvees: trouvailles.length,
    tedServis: `${avisTed.length}/${numerosTed.length}`,
    creees: 0,
    misesAJour: 0,
    dejaConnues: 0,
    lignes: rapport,
  };

  if (!options.appliquer) return base;

  const reglage = await prisma.setting.findUnique({ where: { key: "scoring" } });
  const weights = (reglage?.value as { catalogue: number; voisines: number; ionis: number } | null) ?? {
    catalogue: 60,
    voisines: 25,
    ionis: 15,
  };

  const compte = { created: 0, updated: 0, duplicate: 0 };
  for (const t of trouvailles) {
    const connecteur = parCle.get(t.source === "ted" ? "ted" : "boamp");
    if (!connecteur) continue;
    const issue = await ingestNotice(t.avis, connecteur);
    compte[issue.kind] += 1;

    // La veille enchaîne l'intégration et le matching ; une affaire reprise ici
    // doit arriver dans le même état, sans quoi elle s'afficherait sans
    // appréciation et paraîtrait n'avoir pas été évaluée.
    let appreciation: string | null = null;
    let reference: string | null = null;
    if (issue.tenderId) {
      const fiche = await prisma.tender.findUnique({
        where: { id: issue.tenderId },
        select: { reference: true },
      });
      reference = fiche?.reference ?? null;
      try {
        const outcome = await persistMatching(prisma, issue.tenderId, { weights, reason: "reprise" });
        if (outcome) appreciation = `${outcome.nature} ${outcome.scoreGlobal}/100`;
      } catch (error) {
        appreciation = `matching en échec : ${(error as Error).message}`;
      }
    }

    const entree = rapport.find((l) => l.avisId === t.avis.sourceNoticeId);
    if (entree) {
      entree.resultat = issue.kind;
      entree.reference = reference;
      entree.appreciation = appreciation;
    }
  }

  return {
    ...base,
    simulation: false,
    creees: compte.created,
    misesAJour: compte.updated,
    dejaConnues: compte.duplicate,
  };
}
