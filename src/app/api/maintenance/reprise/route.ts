import { NextResponse } from "next/server";

import { repriseSelection, type Ligne } from "@/lib/veille/reprise";

// Près de quatre-vingts appels au BOAMP : la minute du plan Hobby suffit tout
// juste, et une reprise plus large devra être découpée en plusieurs appels.
export const maxDuration = 60;

/**
 * Reprise d'une sélection d'affaires depuis les sources officielles.
 *
 * Reçoit les lignes d'un tri fait à la main qui n'ont pas retrouvé leur
 * affaire dans le pipeline, va chercher chacune chez sa source, et crée la
 * fiche à partir de l'avis publié — jamais à partir de la ligne du tableau.
 *
 * Le détail du raisonnement est dans `src/lib/veille/reprise.ts`.
 *
 *     POST /api/maintenance/reprise
 *     { "lignes": [ { acheteur, objet, decision, limite, lien, identifiant, source } ] }
 *     { "lignes": [...], "appliquer": true }
 *
 * Sans « appliquer », rien n'est écrit : le rapport dit ce qui serait créé et,
 * surtout, ce qui ne serait pas retrouvé. C'est cette seconde liste qui
 * compte, parce qu'elle désigne les lignes qu'il faudra traiter autrement.
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

  const corps = (await request.json().catch(() => null)) as
    | { lignes?: unknown; appliquer?: unknown }
    | null;
  const brutes = Array.isArray(corps?.lignes) ? corps.lignes : null;
  if (!brutes || brutes.length === 0) {
    return NextResponse.json(
      { erreur: "Fournissez « lignes » : les lignes du tri à reprendre." },
      { status: 400 },
    );
  }
  if (brutes.length > 100) {
    return NextResponse.json(
      { erreur: "Au plus 100 lignes par appel : chaque ligne peut coûter une requête au BOAMP." },
      { status: 400 },
    );
  }

  const lignes: Ligne[] = brutes.map((brute) => {
    const l = (brute ?? {}) as Record<string, unknown>;
    const texte = (cle: string) => (typeof l[cle] === "string" ? (l[cle] as string) : "");
    const source = texte("source");
    return {
      acheteur: texte("acheteur"),
      objet: texte("objet"),
      decision: texte("decision"),
      limite: texte("limite"),
      remarques: texte("remarques"),
      lien: texte("lien"),
      identifiant: typeof l.identifiant === "string" ? l.identifiant : null,
      source: source === "BOAMP" || source === "TED" ? source : "INCONNU",
    };
  });

  try {
    const rapport = await repriseSelection(lignes, { appliquer: corps?.appliquer === true });
    return NextResponse.json(rapport);
  } catch (error) {
    return NextResponse.json({ erreur: (error as Error).message }, { status: 502 });
  }
}
