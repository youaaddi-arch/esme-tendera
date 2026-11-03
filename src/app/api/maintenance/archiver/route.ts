import { NextResponse } from "next/server";

import { autoriserMaintenance } from "@/lib/maintenance-auth";

import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { proximite, SEUIL_CERTITUDE, type Ligne } from "@/lib/veille/reprise";

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
 * Un second garde-fou existe, et il répond à une inquiétude précise : la liste
 * des références à sortir a été obtenue en creux, comme le complément de ce
 * qui figure au tableau. Si une affaire n'a pas été rapprochée de sa ligne —
 * un libellé d'acheteur qui diffère suffit — elle se retrouve dans la liste
 * alors qu'elle était bel et bien retenue. C'est l'erreur la plus facile à
 * commettre ici, et la plus difficile à voir après coup.
 *
 * On peut donc joindre les lignes du tableau en « epargner ». Toute affaire
 * qui correspond à l'une d'elles est alors laissée en place, même si sa
 * référence figure dans la liste à archiver, et le rapport dit laquelle et
 * pourquoi. Le rapprochement est celui de la reprise, date limite
 * éliminatoire comprise.
 *
 *     POST /api/maintenance/archiver
 *     { "references": ["AO-2026-0012", …], "motif": "hors sélection du 03/11" }
 *     { "references": [...], "simuler": true }   → ne change rien
 *     { "references": [...], "epargner": [ {acheteur, objet, limite}, … ] }
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
  epargner?: unknown;
};

export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;
  const { par } = autorisation;

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
    select: {
      id: true, reference: true, stage: true, archived: true,
      buyer: true, title: true, objectSummary: true, deadlineAt: true,
    },
  });

  // Lignes du tableau à épargner : une affaire qui correspond à l'une d'elles
  // était retenue, et sa présence dans la liste signale un rapprochement
  // manqué, pas une consultation écartée.
  const lignes: Ligne[] = (Array.isArray(corps?.epargner) ? corps.epargner : []).map((brute) => {
    const l = (brute ?? {}) as Record<string, unknown>;
    const texte = (cle: string) => (typeof l[cle] === "string" ? (l[cle] as string) : "");
    return {
      acheteur: texte("acheteur"), objet: texte("objet"), decision: texte("decision"),
      limite: texte("limite"), remarques: texte("remarques"), lien: texte("lien"),
      identifiant: null, source: "INCONNU",
    };
  });

  const epargnees: { reference: string; ligne: string; proximite: number }[] = [];
  const correspondUneLigne = (tender: (typeof trouvees)[number]) => {
    let meilleure: { ligne: Ligne; score: number } | null = null;
    for (const ligne of lignes) {
      const score = proximite(ligne, tender);
      if (!meilleure || score > meilleure.score) meilleure = { ligne, score };
    }
    if (meilleure && meilleure.score >= SEUIL_CERTITUDE) {
      epargnees.push({
        reference: tender.reference,
        ligne: `${meilleure.ligne.acheteur} — ${meilleure.ligne.objet}`.slice(0, 160),
        proximite: Math.round(meilleure.score * 100),
      });
      return true;
    }
    return false;
  };

  const connues = new Set(trouvees.map((t) => t.reference));
  const inconnues = references.filter((r) => !connues.has(r));

  const dejaArchivees = trouvees.filter((t) => t.archived).map((t) => t.reference);
  const engagees = trouvees
    .filter((t) => !t.archived && !ETAPES_SANS_ENGAGEMENT.includes(t.stage as never))
    .map((t) => ({ reference: t.reference, etape: t.stage }));
  const aArchiver = trouvees.filter(
    (t) => !t.archived && ETAPES_SANS_ENGAGEMENT.includes(t.stage as never) && !correspondUneLigne(t),
  );

  if (simuler) {
    return NextResponse.json({
      simulation: true,
      demandees: references.length,
      archivables: aArchiver.length,
      dejaArchivees: dejaArchivees.length,
      epargneesCarEngagees: engagees,
      epargneesCarAuTableau: epargnees,
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
        actor: par.acteur,
        userId: par.userId ?? undefined,
        summary: motif ? `Archivée : ${motif}.` : "Archivée sur liste désignée.",
      });
    }
  }

  return NextResponse.json({
    archivees: aArchiver.length,
    dejaArchivees: dejaArchivees.length,
    epargneesCarEngagees: engagees,
    epargneesCarAuTableau: epargnees,
    nombreInconnues: inconnues.length,
    referencesInconnues: inconnues.slice(0, 20),
  });
}
