/**
 * Recalcule le matching de toutes les affaires.
 *
 * Utile après une mise à jour du référentiel, un changement de pondération, ou
 * une évolution du moteur : l'interface propose le recalcul des affaires
 * actives, ce script couvre l'ensemble du portefeuille, archives comprises.
 *
 * Il partage son calcul avec l'application, via `persistMatching`. Les deux
 * avaient leur propre copie et ont divergé — le script ne faisait plus avancer
 * l'étape du pipeline ni recopier le domaine — si bien qu'un recalcul global
 * laissait la base dans un état différent d'un recalcul depuis l'interface.
 *
 *     npx tsx scripts/recompute-matching.ts
 */
import { PrismaClient } from "@prisma/client";

import { persistMatching } from "../src/lib/matching/persist";
import { natureLabels } from "../src/lib/labels";

const prisma = new PrismaClient();

async function main() {
  const [trainings, setting] = await Promise.all([
    prisma.training.count({ where: { archived: false } }),
    prisma.setting.findUnique({ where: { key: "scoring" } }),
  ]);

  if (trainings === 0) {
    console.error("Référentiel vide : lancez d'abord « npm run db:seed ».");
    process.exitCode = 1;
    return;
  }

  // Le réglage de pondération est lu directement : le module qui l'expose à
  // l'application est réservé au serveur Next.
  const weights = (setting?.value as { catalogue: number; voisines: number; ionis: number } | null) ?? {
    catalogue: 60,
    voisines: 25,
    ionis: 15,
  };

  const tenders = await prisma.tender.findMany({
    select: { id: true, reference: true },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  let preserved = 0;
  let failed = 0;

  for (const tender of tenders) {
    try {
      // Sans « force », un score ajusté à la main n'est pas écrasé.
      const outcome = await persistMatching(prisma, tender.id, { weights, reason: "script" });
      if (outcome) updated += 1;
      else preserved += 1;
    } catch (error) {
      failed += 1;
      console.error(`  ${tender.reference} : ${(error as Error).message}`);
    }
  }

  const lots = await prisma.lot.count({ where: { matchedAt: { not: null } } });
  console.log(
    `${updated} affaire(s) recalculée(s), ${lots} lot(s) évalués` +
      `${preserved > 0 ? `, ${preserved} ajustement(s) manuel(s) préservé(s)` : ""}` +
      `${failed > 0 ? `, ${failed} en échec` : ""}.`,
  );

  const counts = await prisma.matchResult.groupBy({ by: ["nature"], _count: { _all: true } });
  console.log("\nRépartition par appréciation :");
  for (const row of counts.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${natureLabels[row.nature].padEnd(38)} ${row._count._all}`);
  }

  const domains = await prisma.matchResult.groupBy({
    by: ["topDomainName"],
    _count: { _all: true },
  });
  console.log("\nRépartition par domaine de la meilleure fiche :");
  for (const row of domains.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${(row.topDomainName ?? "(aucune correspondance)").padEnd(38)} ${row._count._all}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
