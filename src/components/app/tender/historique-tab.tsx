import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";

/**
 * Onglet 7 — historique.
 *
 * Toutes les actions portées sur l'affaire, dans l'ordre inverse : qui a fait
 * quoi, quand, et avec quel détail. Le journal n'est pas modifiable depuis
 * l'interface — c'est ce qui en fait une trace.
 */
export function HistoriqueTab({ tender }: { tender: TenderDetail }) {
  if (tender.auditEvents.length === 0) {
    return (
      <Card>
        <CardHeader title="Historique" />
        <div className="p-5">
          <EmptyState title="Aucune action enregistrée" description="Le journal se remplit à la première modification." />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Historique des actions"
        subtitle={`${tender.auditEvents.length} événement(s). Le journal est en lecture seule.`}
      />
      <ol className="divide-y divide-ink-100">
        {tender.auditEvents.map((event) => (
          <li key={event.id} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <time className="font-mono text-[11px] text-ink-400">{formatDateTime(event.createdAt)}</time>
              <Badge tone={actorTone(event.actor)}>{actorLabel(event.actor)}</Badge>
              <span className="text-[13px] text-ink-800">{event.summary}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {event.user?.name ?? "Système"} · {event.action}
            </p>
            {event.payload && Object.keys(event.payload as object).length > 0 ? (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-esme-600 hover:underline">Détail</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-ink-50 p-2 font-mono text-[11px] leading-relaxed text-ink-700">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function actorLabel(actor: string): string {
  if (actor === "veille") return "Veille";
  if (actor === "moteur-ia") return "Moteur";
  if (actor === "systeme") return "Système";
  return "Utilisateur";
}

function actorTone(actor: string): "esme" | "violet" | "neutral" {
  if (actor === "veille") return "esme";
  if (actor === "moteur-ia") return "violet";
  return "neutral";
}
