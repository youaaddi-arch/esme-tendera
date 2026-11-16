/**
 * Export de la veille en CSV ou en classeur.
 *
 * Route de lecture plutôt qu'action de formulaire : un téléchargement n'est
 * pas une mutation, et un lien se partage, se met en favori, se rejoue. Les
 * filtres voyagent dans l'adresse, si bien qu'« à l'identique le mois
 * prochain » tient dans un signet.
 *
 * L'export ne sort que ce que la session a le droit de lire, et il est
 * journalisé : savoir qui a extrait le portefeuille, et quand, fait partie de
 * ce qu'on doit à l'établissement.
 */
import { NextResponse } from "next/server";
import type { GoNoGoStatus, PipelineStage, TenderNature } from "@prisma/client";

import { recordAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import {
  collecterExport, decrireFiltres, enXlsx, nomFichier, type FiltresExport,
} from "@/lib/veille/export";
import { enCsv } from "@/lib/veille/colonnes";

const ETAPES: PipelineStage[] = [
  "AO_IDENTIFIES", "MATCHING", "GO_NO_GO", "PREPARATION", "CONTROLE_QUALITE", "PRET_AU_DEPOT",
  "DEPOT_EFFECTUE", "NEGOCIATION", "ATTENTE_RESULTAT", "MARCHE_ATTRIBUE", "REJETE_NON_POURSUIVI",
];
const NATURES: TenderNature[] = [
  "FORMATION_CATALOGUE", "FORMATION_VOISINE", "FORMATION_REALISABLE", "FORMATION_METIER_MANUEL",
  "HORS_CHAMP",
];
const DECISIONS: GoNoGoStatus[] = ["A_DECIDER", "GO", "NO_GO"];

/** Date d'un paramètre `aaaa-mm-jj`. `fin` la porte en fin de journée. */
function date(valeur: string | null, fin = false): Date | null {
  if (!valeur) return null;
  const trouve = valeur.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!trouve) return null;
  const composee = new Date(
    Date.UTC(
      Number(trouve[1]), Number(trouve[2]) - 1, Number(trouve[3]),
      fin ? 23 : 0, fin ? 59 : 0, fin ? 59 : 0,
    ),
  );
  return Number.isNaN(composee.getTime()) ? null : composee;
}

function nombre(valeur: string | null): number | null {
  if (!valeur) return null;
  const lu = Number.parseFloat(valeur.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(lu) ? lu : null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ erreur: "Session expirée. Reconnectez-vous." }, { status: 401 });
  }
  if (!can(session.role, "tender.read")) {
    return NextResponse.json({ erreur: "Votre rôle ne permet pas de lire le portefeuille." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "xlsx" ? "xlsx" : "csv";

  const filtres: FiltresExport = {
    publieDu: date(params.get("publieDu")),
    publieAu: date(params.get("publieAu"), true),
    remiseDu: date(params.get("remiseDu")),
    remiseAu: date(params.get("remiseAu"), true),
    montantMin: nombre(params.get("montantMin")),
    montantMax: nombre(params.get("montantMax")),
    client: params.get("client")?.trim() || null,
    objet: params.get("objet")?.trim() || null,
    nature: NATURES.includes(params.get("nature") as TenderNature)
      ? (params.get("nature") as TenderNature)
      : null,
    scoreMin: nombre(params.get("scoreMin")),
    etape: ETAPES.includes(params.get("etape") as PipelineStage)
      ? (params.get("etape") as PipelineStage)
      : null,
    decision: DECISIONS.includes(params.get("decision") as GoNoGoStatus)
      ? (params.get("decision") as GoNoGoStatus)
      : null,
    source: params.get("source")?.trim() || null,
    depuisJours: nombre(params.get("depuisJours")),
    avecArchivees: params.get("archivees") === "1",
    avecDemo: params.get("demo") === "1",
  };

  const { lignes, tronque } = await collecterExport(filtres);

  await recordAudit({
    action: "veille.export",
    entity: "Tender",
    entityId: "export",
    userId: session.id,
    summary: `Export de ${lignes.length} affaire(s) en ${format.toUpperCase()} (${decrireFiltres(filtres)}).`,
  });

  const nom = nomFichier(format);
  const entetes = new Headers({
    "Content-Disposition": `attachment; filename="${nom}"`,
    "Cache-Control": "no-store",
    // Le nombre de lignes et la troncature voyagent en en-tête : l'interface
    // n'a aucun autre moyen de savoir ce que le fichier contient.
    "X-Tendera-Lignes": String(lignes.length),
    ...(tronque ? { "X-Tendera-Tronque": "1" } : {}),
  });

  if (format === "xlsx") {
    entetes.set(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const classeur = enXlsx(lignes);
    return new NextResponse(new Uint8Array(classeur), { headers: entetes });
  }

  entetes.set("Content-Type", "text/csv; charset=utf-8");
  return new NextResponse(enCsv(lignes), { headers: entetes });
}
