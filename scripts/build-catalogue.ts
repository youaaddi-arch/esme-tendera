/**
 * Génère le référentiel pédagogique de TENDERA à partir de l'extraction
 * structurée du catalogue officiel « ESME-EE_Catalogue_2027.pdf » (68 pages).
 *
 * Entrée  : data-source/catalogue-2027.json — une fiche par formation, reprise
 *           telle quelle du catalogue (intitulé, objectifs, prérequis, durée,
 *           programme détaillé, page).
 * Sortie  : src/data/catalogue-esme.json — les mêmes fiches enrichies des
 *           champs dont le moteur de matching a besoin : compétences visées,
 *           compétences connexes, mots-clés, modalités normalisées, CPV
 *           indicatifs.
 *
 * Aucun contenu n'est inventé : les compétences visées sont les objectifs
 * pédagogiques du catalogue, les mots-clés sont extraits des intitulés et des
 * rubriques de programme. Les codes CPV sont indicatifs et rattachés au
 * domaine, pas à la fiche : ils servent au filtrage de veille, pas à une
 * déclaration contractuelle.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type SourceBlock = { heading: string; items: string[] };
type SourceProgram = {
  code: string;
  slug: string;
  title: string;
  domain: string;
  theme: string;
  objective: string;
  audience: string;
  publics: string[];
  objectives: string[];
  prerequisites: string[];
  methods: string[];
  highlights: string[];
  duration: string;
  hours: number;
  modality: string;
  intraOnly: boolean;
  programme: SourceBlock[];
  evaluation: string | null;
  catalogPage: number;
};

const ROOT = resolve(import.meta.dirname, "..");

/** CPV du champ « services de formation », rattachés par domaine. */
const CPV_BY_DOMAIN: Record<string, string[]> = {
  "energies-services": ["80500000", "80510000", "80530000", "71314000"],
  industrie: ["80500000", "80510000", "80530000"],
  numerique: ["80500000", "80510000", "80533100", "72000000"],
  "management-transformation": ["80500000", "80532000", "79632000", "79400000"],
};

const STOP = new Set([
  "les", "des", "une", "aux", "pour", "avec", "dans", "sur", "par", "son", "ses", "leur",
  "vos", "nos", "qui", "que", "est", "sont", "etre", "avoir", "plus", "tout", "tous",
  "toute", "cette", "cet", "ces", "the", "and", "comprendre", "maitriser", "identifier",
  "savoir", "connaitre", "mettre", "oeuvre", "place", "faire", "sera", "capable", "issue",
  "formation", "participant", "principales", "principaux", "differents", "differentes",
]);

function deaccent(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mots-clés : termes saillants de l'intitulé, du thème et des rubriques. */
function deriveKeywords(program: SourceProgram): string[] {
  const corpus = [
    program.title,
    program.theme,
    ...program.programme.map((block) => block.heading),
  ].join(" ");
  const counts = new Map<string, { raw: string; n: number }>();
  for (const word of corpus.split(/[^\p{L}\p{N}+]+/u)) {
    if (word.length < 4) continue;
    const key = deaccent(word);
    if (STOP.has(key)) continue;
    const entry = counts.get(key) ?? { raw: word.toLowerCase(), n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.raw.localeCompare(b.raw))
    .slice(0, 18)
    .map((entry) => entry.raw);
}

/**
 * Compétences connexes : les rubriques du programme détaillé.
 *
 * Elles disent ce que la formation aborde sans en faire un objectif affiché —
 * exactement ce qu'un acheteur peut demander sous un autre nom.
 */
function deriveRelatedSkills(program: SourceProgram): string[] {
  return program.programme
    .map((block) => block.heading.replace(/\s+/g, " ").trim())
    .filter((heading) => heading.length > 3 && !/^évaluation/i.test(heading))
    .map((heading) => heading.charAt(0) + heading.slice(1).toLowerCase())
    .slice(0, 12);
}

/** Normalise la modalité du catalogue en modes de diffusion exploitables. */
function deriveDeliveryModes(modality: string): string[] {
  const value = deaccent(modality);
  const modes: string[] = [];
  if (value.includes("presentiel")) modes.push("Présentiel");
  if (value.includes("distanciel")) modes.push("Distanciel");
  if (modes.length === 2) modes.push("Hybride");
  return modes.length ? modes : ["Présentiel"];
}

function main() {
  const source = JSON.parse(
    readFileSync(resolve(ROOT, "data-source/catalogue-2027.json"), "utf8"),
  ) as { domains: { slug: string; name: string; longName: string; intro: string }[]; programs: SourceProgram[] };

  const trainings = source.programs.map((program) => ({
    code: program.code,
    slug: program.slug,
    title: program.title,
    domainSlug: program.domain,
    theme: program.theme,
    objective: program.objective,
    audience: program.audience,
    objectives: program.objectives,
    prerequisites: program.prerequisites,
    methods: program.methods,
    highlights: program.highlights,
    // Les objectifs pédagogiques du catalogue *sont* les compétences visées.
    skills: program.objectives,
    relatedSkills: deriveRelatedSkills(program),
    keywords: deriveKeywords(program),
    cpvCodes: CPV_BY_DOMAIN[program.domain] ?? ["80500000"],
    duration: program.duration,
    hours: program.hours,
    modality: program.modality,
    deliveryModes: deriveDeliveryModes(program.modality),
    certification: null as string | null,
    intraOnly: program.intraOnly,
    programme: program.programme,
    evaluation: program.evaluation,
    sourceDocument: "ESME-EE_Catalogue_2027.pdf",
    catalogPage: program.catalogPage,
    sourceUrl: "https://www.esme.fr/executive-education/",
  }));

  const payload = {
    source: {
      document: "ESME-EE_Catalogue_2027.pdf",
      title: "ESME Executive Education — Formations 2027",
      pages: 68,
      extractedAt: new Date().toISOString().slice(0, 10),
    },
    domains: source.domains,
    trainings,
  };

  writeFileSync(
    resolve(ROOT, "src/data/catalogue-esme.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  console.log(`Référentiel écrit : ${trainings.length} formations, ${source.domains.length} domaines.`);
}

main();
