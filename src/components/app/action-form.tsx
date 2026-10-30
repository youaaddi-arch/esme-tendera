"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Button, Notice, cx } from "@/components/ui";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

/**
 * Formulaire relié à une action serveur.
 *
 * Centralise le retour utilisateur : état en cours, message de succès ou
 * d'erreur renvoyé par l'action, et rafraîchissement de la page. Les actions
 * renvoient toujours un message en français plutôt qu'une exception brute.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = "primary",
  submitSize = "md",
  className,
  confirm,
  resetOnSuccess,
  footer,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  submitVariant?: "primary" | "secondary" | "accent" | "danger" | "ghost";
  submitSize?: "sm" | "md" | "lg";
  className?: string;
  /** Message de confirmation affiché avant exécution. */
  confirm?: string;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = event.currentTarget;
        const formData = new FormData(form);
        startTransition(async () => {
          const result = await action(formData);
          setState(result);
          if (result?.ok) {
            if (resetOnSuccess) form.reset();
            router.refresh();
          }
        });
      }}
    >
      {children}

      <div className={cx("mt-3 flex flex-wrap items-center gap-3", footer ? "justify-between" : "")}>
        <Button type="submit" variant={submitVariant} size={submitSize} disabled={pending}>
          {pending ? "En cours…" : submitLabel}
        </Button>
        {footer}
      </div>

      {state ? (
        <Notice tone={state.ok ? "ok" : "danger"} className="mt-3">
          {state.message}
        </Notice>
      ) : null}
    </form>
  );
}

/** Bouton seul relié à une action, sans champs de formulaire. */
export function ActionButton({
  action,
  label,
  pendingLabel = "En cours…",
  variant = "secondary",
  size = "sm",
  confirm,
  className,
  icon,
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "accent" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  confirm?: string;
  className?: string;
  icon?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await action();
            setState(result);
            if (result?.ok) router.refresh();
          });
        }}
      >
        {icon}
        {pending ? pendingLabel : label}
      </Button>
      {state ? (
        <Notice tone={state.ok ? "ok" : "danger"} className="mt-2">
          {state.message}
        </Notice>
      ) : null}
    </div>
  );
}

/** Sélecteur qui déclenche une action dès que la valeur change. */
export function ActionSelect({
  action,
  value,
  options,
  label,
  className,
}: {
  action: (next: string) => Promise<ActionState>;
  value: string;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className={className}>
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = current;
          setCurrent(next);
          setError(null);
          startTransition(async () => {
            const result = await action(next);
            if (result?.ok) {
              router.refresh();
            } else {
              setCurrent(previous);
              setError(result?.message ?? "Échec de la mise à jour.");
            }
          });
        }}
        className="h-8 rounded-lg border border-ink-300 bg-white px-2 text-[12px] text-ink-700 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25 disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <span className="ml-2 text-[11px] text-danger-600">{error}</span> : null}
    </span>
  );
}
