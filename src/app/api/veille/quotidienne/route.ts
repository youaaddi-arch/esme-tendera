import { NextResponse } from "next/server";

import { refreshDeadlineReminders } from "@/lib/notifications";
import { runAllConnectors } from "@/lib/veille/run";

export const maxDuration = 300;

/**
 * Synchronisation quotidienne.
 *
 * Appelée par un ordonnanceur externe (cron Vercel, systemd timer, ordonnanceur
 * interne) à l'heure configurée. L'appel doit porter le jeton
 * `TENDERA_CRON_SECRET`, en en-tête `Authorization: Bearer …` ou en paramètre
 * `?jeton=`. Sans jeton configuré, la route refuse de s'exécuter plutôt que de
 * s'ouvrir à tous.
 */
export async function POST(request: Request) {
  const secret = process.env.TENDERA_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        erreur:
          "TENDERA_CRON_SECRET n'est pas défini. Définissez-le dans l'environnement avant d'activer la synchronisation automatique.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("jeton");
  if (provided !== secret) {
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
    configure: Boolean(process.env.TENDERA_CRON_SECRET),
    methode: "POST",
    authentification: "En-tête « Authorization: Bearer <TENDERA_CRON_SECRET> », ou paramètre « ?jeton= ».",
  });
}
