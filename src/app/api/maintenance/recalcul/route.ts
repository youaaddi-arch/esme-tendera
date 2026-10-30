import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recomputeMatching } from "@/lib/matching/service";

export const maxDuration = 60;

/**
 * Recalcul du matching, par lots.
 *
 * Le recalcul global existe déjà dans l'administration, mais il traite tout le
 * portefeuille dans une seule requête : sur deux cents affaires et sept cents
 * lots, il dépasse la durée maximale d'une fonction et échoue en plein milieu,
 * laissant la base à moitié recalculée sans que personne sache où.
 *
 * Cette route fait le même travail par tranches. Chaque appel traite un
 * paquet et indique combien d'affaires restent : l'appelant rappelle jusqu'à
 * zéro. C'est reprenable, observable, et sans effet de bord si un appel se
 * perd.
 *
 * Le repère de progression est l'horodatage du calcul. L'appelant fixe une
 * date de référence au premier appel et la répète ensuite : toute affaire dont
 * le matching est antérieur reste à traiter. Compter les affaires déjà faites
 * serait faux dès qu'un calcul survient en parallèle — une synchronisation de
 * veille, par exemple.
 *
 * Authentification identique à la synchronisation quotidienne : cette route
 * écrit en base et n'a aucune raison d'être ouverte.
 */
export async function POST(request: Request) {
  const secrets = [process.env.TENDERA_CRON_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  if (secrets.length === 0) {
    return NextResponse.json({ erreur: "Aucun jeton de maintenance défini." }, { status: 503 });
  }

  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("jeton");
  if (!provided || !secrets.includes(provided)) {
    return NextResponse.json({ erreur: "Jeton invalide." }, { status: 401 });
  }

  const taille = Math.min(Math.max(Number(url.searchParams.get("taille") ?? 20) || 20, 1), 50);
  const depuisParam = url.searchParams.get("depuis");
  const depuis = depuisParam ? new Date(depuisParam) : new Date();
  if (Number.isNaN(depuis.getTime())) {
    return NextResponse.json({ erreur: "Paramètre « depuis » illisible." }, { status: 400 });
  }

  // Un score ajusté à la main est exclu de la sélection, et non simplement
  // ignoré au moment du calcul : ignoré, il resterait éternellement « à
  // traiter » et la progression n'atteindrait jamais zéro.
  const candidats: Prisma.TenderWhereInput = {
    archived: false,
    OR: [
      { matchResult: { is: null } },
      { matchResult: { is: { manualOverride: false, computedAt: { lt: depuis } } } },
    ],
  };

  const paquet = await prisma.tender.findMany({
    where: candidats,
    select: { id: true, reference: true },
    orderBy: { createdAt: "asc" },
    take: taille,
  });

  let traitees = 0;
  const echecs: string[] = [];
  for (const tender of paquet) {
    try {
      await recomputeMatching(tender.id, { reason: "recalcul groupé" });
      traitees += 1;
    } catch (error) {
      echecs.push(`${tender.reference} : ${(error as Error).message}`);
    }
  }

  const restantes = await prisma.tender.count({ where: candidats });

  return NextResponse.json({
    depuis: depuis.toISOString(),
    traitees,
    restantes,
    echecs,
    termine: restantes === 0,
  });
}

/** GET expose l'état d'avancement, sans rien recalculer. */
export async function GET() {
  const [affaires, lotsEvalues, lotsTotal] = await Promise.all([
    prisma.tender.count({ where: { archived: false } }),
    prisma.lot.count({ where: { matchedAt: { not: null } } }),
    prisma.lot.count(),
  ]);

  return NextResponse.json({
    affairesActives: affaires,
    lots: { evalues: lotsEvalues, total: lotsTotal },
    methode: "POST",
    parametres: "taille (1–50, défaut 20), depuis (date ISO, défaut maintenant)",
    authentification: "En-tête « Authorization: Bearer <jeton> », ou paramètre « ?jeton= ».",
  });
}
