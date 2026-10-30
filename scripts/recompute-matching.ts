/**
 * Recalcule le matching de toutes les affaires.
 *
 * Utile après une mise à jour du référentiel, un changement de pondération, ou
 * une évolution du moteur : l'interface propose le recalcul des affaires
 * actives, ce script couvre l'ensemble du portefeuille, archives comprises.
 *
 *     npx tsx scripts/recompute-matching.ts
 */
import { PrismaClient } from "@prisma/client";

import { runMatching } from "../src/lib/matching/engine";
import { natureLabels } from "../src/lib/labels";

const prisma = new PrismaClient();

async function main() {
  const [trainings, setting] = await Promise.all([
    prisma.training.findMany({ where: { archived: false } }),
    prisma.setting.findUnique({ where: { key: "scoring" } }),
  ]);

  if (trainings.length === 0) {
    console.error("Référentiel vide : lancez d'abord « npm run db:seed ».");
    process.exitCode = 1;
    return;
  }

  const weights = (setting?.value as { catalogue: number; voisines: number; ionis: number } | null) ?? {
    catalogue: 60,
    voisines: 25,
    ionis: 15,
  };

  const tenders = await prisma.tender.findMany({
    include: { lots: true, analysis: true },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  let failed = 0;

  for (const tender of tenders) {
    const outcome = runMatching(
      {
        title: tender.title,
        objectSummary: tender.objectSummary,
        buyer: tender.buyer,
        cpvCodes: tender.cpvCodes,
        marketTypes: tender.marketTypes,
        lots: tender.lots.map((lot) => ({
          number: lot.number,
          title: lot.title,
          description: lot.description,
        })),
        analysis: tender.analysis
          ? {
              objet: tender.analysis.objet,
              besoin: tender.analysis.besoin,
              publics: tender.analysis.publics,
              modalites: tender.analysis.modalites,
              certifications: tender.analysis.certifications,
              volumeHoraire: tender.analysis.volumeHoraire,
            }
          : null,
      },
      trainings,
      weights,
    );

    const data = {
      scoreCatalogue: outcome.scoreCatalogue,
      scoreVoisines: outcome.scoreVoisines,
      scoreIonis: outcome.scoreIonis,
      scoreGlobal: outcome.scoreGlobal,
      isFormation: outcome.isFormation,
      formationSignals: outcome.formationSignals,
      nature: outcome.nature,
      natureLabel: outcome.natureLabel,
      coveredSkills: outcome.coveredSkills,
      missingSkills: outcome.missingSkills,
      adaptableNote: outcome.adaptableNote,
      ionisNote: outcome.ionisNote,
      extraResources: outcome.extraResources,
      constraints: outcome.constraints,
      recommendation: outcome.recommendation,
      caveats: outcome.caveats,
      engine: outcome.engine,
      computedAt: new Date(),
    };

    try {
      // Une affaire sans résultat de matching en reçoit un : c'est le cas des
      // affaires importées avant la mise en service du moteur.
      await prisma.matchResult.upsert({
        where: { tenderId: tender.id },
        create: { tenderId: tender.id, weights, ...data },
        update: data,
      });
      updated += 1;
    } catch (error) {
      failed += 1;
      console.error(`  ${tender.reference} : ${(error as Error).message}`);
    }
  }

  console.log(`${updated} affaire(s) recalculée(s)${failed > 0 ? `, ${failed} en échec` : ""}.`);

  const counts = await prisma.matchResult.groupBy({ by: ["nature"], _count: { _all: true } });
  console.log("\nRépartition par appréciation :");
  for (const row of counts.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${natureLabels[row.nature].padEnd(38)} ${row._count._all}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
