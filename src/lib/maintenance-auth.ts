import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "./auth";

/**
 * Qui peut déclencher une opération de maintenance.
 *
 * Deux voies, pour deux usages qui n'ont rien à voir.
 *
 * Un **jeton** sert aux appels sans personne derrière : la tâche quotidienne
 * de Vercel, un appel depuis un terminal. Il ne désigne personne, et c'est
 * sa limite — la trace laissée dit « maintenance », ce qui est exact et
 * inutile le jour où l'on cherche qui a archivé quatre-vingt-seize affaires.
 *
 * Une **session d'administrateur** sert aux opérations décidées par quelqu'un.
 * Elle vaut mieux que le jeton sur tous les plans : elle s'obtient avec un mot
 * de passe personnel, elle se révoque en désactivant un compte, et la trace
 * porte un nom. Le jeton, lui, est le même pour tous et ne se révoque qu'en le
 * changeant partout.
 *
 * Le rôle exigé est le plus élevé. Ces routes recalculent, archivent par lots
 * et resynchronisent des connecteurs : ce sont des gestes d'exploitation, pas
 * de traitement d'affaire. Un responsable d'appels d'offres n'en a pas besoin
 * pour son travail, et les lui ouvrir élargirait la surface sans rien
 * apporter.
 */
export type Acteur = { acteur: string; userId: string | null };

export async function autoriserMaintenance(
  request: Request,
): Promise<{ ok: true; par: Acteur } | { ok: false; reponse: NextResponse }> {
  // La session d'abord : quand les deux sont présentes, c'est la personne
  // identifiée qu'on veut voir dans l'historique, pas le jeton.
  const session = await getSession();
  if (session?.role === "ADMINISTRATEUR") {
    return { ok: true, par: { acteur: session.email || session.name || "administrateur", userId: session.id } };
  }

  const secrets = [process.env.TENDERA_CRON_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );

  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const fourni = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("jeton");

  if (fourni && secrets.includes(fourni)) {
    return { ok: true, par: { acteur: "maintenance", userId: null } };
  }

  // Un refus dit laquelle des deux voies manque, sans révéler si l'autre
  // existe : une session non administratrice n'apprend pas qu'un jeton est
  // configuré, et un jeton faux n'apprend rien des comptes.
  if (session) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { erreur: "Opération réservée aux administrateurs." },
        { status: 403 },
      ),
    };
  }
  if (secrets.length === 0) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { erreur: "Connectez-vous comme administrateur, ou définissez un jeton de maintenance." },
        { status: 401 },
      ),
    };
  }
  return {
    ok: false,
    reponse: NextResponse.json(
      { erreur: "Authentification requise : session administrateur ou jeton de maintenance." },
      { status: 401 },
    ),
  };
}
