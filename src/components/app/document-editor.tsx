"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, GripVertical, Plus, Save, Trash2 } from "lucide-react";

import { Badge, Button, Card, Field, Input, Notice, Textarea, cx } from "@/components/ui";
import {
  saveDocumentAction, setDocumentStatusAction, type EditableSection,
} from "@/app/(app)/affaires/[id]/documents/[docId]/actions";
import { responseDocStatusLabels } from "@/lib/labels";

/**
 * Éditeur de document de réponse.
 *
 * Les documents sont réellement modifiables : chaque section a son titre et
 * son corps, les sections s'ajoutent, se suppriment et se réordonnent, et
 * chaque enregistrement crée une version.
 *
 * Les marqueurs « [À COMPLÉTER] » sont mis en évidence mais jamais retirés
 * automatiquement : ils disparaissent quand un rédacteur écrit le contenu
 * manquant, pas avant.
 */
export function DocumentEditor({
  documentId,
  initialSections,
  status,
  canEdit,
  canValidate,
  frameworkNote,
}: {
  documentId: string;
  initialSections: EditableSection[];
  status: string;
  canEdit: boolean;
  canValidate: boolean;
  frameworkNote?: string;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<EditableSection[]>(initialSections);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const update = (index: number, patch: Partial<EditableSection>) => {
    setSections((current) => current.map((section, position) => (position === index ? { ...section, ...patch } : section)));
    setDirty(true);
  };

  const remove = (index: number) => {
    if (!window.confirm(`Supprimer la section « ${sections[index].heading} » ?`)) return;
    setSections((current) => current.filter((_, position) => position !== index));
    setDirty(true);
  };

  const add = () => {
    setSections((current) => [
      ...current,
      {
        id: `s${Date.now()}`,
        heading: "Nouvelle section",
        body: "[À COMPLÉTER]",
        origin: "manuel",
        weight: null,
        todo: [],
      },
    ]);
    setDirty(true);
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    setSections((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDirty(true);
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveDocumentAction(documentId, sections);
      setFeedback(result);
      if (result?.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  };

  const setStatus = (next: string) => {
    startTransition(async () => {
      const result = await setDocumentStatusAction(documentId, next as never);
      setFeedback(result);
      if (result?.ok) router.refresh();
    });
  };

  const remaining = sections.filter((section) => section.body.includes("[À COMPLÉTER]")).length;

  return (
    <div className="space-y-4">
      {/* --- Barre d'action collante --- */}
      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status === "VALIDE" ? "ok" : status === "EN_RELECTURE" ? "warn" : "neutral"}>
            {responseDocStatusLabels[status as keyof typeof responseDocStatusLabels] ?? status}
          </Badge>
          <span className="text-[12px] text-ink-500">
            {sections.length} section(s)
            {remaining > 0 ? ` · ${remaining} à compléter` : " · aucune lacune signalée"}
          </span>
          {dirty ? <Badge tone="accent">Modifications non enregistrées</Badge> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={add}>
                <Plus className="size-4" aria-hidden />
                Ajouter une section
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
                <Save className="size-4" aria-hidden />
                {pending ? "Enregistrement…" : "Enregistrer"}
              </Button>
              {status !== "EN_RELECTURE" ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setStatus("EN_RELECTURE")} disabled={pending}>
                  Demander une relecture
                </Button>
              ) : null}
            </>
          ) : null}
          {canValidate && status !== "VALIDE" ? (
            <Button type="button" variant="accent" size="sm" onClick={() => setStatus("VALIDE")} disabled={pending}>
              <Check className="size-4" aria-hidden />
              Valider
            </Button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <Notice tone={feedback.ok ? "ok" : "danger"}>{feedback.message}</Notice>
      ) : null}

      {frameworkNote ? <Notice tone="info" title="Cadre de réponse">{frameworkNote}</Notice> : null}

      {sections.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13px] text-ink-500">
            Ce document n&apos;a pas de sections. Ajoutez-en une, ou régénérez l&apos;espace de réponse depuis
            l&apos;onglet « Documents de réponse ».
          </p>
        </Card>
      ) : (
        <ol className="space-y-4">
          {sections.map((section, index) => (
            <li
              key={section.id}
              draggable={canEdit}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                if (dragIndex === null || !canEdit) return;
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={cx(dragIndex === index ? "opacity-50" : "")}
            >
              <Card>
                <div className="flex items-start gap-2 border-b border-ink-200 px-4 py-3">
                  {canEdit ? (
                    <span className="mt-2 cursor-grab text-ink-300" title="Réordonner" aria-hidden>
                      <GripVertical className="size-4" />
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <Input
                      value={section.heading}
                      onChange={(event) => update(index, { heading: event.target.value })}
                      disabled={!canEdit}
                      aria-label={`Titre de la section ${index + 1}`}
                      className="border-0 px-0 text-[15px] font-semibold text-esme-900 focus:ring-0"
                    />
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-ink-400">Section {index + 1}</span>
                      {section.weight !== null ? (
                        <Badge tone="esme">Critère {section.weight} %</Badge>
                      ) : null}
                      <Badge tone="neutral">{originLabel(section.origin)}</Badge>
                      {section.body.includes("[À COMPLÉTER]") ? (
                        <Badge tone="warn">À compléter</Badge>
                      ) : null}
                    </div>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="mt-1 rounded-lg p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                      title="Supprimer la section"
                    >
                      <Trash2 className="size-4" aria-hidden />
                      <span className="sr-only">Supprimer la section {section.heading}</span>
                    </button>
                  ) : null}
                </div>

                <div className="p-4">
                  <Textarea
                    value={section.body}
                    onChange={(event) => update(index, { body: event.target.value })}
                    disabled={!canEdit}
                    rows={Math.min(24, Math.max(6, section.body.split("\n").length + 2))}
                    aria-label={`Contenu de la section ${section.heading}`}
                    className="font-sans text-[13px] leading-relaxed"
                  />
                  {section.todo.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-[11px] text-warn-700">
                      {section.todo.map((todo, position) => (
                        <li key={position} className="tendera-chevron">{todo}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function originLabel(origin: string): string {
  if (origin === "cadre_impose") return "Cadre imposé";
  if (origin === "dce") return "Issu du DCE";
  if (origin === "referentiel") return "Référentiel";
  if (origin === "manuel") return "Ajout manuel";
  return "Plan de référence";
}

/** Formulaire de commentaire, utilisé sous l'éditeur. */
export function CommentForm({
  documentId,
  sections,
  action,
}: {
  documentId: string;
  sections: { id: string; heading: string }[];
  action: (formData: FormData) => Promise<{ ok: boolean; message: string } | null>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        startTransition(async () => {
          const result = await action(formData);
          setFeedback(result);
          if (result?.ok) {
            form.reset();
            router.refresh();
          }
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="documentId" value={documentId} />
      <Field label="Section visée">
        <select
          name="sectionId"
          className="h-10 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-800 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25"
        >
          <option value="">Document entier</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>{section.heading}</option>
          ))}
        </select>
      </Field>
      <Field label="Commentaire" required>
        <Textarea name="body" rows={3} required />
      </Field>
      <Field label="Proposition de réécriture" hint="Facultatif. Soumise à validation du rédacteur.">
        <Textarea name="suggestion" rows={2} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Envoi…" : "Ajouter le commentaire"}
      </Button>
      {feedback ? <Notice tone={feedback.ok ? "ok" : "danger"}>{feedback.message}</Notice> : null}
    </form>
  );
}
