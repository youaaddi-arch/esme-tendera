import { NextResponse } from "next/server";

import { refreshDeadlineReminders } from "@/lib/notifications";
import { runAllConnectors } from "@/lib/veille/run";

export const maxDuration = 300;

/**
 * Synchronisation quotidienne.
 *
 * Appelée par un ordonnanceur externe (cron Vercel, systemd timer, ordonnanceur
 * interne) à l'heure configurée. L'appel doit porter le jeton en en-tête
 * `Authorization: Bearer …` ou en paramètre `?jeton=`. Sans jeton configuré, la
 * route refuse de s'exécuter plutôt que de s'ouvrir à tous.
 *
 * Deux noms de variable sont acceptés, et c'est volontaire. `TENDERA_CRON_SECRET`
 * est celui de l'application, utilisé par un ordonnanceur qu'on configure
 * soi-même. `CRON_SECRET` est celui que Vercel impose : son cron ne joint un
 * en-tête d'autorisation que si une variable portant exactement ce nom existe,
 * et il y met cette valeur-là. N'accepter que le premier nom laisserait le
 * déclencheur quotidien de la plateforme se faire refuser en 401 — c'est-à-dire
 * une veille silencieusement à l'arrêt.
 */
export async function POST(request: Request) {
  const secrets = [process.env.TENDERA_CRON_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  if (secrets.length === 0) {
    return NextResponse.json(
      {
        erreur:
          "Aucun jeton de synchronisation défini. Renseignez TENDERA_CRON_SECRET, ou CRON_SECRET pour le cron Vercel, avant d'activer la synchronisation automatique.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("jeton");
  if (!provided || !secrets.includes(provided)) {
    return NextResponse.json({ erreur: "Jeton invalide." }, { status: 401 });
  }

  const outcomes = await runAllConnectors("planifiee");
  const reminders = await refreshDeadlineReminders();

  return NextResponse.json({
    executeLe: new Date().toISOString(),
    connecteurs: outcomes.map((outcome) => ({
      source: outcome.connector,
      statut: outcome.status,
      avisRecuperes: outcome.fetched,
      affairesCreees: outcome.created,
      misesAJour: outcome.updated,
      doublons: outcome.duplicates,
      rectificatifs: outcome.rectificatifs,
      erreurs: outcome.errors,
      message: outcome.message,
    })),
    rappelsCrees: reminders,
  });
}

/** GET expose l'état de configuration, sans rien exécuter. */
export async function GET() {
  return NextResponse.json({
    configure: Boolean(process.env.TENDERA_CRON_SECRET ?? process.env.CRON_SECRET),
    // Dire lequel des deux noms est en place : un déploiement où seul
    // TENDERA_CRON_SECRET existe a une route fonctionnelle mais un cron Vercel
    // muet, et la différence ne se voit nulle part ailleurs.
    jetonApplicatif: Boolean(process.env.TENDERA_CRON_SECRET),
    jetonCronVercel: Boolean(process.env.CRON_SECRET),
    methode: "POST",
    authentification:
      "En-tête « Authorization: Bearer <jeton> », ou paramètre « ?jeton= ». Jeton = TENDERA_CRON_SECRET ou CRON_SECRET.",
  });
}
