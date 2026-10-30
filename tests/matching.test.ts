import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type { Training } from "@prisma/client";

import { runMatching } from "../src/lib/matching/engine";
import { detectConcepts, expandWithConcepts } from "../src/lib/matching/synonyms";
import { tokenize, tokenizeWithBigrams } from "../src/lib/matching/text";
import { formationsVoisines } from "../src/data/formations-voisines";
import { ionisInstitutions } from "../src/data/ionis";

/**
 * Les tests du moteur de matching s'exécutent sans base de données : le
 * référentiel est chargé depuis les mêmes fichiers que le seed, ce qui permet
 * de les lancer en intégration continue sans PostgreSQL.
 */

type CatalogueFile = {
  trainings: {
    code: string; slug: string; title: string; theme: string; objective: string;
    audience: string; objectives: string[]; skills: string[]; relatedSkills: string[];
    keywords: string[]; cpvCodes: string[]; duration: string; hours: number;
    modality: string; deliveryModes: string[]; intraOnly: boolean;
    programme: { heading: string; items: string[] }[]; highlights: string[];
  }[];
};

function asTraining(partial: Partial<Training> & { code: string; title: string }): Training {
  return {
    id: partial.code,
    origin: "CATALOGUE_ESME",
    slug: partial.code.toLowerCase().replace(/\s+/g, "-"),
    domainId: null,
    theme: null,
    subTheme: null,
    objective: null,
    audience: null,
    objectives: [],
    prerequisites: [],
    methods: [],
    highlights: [],
    skills: [],
    relatedSkills: [],
    keywords: [],
    cpvCodes: [],
    duration: null,
    hours: null,
    modality: null,
    deliveryModes: [],
    certification: null,
    intraOnly: false,
    programme: null,
    evaluation: null,
    sourceDocument: null,
    catalogPage: null,
    sourceUrl: null,
    institutionId: null,
    version: 1,
    archived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Training;
}

/** Charge le référentiel complet (catalogue + voisines + IONIS). */
function loadReferential(): Training[] {
  const file = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../src/data/catalogue-esme.json"), "utf8"),
  ) as CatalogueFile;

  const catalogue = file.trainings.map((training) =>
    asTraining({
      code: training.code,
      title: training.title,
      origin: "CATALOGUE_ESME",
      theme: training.theme,
      objective: training.objective,
      audience: training.audience,
      objectives: training.objectives,
      skills: training.skills,
      relatedSkills: training.relatedSkills,
      keywords: training.keywords,
      cpvCodes: training.cpvCodes,
      duration: training.duration,
      hours: training.hours,
      modality: training.modality,
      deliveryModes: training.deliveryModes,
      intraOnly: training.intraOnly,
      highlights: training.highlights,
      programme: training.programme as never,
    }),
  );

  const voisines = formationsVoisines.map((voisine) =>
    asTraining({
      code: voisine.code,
      title: voisine.title,
      origin: "VOISINE",
      theme: voisine.theme,
      objective: voisine.objective,
      audience: voisine.audience,
      objectives: voisine.skills,
      skills: voisine.skills,
      relatedSkills: voisine.relatedSkills,
      keywords: voisine.keywords,
      cpvCodes: voisine.cpvCodes,
      deliveryModes: ["Présentiel", "Distanciel", "Hybride"],
    }),
  );

  const ionis = ionisInstitutions.flatMap((institution) =>
    institution.capabilities.map((capability) =>
      asTraining({
        code: capability.code,
        title: capability.title,
        origin: "IONIS",
        theme: capability.theme,
        objective: capability.objective,
        audience: institution.audiences.join(", "),
        objectives: capability.skills,
        skills: capability.skills,
        relatedSkills: institution.skills,
        keywords: capability.keywords,
        cpvCodes: capability.cpvCodes,
        deliveryModes: institution.modalities,
      }),
    ),
  );

  return [...catalogue, ...voisines, ...ionis];
}

const WEIGHTS = { catalogue: 60, voisines: 25, ionis: 15 };
const referential = loadReferential();

describe("normalisation lexicale", () => {
  it("retire accents, mots vides et flexions", () => {
    const tokens = tokenize("Les formations à la cybersécurité des agents");
    assert.ok(tokens.includes("cybersecurit"), `attendu cybersecurit, reçu ${tokens.join(",")}`);
    assert.ok(!tokens.includes("les"));
    assert.ok(!tokens.includes("la"));
  });

  it("rapproche singulier et pluriel", () => {
    assert.equal(tokenize("réseau")[0], tokenize("réseaux")[0]);
    assert.equal(tokenize("compétence")[0], tokenize("compétences")[0]);
  });

  it("produit des bigrammes pour les concepts composés", () => {
    const tokens = tokenizeWithBigrams("intelligence artificielle générative");
    assert.ok(tokens.some((token) => token.includes("_")));
  });
});

describe("expansion par synonymes", () => {
  it("relie le vocabulaire acheteur au concept métier", () => {
    const concepts = detectConcepts("montée en compétences des agents");
    assert.ok(concepts.includes("@formation"), `concepts : ${concepts.join(", ")}`);
  });

  it("reconnaît la cybersécurité sous ses formulations administratives", () => {
    const concepts = detectConcepts("sécurité des systèmes d'information et conformité NIS2");
    assert.ok(concepts.includes("@cybersecurite"));
  });

  it("n'ajoute aucun concept à un texte hors périmètre", () => {
    const concepts = detectConcepts("fourniture de mobilier de bureau et chaises ergonomiques");
    assert.ok(!concepts.includes("@cybersecurite"));
    assert.ok(!concepts.includes("@ia"));
  });

  it("préserve les lexèmes d'origine en les complétant", () => {
    const expanded = expandWithConcepts(tokenize("photovoltaïque"));
    assert.ok(expanded.includes("@photovoltaique"));
    assert.ok(expanded.some((token) => token.startsWith("photovolta")));
  });
});

describe("moteur de matching", () => {
  it("reconnaît une consultation photovoltaïque et cite les bonnes fiches", () => {
    const outcome = runMatching(
      {
        title: "Formation au dimensionnement des installations photovoltaïques",
        objectSummary:
          "Former les chargés d'affaires du bureau d'études au dimensionnement, à la conception et à la conformité des installations photovoltaïques en toiture et en ombrière de parking.",
      },
      referential,
      WEIGHTS,
    );

    assert.ok(outcome.scoreCatalogue >= 50, `score catalogue trop bas : ${outcome.scoreCatalogue}`);
    const topCodes = outcome.matches.slice(0, 4).map((match) => match.code);
    assert.ok(
      topCodes.some((code) => code.startsWith("PV")),
      `attendu une fiche PV dans le haut du classement, reçu ${topCodes.join(", ")}`,
    );
  });

  it("détecte une consultation de formation sans le mot « formation » dans le titre", () => {
    // Cas explicitement cité au cahier des charges.
    const outcome = runMatching(
      {
        title: "Accompagnement à la transformation des compétences des agents",
        objectSummary:
          "Accompagnement de 120 agents techniques à la transition énergétique du patrimoine bâti, à la maîtrise de l'énergie et au pilotage des consommations.",
      },
      referential,
      WEIGHTS,
    );

    assert.ok(outcome.scoreGlobal >= 35, `score global trop bas : ${outcome.scoreGlobal}`);
    assert.ok(outcome.matches.length > 0);
  });

  it("écarte une consultation hors périmètre", () => {
    const outcome = runMatching(
      {
        title: "Marché de fourniture et livraison de repas en liaison froide",
        objectSummary:
          "Fourniture quotidienne de 800 repas en liaison froide pour les cantines scolaires, livraison incluse.",
      },
      referential,
      WEIGHTS,
    );

    assert.ok(outcome.scoreCatalogue < 35, `faux positif : ${outcome.scoreCatalogue}`);
    assert.ok(outcome.scoreGlobal < 35, `faux positif global : ${outcome.scoreGlobal}`);
  });

  it("oriente vers IONIS une demande hors catalogue ESME", () => {
    const outcome = runMatching(
      {
        title: "Formation à la reconversion vers les métiers du développement web",
        objectSummary:
          "Parcours intensif de reconversion de demandeurs d'emploi vers le développement web, pédagogie par projet, accompagnement vers l'emploi.",
      },
      referential,
      WEIGHTS,
    );

    const ionisMatches = outcome.matches.filter((match) => match.origin === "IONIS");
    assert.ok(ionisMatches.length > 0, "aucune compétence IONIS identifiée");
    assert.ok(outcome.scoreIonis > 0);
  });

  it("respecte la pondération configurée", () => {
    const input = {
      title: "Formation à la cybersécurité des agents",
      objectSummary: "Sensibilisation de 400 agents et parcours technique pour 40 informaticiens.",
    };
    const base = runMatching(input, referential, WEIGHTS);
    const ionisHeavy = runMatching(input, referential, { catalogue: 10, voisines: 10, ionis: 80 });

    assert.equal(base.scoreCatalogue, ionisHeavy.scoreCatalogue, "les scores par famille ne doivent pas dépendre de la pondération");
    assert.notEqual(base.scoreGlobal, ionisHeavy.scoreGlobal, "le score global doit suivre la pondération");
    assert.equal(Math.round(ionisHeavy.weights.ionis), 80);
  });

  it("normalise une pondération qui ne totalise pas 100", () => {
    const outcome = runMatching(
      { title: "Formation management" },
      referential,
      { catalogue: 6, voisines: 2, ionis: 2 },
    );
    const total = outcome.weights.catalogue + outcome.weights.voisines + outcome.weights.ionis;
    assert.ok(Math.abs(total - 100) < 0.001, `pondération non normalisée : ${total}`);
  });

  it("signale l'absence d'analyse du DCE comme une limite du score", () => {
    const outcome = runMatching({ title: "Formation à la gestion de projet" }, referential, WEIGHTS);
    assert.ok(
      outcome.caveats.some((caveat) => caveat.includes("DCE")),
      "l'absence de DCE analysé doit être signalée",
    );
    assert.ok(
      outcome.caveats.some((caveat) => caveat.includes("probabilité de remporter")),
      "le score ne doit jamais être présenté comme une probabilité de succès",
    );
  });

  it("reste déterministe", () => {
    const input = { title: "Formation à l'intelligence artificielle générative pour les agents" };
    const first = runMatching(input, referential, WEIGHTS);
    const second = runMatching(input, referential, WEIGHTS);
    assert.equal(first.scoreGlobal, second.scoreGlobal);
    assert.deepEqual(
      first.matches.map((match) => match.code),
      second.matches.map((match) => match.code),
    );
  });

  it("ne produit rien sur un référentiel vide, et le dit", () => {
    const outcome = runMatching({ title: "Formation" }, [], WEIGHTS);
    assert.equal(outcome.scoreGlobal, 0);
    assert.ok(outcome.caveats.length > 0);
  });
});
