/**
 * Initialisation de la base ESME TENDERA.
 *
 * Le seed est idempotent : il peut être rejoué sans dupliquer de données.
 *
 * Il charge trois familles de données :
 *
 *  1. le référentiel pédagogique — catalogue ESME (source : catalogue officiel
 *     2027), formations voisines, cartographie IONIS ;
 *  2. le registre des connecteurs de veille, avec l'état réel de chacun ;
 *  3. les comptes de démarrage et, sur demande, un jeu d'affaires de
 *     démonstration.
 *
 * Les affaires de démonstration portent toutes `isDemo = true` et sont
 * étiquetées comme telles dans l'interface : elles ne doivent jamais être
 * confondues avec des consultations réelles. Pour une base vierge :
 *
 *     TENDERA_SEED_DEMO=0 npm run db:seed
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

import { formationsVoisines } from "../src/data/formations-voisines";
import { ionisInstitutions } from "../src/data/ionis";
import { connectorRegistry } from "../src/lib/veille/registry";

const prisma = new PrismaClient();

type CatalogueFile = {
  source: { document: string; title: string; pages: number; extractedAt: string };
  domains: { slug: string; name: string; longName: string; intro: string }[];
  trainings: {
    code: string; slug: string; title: string; domainSlug: string; theme: string;
    objective: string; audience: string; objectives: string[]; prerequisites: string[];
    methods: string[]; highlights: string[]; skills: string[]; relatedSkills: string[];
    keywords: string[]; cpvCodes: string[]; duration: string; hours: number;
    modality: string; deliveryModes: string[]; certification: string | null;
    intraOnly: boolean; programme: { heading: string; items: string[] }[];
    evaluation: string | null; sourceDocument: string; catalogPage: number; sourceUrl: string;
  }[];
};

/** Identifiants des domaines, partagés par les trois familles du référentiel. */
const domainIds = new Map<string, string>();

async function seedCatalogue() {
  const file = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../src/data/catalogue-esme.json"), "utf8"),
  ) as CatalogueFile;

  for (const [index, domain] of file.domains.entries()) {
    const row = await prisma.trainingDomain.upsert({
      where: { slug: domain.slug },
      create: {
        slug: domain.slug, name: domain.name, longName: domain.longName,
        intro: domain.intro, position: index,
      },
      update: { name: domain.name, longName: domain.longName, intro: domain.intro, position: index },
    });
    domainIds.set(domain.slug, row.id);
  }

  for (const training of file.trainings) {
    const data = {
      slug: training.slug,
      title: training.title,
      domainId: domainIds.get(training.domainSlug) ?? null,
      theme: training.theme,
      objective: training.objective,
      audience: training.audience,
      objectives: training.objectives,
      prerequisites: training.prerequisites,
      methods: training.methods,
      highlights: training.highlights,
      skills: training.skills,
      relatedSkills: training.relatedSkills,
      keywords: training.keywords,
      cpvCodes: training.cpvCodes,
      duration: training.duration,
      hours: training.hours,
      modality: training.modality,
      deliveryModes: training.deliveryModes,
      certification: training.certification,
      intraOnly: training.intraOnly,
      programme: training.programme as unknown as Prisma.InputJsonValue,
      evaluation: training.evaluation,
      sourceDocument: training.sourceDocument,
      catalogPage: training.catalogPage,
      sourceUrl: training.sourceUrl,
    };
    await prisma.training.upsert({
      where: { origin_code: { origin: "CATALOGUE_ESME", code: training.code } },
      create: { origin: "CATALOGUE_ESME", code: training.code, ...data },
      update: data,
    });
  }

  console.log(`  catalogue ESME : ${file.trainings.length} formations, ${file.domains.length} domaines`);
}

async function seedVoisines() {
  for (const voisine of formationsVoisines) {
    const data = {
      slug: voisine.slug,
      title: voisine.title,
      // Une fiche voisine relève d'un domaine du catalogue : sans ce
      // rattachement, les restitutions par domaine la classeraient à part,
      // comme si « formation voisine » était un domaine.
      domainId: domainIds.get(voisine.domainSlug) ?? null,
      theme: voisine.theme,
      objective: voisine.objective,
      audience: voisine.audience,
      objectives: voisine.skills,
      skills: voisine.skills,
      relatedSkills: voisine.relatedSkills,
      keywords: voisine.keywords,
      cpvCodes: voisine.cpvCodes,
      deliveryModes: ["Présentiel", "Distanciel", "Hybride"],
      // La fiche porte explicitement son statut : point d'appui, pas offre validée.
      highlights: [
        `Adaptation à construire à partir des fiches catalogue : ${voisine.anchors.join(", ")}.`,
        "Compétence voisine : à valider par l'ingénierie pédagogique avant tout engagement.",
      ],
      sourceDocument: "Référentiel interne TENDERA — formations voisines",
    };
    await prisma.training.upsert({
      where: { origin_code: { origin: "VOISINE", code: voisine.code } },
      create: { origin: "VOISINE", code: voisine.code, ...data },
      update: data,
    });
  }
  console.log(`  formations voisines : ${formationsVoisines.length} fiches`);
}

async function seedIonis() {
  let capabilityCount = 0;
  for (const institution of ionisInstitutions) {
    const row = await prisma.institution.upsert({
      where: { slug: institution.slug },
      create: {
        slug: institution.slug, name: institution.name, shortName: institution.shortName,
        description: institution.description, domains: institution.domains,
        skills: institution.skills, programmes: institution.programmes,
        audiences: institution.audiences, modalities: institution.modalities,
        cooperation: institution.cooperation, sourceUrl: institution.sourceUrl,
      },
      update: {
        name: institution.name, shortName: institution.shortName,
        description: institution.description, domains: institution.domains,
        skills: institution.skills, programmes: institution.programmes,
        audiences: institution.audiences, modalities: institution.modalities,
        cooperation: institution.cooperation, sourceUrl: institution.sourceUrl,
      },
    });

    for (const capability of institution.capabilities) {
      const data = {
        slug: `ionis-${institution.slug}-${capability.code.toLowerCase()}`,
        title: capability.title,
        // IONIS est un groupe, pas un domaine : la compétence est rattachée au
        // domaine métier qu'elle couvre.
        domainId: domainIds.get(capability.domainSlug) ?? null,
        theme: capability.theme,
        objective: capability.objective,
        audience: institution.audiences.join(", "),
        objectives: capability.skills,
        skills: capability.skills,
        relatedSkills: institution.skills,
        keywords: capability.keywords,
        cpvCodes: capability.cpvCodes,
        deliveryModes: institution.modalities,
        institutionId: row.id,
        highlights: [
          `Compétence portée par ${institution.shortName}.`,
          "Aucun établissement ne peut engager un autre établissement du groupe : accord formel requis.",
        ],
        sourceDocument: "Cartographie IONIS — ionis-group.com",
        sourceUrl: institution.sourceUrl,
      };
      await prisma.training.upsert({
        where: { origin_code: { origin: "IONIS", code: capability.code } },
        create: { origin: "IONIS", code: capability.code, ...data },
        update: data,
      });
      capabilityCount += 1;
    }
  }
  console.log(
    `  Groupe IONIS : ${ionisInstitutions.length} établissements, ${capabilityCount} fiches de compétences`,
  );
}

async function seedConnectors() {
  for (const connector of connectorRegistry) {
    await prisma.sourceConnector.upsert({
      where: { key: connector.key },
      create: {
        key: connector.key, name: connector.name, baseUrl: connector.baseUrl,
        description: connector.description, status: connector.status,
        requirement: connector.requirement, enabled: connector.enabledByDefault,
        config: (connector.defaultConfig ?? {}) as Prisma.InputJsonValue,
      },
      // Le statut déclaré par le code fait foi : si un connecteur passe de
      // « à implémenter » à « opérationnel », la base suit.
      update: {
        name: connector.name, baseUrl: connector.baseUrl,
        description: connector.description, status: connector.status,
        requirement: connector.requirement,
      },
    });
  }
  console.log(`  connecteurs de veille : ${connectorRegistry.length} enregistrés`);
}

async function seedUsers() {
  const accounts = [
    { email: "admin@esme.fr", name: "Administrateur TENDERA", role: "ADMINISTRATEUR" as const, jobTitle: "Administration de la plateforme" },
    { email: "responsable.ao@esme.fr", name: "Responsable appels d'offres", role: "RESPONSABLE_AO" as const, jobTitle: "Responsable appels d'offres" },
    { email: "redacteur@esme.fr", name: "Rédacteur", role: "REDACTEUR" as const, jobTitle: "Chargé de réponse aux consultations" },
    { email: "expert@esme.fr", name: "Expert pédagogique", role: "EXPERT_PEDAGOGIQUE" as const, jobTitle: "Ingénierie pédagogique" },
    { email: "relecteur@esme.fr", name: "Relecteur", role: "RELECTEUR" as const, jobTitle: "Relecture et conformité" },
    { email: "lecteur@esme.fr", name: "Lecteur", role: "LECTEUR" as const, jobTitle: "Consultation" },
  ];

  // Mot de passe de démarrage, à changer à la première connexion.
  const password = process.env.TENDERA_SEED_PASSWORD ?? "Tendera2026!";
  const passwordHash = await bcrypt.hash(password, 12);

  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      create: { ...account, passwordHash },
      update: { name: account.name, role: account.role, jobTitle: account.jobTitle },
    });
  }
  console.log(`  comptes : ${accounts.length} (mot de passe initial « ${password} » — à changer)`);
}

async function seedPriceReferences() {
  // Le catalogue ESME ne publie pas de tarifs : le référentiel est créé vide,
  // avec ses seules unités, pour que personne n'ait à inventer un prix.
  const units = [
    { label: "Journée de formation inter-entreprises", unit: "jour / participant" },
    { label: "Journée de formation intra-entreprise", unit: "jour / groupe" },
    { label: "Journée d'ingénierie pédagogique", unit: "jour" },
    { label: "Heure de classe virtuelle", unit: "heure / groupe" },
    { label: "Frais de déplacement formateur", unit: "déplacement" },
  ];
  const existing = await prisma.priceReference.count();
  if (existing > 0) return;
  for (const unit of units) {
    await prisma.priceReference.create({
      data: {
        label: unit.label,
        unit: unit.unit,
        amountEur: 0,
        note: "À renseigner : aucun tarif ne figure au catalogue 2027.",
      },
    });
  }
  console.log(`  référentiel de tarifs : ${units.length} unités créées, montants à renseigner`);
}

/**
 * Affaires de démonstration.
 *
 * Elles servent à prendre en main les pipelines sans attendre une
 * synchronisation de veille. Elles sont inventées de bout en bout : d'où le
 * drapeau `isDemo`, l'absence de lien vers une source officielle et le bandeau
 * d'avertissement affiché sur chaque fiche.
 */
async function seedDemoTenders() {
  if (process.env.TENDERA_SEED_DEMO === "0") {
    console.log("  affaires de démonstration : ignorées (TENDERA_SEED_DEMO=0)");
    return;
  }
  const already = await prisma.tender.count({ where: { isDemo: true } });
  if (already > 0) {
    console.log(`  affaires de démonstration : ${already} déjà présentes`);
    return;
  }

  const owner = await prisma.user.findUnique({ where: { email: "responsable.ao@esme.fr" } });
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const demos: Prisma.TenderCreateInput[] = [
    {
      reference: "DEMO-2026-001",
      title: "Accompagnement à la transformation des compétences des agents techniques",
      buyer: "Démonstration — Communauté d'agglomération (fictive)",
      consultationRef: "DEMO-CA-2026-14",
      objectSummary:
        "Accompagnement à la montée en compétences de 120 agents techniques sur la transition énergétique du patrimoine bâti, la maîtrise de l'énergie et le pilotage des consommations. Trois lots : sensibilisation, approfondissement technique, formation de référents internes.",
      procedure: "Procédure adaptée (MAPA)",
      cpvCodes: ["80500000", "80510000"],
      publishedAt: new Date(now - 6 * day),
      deadlineAt: new Date(now + 21 * day),
      executionPlace: "Île-de-France",
      region: "Île-de-France",
      amountKind: "MAXIMUM",
      amountMaxEur: 180000,
      stage: "MATCHING",
      dceStatus: "NON_TENTE",
      isDemo: true,
      owner: owner ? { connect: { id: owner.id } } : undefined,
      lots: {
        create: [
          { number: "1", title: "Sensibilisation à la sobriété énergétique", description: "8 sessions d'une journée, 15 agents par session.", amountKind: "NON_COMMUNIQUE" },
          { number: "2", title: "Maîtrise de l'énergie des bâtiments", description: "Approfondissement technique, 4 sessions de 2 jours.", amountKind: "NON_COMMUNIQUE" },
          { number: "3", title: "Formation de référents internes", description: "Former 12 référents à l'animation interne.", amountKind: "NON_COMMUNIQUE" },
        ],
      },
    },
    {
      reference: "DEMO-2026-002",
      title: "Formation à la cybersécurité et à l'hygiène numérique des agents",
      buyer: "Démonstration — Établissement public (fictif)",
      consultationRef: "DEMO-EP-2026-07",
      objectSummary:
        "Plan de formation cybersécurité : sensibilisation de 400 agents, parcours approfondi pour 40 informaticiens, mise en conformité NIS2 et accompagnement du RSSI.",
      procedure: "Appel d'offres ouvert",
      cpvCodes: ["80500000", "80533100"],
      publishedAt: new Date(now - 12 * day),
      deadlineAt: new Date(now + 9 * day),
      executionPlace: "Distanciel et Paris",
      region: "Île-de-France",
      remoteEligible: true,
      amountKind: "ESTIME",
      amountMinEur: 90000,
      amountMaxEur: 120000,
      stage: "GO_NO_GO",
      dceStatus: "NON_TENTE",
      isDemo: true,
      owner: owner ? { connect: { id: owner.id } } : undefined,
    },
    {
      reference: "DEMO-2026-003",
      title: "Marché de formation à l'intelligence artificielle générative",
      buyer: "Démonstration — Région (fictive)",
      consultationRef: "DEMO-REG-2026-31",
      objectSummary:
        "Acculturation et montée en compétences de 250 agents sur l'IA générative : cadrage des usages, atelier de cas d'usage métier, charte d'usage interne et formation des encadrants.",
      procedure: "Accord-cadre à bons de commande",
      cpvCodes: ["80500000", "80533100"],
      publishedAt: new Date(now - 3 * day),
      deadlineAt: new Date(now + 34 * day),
      executionPlace: "Région, en présentiel et distanciel",
      remoteEligible: true,
      amountKind: "NON_COMMUNIQUE",
      stage: "AO_IDENTIFIES",
      dceStatus: "NON_TENTE",
      isDemo: true,
    },
    {
      reference: "DEMO-2026-004",
      title: "Formation management de proximité et conduite du changement",
      buyer: "Démonstration — Centre hospitalier (fictif)",
      consultationRef: "DEMO-CH-2026-02",
      objectSummary:
        "Accompagnement de 60 cadres de proximité : posture managériale, conduite d'entretien, gestion des situations difficiles et accompagnement d'une réorganisation de service.",
      procedure: "Procédure adaptée (MAPA)",
      cpvCodes: ["80500000", "80532000"],
      publishedAt: new Date(now - 30 * day),
      deadlineAt: new Date(now - 2 * day),
      executionPlace: "Hauts-de-France",
      region: "Hauts-de-France",
      amountKind: "MAXIMUM",
      amountMaxEur: 48000,
      stage: "DEPOT_EFFECTUE",
      outcome: "EN_ATTENTE",
      dceStatus: "NON_TENTE",
      isDemo: true,
      owner: owner ? { connect: { id: owner.id } } : undefined,
    },
  ];

  for (const demo of demos) {
    await prisma.tender.create({ data: demo });
  }
  console.log(`  affaires de démonstration : ${demos.length} créées (marquées « démonstration »)`);
}

async function main() {
  console.log("Initialisation de la base ESME TENDERA…");
  await seedCatalogue();
  await seedVoisines();
  await seedIonis();
  await seedConnectors();
  await seedUsers();
  await seedPriceReferences();
  await seedDemoTenders();
  console.log("Terminé.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
