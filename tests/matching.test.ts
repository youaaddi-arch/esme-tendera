import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type { Training } from "@prisma/client";

import { runMatching } from "../src/lib/matching/engine";
import { detectConcepts, expandWithConcepts } from "../src/lib/matching/synonyms";
import { cosineWithSupport, termVector, tokenize, tokenizeWithBigrams } from "../src/lib/matching/text";
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

describe("appui lexical", () => {
  it("distingue une proximité thématique d'une coïncidence sur un mot", () => {
    const idf = new Map<string, number>();
    // Un mot générique, lourd parce que rare dans un petit corpus, et des
    // mots de domaine au poids comparable.
    for (const term of ["generiqu", "solair", "photovoltaiqu", "onduleur", "raccordement"]) {
      idf.set(term, 3);
    }

    const coincidence = cosineWithSupport(
      termVector(["generiqu", "generiqu", "generiqu", "autre"]),
      termVector(["generiqu", "generiqu", "generiqu", "different"]),
      idf,
    );
    const thematique = cosineWithSupport(
      termVector(["solair", "photovoltaiqu", "onduleur", "raccordement"]),
      termVector(["solair", "photovoltaiqu", "onduleur", "raccordement"]),
      idf,
    );

    assert.ok(coincidence.support < 1.5, `support de coïncidence trop haut : ${coincidence.support}`);
    assert.ok(thematique.support > 3, `support thématique trop bas : ${thematique.support}`);
  });

  it("retire le vocabulaire administratif sans contenu", () => {
    const tokens = tokenize("Actions de formation dans le cadre de la mise en oeuvre du dispositif");
    for (const empty of ["action", "cadr", "mise", "oeuvr", "dispositif"]) {
      assert.ok(!tokens.includes(empty), `« ${empty} » ne devrait pas être retenu : ${tokens.join(",")}`);
    }
    // « formation » est tronqué en « form » par la morphologie légère.
    assert.ok(tokens.includes("form"), `le sujet doit survivre au filtrage : ${tokens.join(",")}`);
  });
});

describe("expansion par synonymes", () => {
  it("relie le vocabulaire acheteur au concept métier", () => {
    const concepts = detectConcepts("montée en compétences des agents");
    assert.ok(concepts.includes("@formation"), `concepts : ${concepts.join(", ")}`);
  });

  it("n'indexe pas les mots isolés d'une expression de plusieurs mots", () => {
    // L'index inversé enregistrait chaque mot d'une expression comme
    // déclencheur à lui seul : par « organisme de formation », le mot
    // « formation » déclenchait Qualiopi ; par « marché public », le mot
    // « public » déclenchait la commande publique sur tout avis ; par
    // « outils collaboratifs », le mot « outils » déclenchait la bureautique.
    // Résultat mesuré sur le référentiel : « Intelligence artificielle »
    // ressortait sur 60 % des fiches, « Gestion de projet » sur 75 %.
    assert.ok(
      !detectConcepts("outils de pilotage").includes("@bureautique"),
      "« outils » seul ne doit pas déclencher la bureautique",
    );
    assert.ok(
      !detectConcepts("réunion publique de quartier").includes("@achat_public"),
      "« public » seul ne doit pas déclencher la commande publique",
    );
    // Les expressions complètes, elles, déclenchent toujours.
    assert.ok(detectConcepts("fourniture d'outils collaboratifs").includes("@bureautique"));
    assert.ok(detectConcepts("passation d'un marché public").includes("@achat_public"));
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

    // Ce que ce cas doit garantir, c'est la détection — pas une valeur de
    // score. L'assertion portait sur un seuil chiffré, devenu trompeur après
    // le resserrage du moteur : l'échelle entière s'est abaissée, les
    // similarités n'étant plus gonflées par du vocabulaire administratif ni
    // par des concepts omniprésents. On vérifie donc ce qui compte vraiment,
    // à savoir que la consultation est reconnue comme de la formation, reste
    // dans le périmètre, et fait remonter des fiches pertinentes en tête.
    assert.ok(outcome.isFormation, "la consultation aurait dû être reconnue comme de la formation");
    assert.notEqual(outcome.nature, "HORS_CHAMP");
    assert.ok(outcome.matches.length > 0);
    assert.ok(
      outcome.matches.slice(0, 3).some((match) => /accompagnement|transformation|changement/i.test(match.title)),
      `attendu une fiche d'accompagnement en tête, reçu ${outcome.matches.slice(0, 3).map((m) => m.title).join(" | ")}`,
    );
  });

  it("ne rapproche pas deux sujets qui ne partagent que du vocabulaire administratif", () => {
    // Cas mesuré sur un avis réel : « Actions de formation — Risques amiante
    // dans la construction » ressortait à 58/100 face à une fiche de stratégie
    // IA, dont 62 % de la similarité portée par le seul mot « action ».
    const outcome = runMatching(
      {
        title: "Actions de formation dans le cadre de campusAtlas",
        objectSummary:
          "Actions de formation dans le cadre de campusAtlas - thématique « Risques amiante dans la Construction DROM (Guyane, Martinique, Guadeloupe) ».",
      },
      referential,
      WEIGHTS,
    );

    assert.ok(outcome.isFormation, "il s'agit bien d'un marché de formation");
    assert.ok(
      outcome.scoreCatalogue < 30,
      `l'amiante n'est pas au catalogue ESME : score attendu bas, reçu ${outcome.scoreCatalogue}`,
    );
    // Ce qui doit être garanti, c'est qu'aucune fiche n'est présentée comme
    // une vraie correspondance. Le catalogue ne couvre pas l'amiante : il est
    // normal que des fiches apparaissent en bas de liste, il ne l'est pas
    // qu'elles obtiennent un score qui ferait croire à une adéquation.
    const meilleure = outcome.matches[0];
    assert.ok(
      !meilleure || meilleure.score < 30,
      `aucune fiche ne doit paraître adéquate, reçu ${meilleure?.title} à ${Math.round(meilleure?.score ?? 0)}`,
    );
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

  it("reconnaît un marché de formation hors catalogue comme réalisable", () => {
    // Le catalogue affine le matching ; il ne délimite pas le périmètre.
    const outcome = runMatching(
      {
        title: "Marché de formation à la comptabilité publique et à la gestion budgétaire",
        objectSummary:
          "Formation de 60 agents des services financiers à la comptabilité publique, à l'exécution budgétaire et au contrôle interne comptable.",
      },
      referential,
      WEIGHTS,
    );

    assert.equal(outcome.isFormation, true, "devrait être reconnu comme de la formation");
    assert.ok(
      ["FORMATION_REALISABLE", "FORMATION_VOISINE", "FORMATION_CATALOGUE"].includes(outcome.nature),
      `nature inattendue : ${outcome.nature}`,
    );
    assert.ok(!outcome.recommendation.includes("écarter"), outcome.recommendation);
  });

  it("écarte l'apprentissage d'un métier manuel hors du champ de l'ESME", () => {
    for (const title of [
      "Formation aux métiers de l'esthétique et de la coiffure",
      "Marché de formation en pâtisserie et boulangerie",
      "Formation aux techniques de maçonnerie et de plomberie",
    ]) {
      const outcome = runMatching({ title }, referential, WEIGHTS);
      assert.equal(outcome.isFormation, true, title);
      assert.equal(outcome.nature, "FORMATION_METIER_MANUEL", `${title} → ${outcome.nature}`);
    }
  });

  it("ne prend pas un nom d'institution pour un métier manuel", () => {
    // « Mutualité Sociale Agricole » désigne un acheteur, pas un métier.
    const outcome = runMatching(
      { title: "Marché de prestations de formation pour les élus de la Mutualité Sociale Agricole" },
      referential,
      WEIGHTS,
    );
    assert.notEqual(outcome.nature, "FORMATION_METIER_MANUEL", outcome.natureLabel);
  });

  it("ne déclasse pas un accord-cadre entier pour un seul lot manuel", () => {
    // Douze lots de formation dont un en coiffure : le marché reste traitable,
    // et le lot concerné est signalé.
    const outcome = runMatching(
      {
        title: "Accord-cadre de formation des agents de la collectivité",
        lots: [
          { number: "1", title: "Bureautique et outils collaboratifs" },
          { number: "2", title: "Management de proximité" },
          { number: "3", title: "Coiffure et esthétique" },
        ],
      },
      referential,
      WEIGHTS,
    );
    assert.notEqual(outcome.nature, "FORMATION_METIER_MANUEL", outcome.natureLabel);
    assert.ok(
      outcome.formationSignals.some((signal) => signal.includes("lot 3")),
      outcome.formationSignals.join(" | "),
    );
  });

  it("ne confond pas un sujet technique d'ingénierie avec un métier manuel", () => {
    // « habilitation électrique » et « installation photovoltaïque » relèvent
    // bien du champ de l'ESME, même s'ils touchent au geste technique.
    for (const title of [
      "Formation à l'habilitation électrique des agents techniques",
      "Formation au dimensionnement des installations photovoltaïques",
      "Formation à la maintenance industrielle des équipements",
    ]) {
      const outcome = runMatching({ title }, referential, WEIGHTS);
      assert.notEqual(outcome.nature, "FORMATION_METIER_MANUEL", `${title} → ${outcome.nature}`);
    }
  });

  it("écarte un marché de travaux dans un centre de formation", () => {
    // Deux occurrences du mot « formation », et pourtant des travaux : c'est
    // la nature déclarée par l'acheteur qui tranche.
    const outcome = runMatching(
      {
        title: "Travaux d'extension de l'atelier de carrosserie du centre de formation",
        marketTypes: ["TRAVAUX"],
      },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, false, outcome.formationSignals.join(" | "));
    assert.equal(outcome.nature, "HORS_CHAMP");
  });

  it("écarte un marché de fournitures livrées à un centre de formation", () => {
    const outcome = runMatching(
      {
        title: "Achat et livraison de denrées alimentaires pour le centre de formation",
        marketTypes: ["FOURNITURES"],
      },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, false);
  });

  it("écarte un objet d'acquisition même sans nature déclarée", () => {
    const outcome = runMatching(
      { title: "Acquisition d'un bus numérique itinérant pour le centre de formation" },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, false, outcome.formationSignals.join(" | "));
  });

  it("retient un marché de services de formation", () => {
    const outcome = runMatching(
      {
        title: "Prestations de formation des agents aux outils numériques",
        marketTypes: ["SERVICES"],
      },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, true);
  });

  it("fait primer un code CPV de formation sur la nature déclarée", () => {
    // Un marché classé « fournitures » mais porteur d'un CPV 80 reste une
    // prestation de formation : c'est le classement de l'acheteur.
    const outcome = runMatching(
      {
        title: "Acquisition de modules de formation à destination des agents",
        marketTypes: ["FOURNITURES"],
        cpvCodes: ["80521000"],
      },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, true, outcome.formationSignals.join(" | "));
  });

  it("signale qu'un marché ne porte pas sur de la formation", () => {
    const outcome = runMatching(
      {
        title: "Travaux de réfection de l'étanchéité de la toiture du gymnase",
        objectSummary: "Reprise de l'étanchéité et remplacement des exutoires de fumée.",
      },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, false);
    assert.equal(outcome.nature, "HORS_CHAMP");
    assert.ok(outcome.natureLabel.includes("conservé"), outcome.natureLabel);
  });

  it("reconnaît la formation par le code CPV même sans vocabulaire explicite", () => {
    const outcome = runMatching(
      {
        title: "Accompagnement à la montée en compétences des agents",
        cpvCodes: ["80530000"],
      },
      referential,
      WEIGHTS,
    );
    assert.equal(outcome.isFormation, true);
    assert.ok(
      outcome.formationSignals.some((signal) => signal.includes("CPV")),
      outcome.formationSignals.join(" | "),
    );
  });

  it("ne produit rien sur un référentiel vide, et le dit", () => {
    const outcome = runMatching({ title: "Formation" }, [], WEIGHTS);
    assert.equal(outcome.scoreGlobal, 0);
    assert.ok(outcome.caveats.length > 0);
  });
});
