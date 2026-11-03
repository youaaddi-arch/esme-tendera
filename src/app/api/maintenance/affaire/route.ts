import { NextResponse } from "next/server";

import { autoriserMaintenance } from "@/lib/maintenance-auth";
import { createManualTender } from "@/lib/tender-manuel";

export const maxDuration = 30;

/**
 * Création d'une affaire à la main, par appel.
 *
 * Le formulaire de l'application fait déjà cela, et c'est la voie normale.
 * Cette route sert le cas où la saisie accompagne une reprise en lot : on
 * reporte un tri fait ailleurs, et deux ou trois de ses lignes désignent des
 * marchés qu'aucune source ouverte ne publie. Les ressaisir un par un dans le
 * formulaire pendant qu'on reprend le reste par appel n'a pas de sens.
 *
 * Elle n'invente rien, et c'est tout l'enjeu. La fiche porte exactement les
 * champs reçus : pas de CPV déduits du libellé, pas de montant supposé, pas de
 * lots fabriqués. Une affaire saisie à la main est maigre, et il vaut mieux
 * qu'elle le paraisse — une fiche d'apparence complète dont la moitié des
 * champs sont devinés est plus dangereuse qu'une fiche visiblement sommaire.
 *
 * Elle exige une session d'administrateur : une fiche manuelle a un auteur,
 * et c'est lui qui répond de ce qu'elle affirme. Un jeton ne désigne personne.
 *
 *     POST /api/maintenance/affaire
 *     { "titre": "...", "acheteur": "...", "objet": "...", "limite": "2026-11-16",
 *       "reference": "26-AGR-Audits", "lienAvis": "https://…", "provenance": "…" }
 */

type Corps = Record<string, unknown>;

function texte(corps: Corps, cle: string): string | null {
  const v = corps[cle];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function date(corps: Corps, cle: string): Date | null {
  const v = texte(corps, cle);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;
  const { par } = autorisation;

  if (!par.userId) {
    return NextResponse.json(
      {
        erreur:
          "Cette route exige une session d'administrateur : une fiche saisie à la main a un auteur, " +
          "qui répond de ce qu'elle affirme, et un jeton de maintenance ne désigne personne.",
      },
      { status: 403 },
    );
  }

  const corps = (await request.json().catch(() => null)) as Corps | null;
  if (!corps) return NextResponse.json({ erreur: "Corps JSON illisible." }, { status: 400 });

  const titre = texte(corps, "titre");
  const acheteur = texte(corps, "acheteur");
  if (!titre || titre.length < 5) {
    return NextResponse.json({ erreur: "« titre » est obligatoire (5 caractères au moins)." }, { status: 400 });
  }
  if (!acheteur || acheteur.length < 2) {
    return NextResponse.json({ erreur: "« acheteur » est obligatoire." }, { status: 400 });
  }

  // Une date illisible est refusée plutôt qu'ignorée : une affaire sans date
  // limite échappe à l'archivage des échues et aux rappels d'échéance, et le
  // demandeur croirait l'avoir renseignée.
  for (const cle of ["limite", "publication"]) {
    if (texte(corps, cle) && !date(corps, cle)) {
      return NextResponse.json({ erreur: `« ${cle} » est illisible comme date.` }, { status: 400 });
    }
  }

  const affaire = await createManualTender({
    title: titre,
    buyer: acheteur,
    objectSummary: texte(corps, "objet"),
    consultationRef: texte(corps, "reference"),
    procedure: texte(corps, "procedure"),
    deadlineAt: date(corps, "limite"),
    publishedAt: date(corps, "publication"),
    sourceUrl: texte(corps, "lienAvis"),
    dceSourceUrl: texte(corps, "lienDce"),
    region: texte(corps, "region"),
    provenance: texte(corps, "provenance"),
    userId: par.userId,
  });

  return NextResponse.json({ affaire, par: par.acteur });
}
