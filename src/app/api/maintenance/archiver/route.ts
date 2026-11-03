import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export const maxDuration = 60;

/**
 * Archivage d'une liste d'affaires désignées.
 *
 * L'autre route d'archivage applique une règle — les consultations échues.
 * Celle-ci ne décide de rien : elle reçoit la liste des références à sortir du
 * pipeline et l'applique. Le tri reste donc là où il doit être, chez celui qui
 * l'a fait, et la trace dit explicitement pourquoi chaque affaire est partie.
 *
 * Comme l'autre, elle **archive et ne supprime pas** : une consultation vue
 * puis écartée fait partie de l'historique de la cellule. Les archives
 * restent consultables par le filtre, et le geste se défait affaire par
 * affaire.
 *
 * Et comme l'autre, elle épargne les affaires sur lesquelles un travail est
 * engagé — un dépôt effectué, une négociation, un résultat attendu. Les faire
 * disparaître du pipeline sur la foi d'une liste serait le genre d'erreur
 * qu'on ne remarque que trop tard.
 *
 *     POST /api/maintenance/archiver
 *     { "references": ["AO-2026-0012", …], "motif": "hors sélection du 03/11" }
 *     { "references": [...], "simuler": true }   → ne change rien
 */

/** Étapes où rien n'est engagé : seules celles-là sont archivables. */
const ETAPES_SANS_ENGAGEMENT = [
  "AO_IDENTIFIES",
  "MATCHING",
  "GO_NO_GO",
  "REJETE_NON_POURSUIVI",
] as const;

type Corps = {
  references?: unknown;
  motif?: unknown;
  simuler?: unknown;
};

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

  const corps = (await request.json().catch(() => null)) as Corps | null;
  const brutes = Array.isArray(corps?.references) ? corps.references : null;
  if (!brutes || brutes.length === 0) {
    return NextResponse.json(
      { erreur: "Fournissez « references » : la liste des références d'affaires à archiver." },
      { status: 400 },
    );
  }

  const references = [...new Set(brutes.filter((r): r is string => typeof r === "string" && Boolean(r.trim())))];
  if (references.length > 1000) {
    return NextResponse.json({ erreur: "Au plus 1000 références par appel." }, { status: 400 });
  }

  const motif = typeof corps?.motif === "string" && corps.motif.trim() ? corps.motif.trim() : null;
  const simuler = corps?.simuler === true;

  const trouvees = await prisma.tender.findMany({
    where: { reference: { in: references } },
    select: { id: true, reference: true, stage: true, archived: true },
  });

  const connues = new Set(trouvees.map((t) => t.reference));
  const inconnues = references.filter((r) => !connues.has(r));

  const dejaArchivees = trouvees.filter((t) => t.archived).map((t) => t.reference);
  const engagees = trouvees
    .filter((t) => !t.archived && !ETAPES_SANS_ENGAGEMENT.includes(t.stage as never))
    .map((t) => ({ reference: t.reference, etape: t.stage }));
  const aArchiver = trouvees.filter(
    (t) => !t.archived && ETAPES_SANS_ENGAGEMENT.includes(t.stage as never),
  );

  if (simuler) {
    return NextResponse.json({
      simulation: true,
      demandees: references.length,
      archivables: aArchiver.length,
      dejaArchivees: dejaArchivees.length,
      epargneesCarEngagees: engagees,
      referencesInconnues: inconnues.slice(0, 20),
      nombreInconnues: inconnues.length,
    });
  }

  if (aArchiver.length > 0) {
    await prisma.tender.updateMany({
      where: { id: { in: aArchiver.map((t) => t.id) } },
      data: { archived: true },
    });

    // Une trace par affaire : c'est sur la fiche qu'on cherchera pourquoi elle
    // a quitté le pipeline, pas dans un journal global.
    for (const tender of aArchiver) {
      await recordAudit({
        action: "tender.archive",
        entity: "Tender",
        entityId: tender.id,
        tenderId: tender.id,
        actor: "maintenance",
        summary: motif ? `Archivée : ${motif}.` : "Archivée sur liste désignée.",
      });
    }
  }

  return NextResponse.json({
    archivees: aArchiver.length,
    dejaArchivees: dejaArchivees.length,
    epargneesCarEngagees: engagees,
    nombreInconnues: inconnues.length,
    referencesInconnues: inconnues.slice(0, 20),
  });
}
