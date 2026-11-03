import { NextResponse } from "next/server";

import { autoriserMaintenance } from "@/lib/maintenance-auth";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export const maxDuration = 60;

/**
 * Archivage des consultations dont la date limite est passée.
 *
 * Une veille sur trente jours ramène forcément des avis déjà clos. Ils
 * encombrent le pipeline sans qu'on puisse plus rien en faire : il n'y a plus
 * d'offre à déposer.
 *
 * Elles sont **archivées, pas supprimées**. La différence compte : une
 * consultation vue puis écartée fait partie de l'historique de la cellule, et
 * sert à répondre l'année suivante à « avions-nous vu passer ce marché ? ».
 * Les archives restent consultables par la case « Archives » du filtre, et le
 * geste se défait affaire par affaire.
 *
 * Les affaires sur lesquelles un travail est engagé sont épargnées, même
 * lorsque leur date limite est passée : un dépôt effectué, une négociation en
 * cours ou un résultat attendu survivent tous à l'échéance de remise des plis.
 * Les archiver ferait disparaître du pipeline le travail en cours.
 */

/**
 * Lit une date passée en paramètre d'URL.
 *
 * Dans une chaîne de requête, « + » signifie espace : un décalage horaire
 * « 2026-11-03T00:00:00+01:00 » non encodé arrive donc en
 * « 2026-11-03T00:00:00 01:00 », que `Date` refuse. Plutôt que de renvoyer
 * une erreur sur une URL que presque tout le monde écrira ainsi, on restaure
 * le signe.
 */
function lireDate(valeur: string | null): Date | null {
  if (!valeur) return null;
  const restaure = valeur.replace(/(T\d{2}:\d{2}(?::\d{2})?) (\d{2}:\d{2})$/, "$1+$2");
  const date = new Date(restaure);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Étapes où rien n'est encore engagé : seules celles-là sont archivables. */
const ETAPES_SANS_ENGAGEMENT = [
  "AO_IDENTIFIES",
  "MATCHING",
  "GO_NO_GO",
  "REJETE_NON_POURSUIVI",
] as const;

export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;
  const { par } = autorisation;

  const url = new URL(request.url);

  // La borne est fournie par l'appelant plutôt que déduite ici : « demain »
  // dépend du fuseau de celui qui le dit, et le serveur n'a pas à le deviner.
  const avant = lireDate(url.searchParams.get("avant")) ?? new Date();

  const taille = Math.min(Math.max(Number(url.searchParams.get("taille") ?? 100) || 100, 1), 500);

  // Une affaire sans date limite n'est pas échue : on ne sait simplement pas
  // quand elle se ferme. L'archiver reviendrait à traiter une information
  // manquante comme une information.
  const candidates: Prisma.TenderWhereInput = {
    archived: false,
    deadlineAt: { not: null, lt: avant },
    stage: { in: [...ETAPES_SANS_ENGAGEMENT] },
  };

  const paquet = await prisma.tender.findMany({
    where: candidates,
    select: { id: true, reference: true },
    orderBy: { deadlineAt: "asc" },
    take: taille,
  });

  if (paquet.length > 0) {
    await prisma.tender.updateMany({
      where: { id: { in: paquet.map((tender) => tender.id) } },
      data: { archived: true },
    });

    // Une trace par affaire, pas une seule pour le lot : c'est sur la fiche
    // que l'on cherchera pourquoi elle a disparu du pipeline.
    for (const tender of paquet) {
      await recordAudit({
        action: "tender.archive",
        entity: "Tender",
        entityId: tender.id,
        tenderId: tender.id,
        actor: par.acteur,
        userId: par.userId ?? undefined,
        summary: `Archivée automatiquement : date limite dépassée au ${avant.toISOString().slice(0, 10)}.`,
      });
    }
  }

  const restantes = await prisma.tender.count({ where: candidates });

  return NextResponse.json({
    avant: avant.toISOString(),
    archivees: paquet.length,
    restantes,
    termine: restantes === 0,
  });
}

/** GET : ce que l'archivage ferait, sans rien changer. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const avant = lireDate(url.searchParams.get("avant")) ?? new Date();

  const [archivables, engagees, sansDate, dejaArchivees] = await Promise.all([
    prisma.tender.count({
      where: {
        archived: false,
        deadlineAt: { not: null, lt: avant },
        stage: { in: [...ETAPES_SANS_ENGAGEMENT] },
      },
    }),
    prisma.tender.count({
      where: {
        archived: false,
        deadlineAt: { not: null, lt: avant },
        stage: { notIn: [...ETAPES_SANS_ENGAGEMENT] },
      },
    }),
    prisma.tender.count({ where: { archived: false, deadlineAt: null } }),
    prisma.tender.count({ where: { archived: true } }),
  ]);

  return NextResponse.json({
    avant: avant.toISOString(),
    archivables,
    epargneesCarEngagees: engagees,
    sansDateLimite: sansDate,
    dejaArchivees,
    methode: "POST",
    parametres: "avant (date ISO), taille (1–500, défaut 100)",
  });
}
