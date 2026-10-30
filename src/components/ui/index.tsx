import type { ComponentProps, ReactNode } from "react";

/**
 * Primitives du design system ESME TENDERA.
 *
 * Toutes les couleurs proviennent des jetons définis dans globals.css, eux-mêmes
 * issus de la mini-charte ESME Executive Education. Aucune couleur n'est écrite
 * en dur dans un composant.
 */

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export { cx };

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "accent" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-55";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-esme-600 text-white hover:bg-esme-700 active:bg-esme-800",
  secondary:
    "border border-ink-300 bg-white text-esme-800 hover:border-esme-400 hover:bg-esme-50",
  ghost: "text-esme-700 hover:bg-esme-50",
  accent: "bg-framboise-400 text-white hover:bg-framboise-500 active:bg-framboise-600",
  danger: "bg-danger-500 text-white hover:bg-danger-600",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    />
  );
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"a"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Cartes et sections
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cx(
        "rounded-2xl border border-ink-200 bg-white shadow-[0_1px_2px_rgb(17_27_69/0.04)]",
        className,
      )}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-esme-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-200 bg-white px-6 py-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-esme-900">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Badges et pastilles d'état
// ---------------------------------------------------------------------------

type BadgeTone = "neutral" | "esme" | "accent" | "ok" | "warn" | "danger" | "violet";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-600 ring-ink-200",
  esme: "bg-esme-50 text-esme-700 ring-esme-200",
  accent: "bg-framboise-50 text-framboise-700 ring-framboise-200",
  ok: "bg-ok-50 text-ok-700 ring-ok-100",
  warn: "bg-warn-50 text-warn-700 ring-warn-100",
  danger: "bg-danger-50 text-danger-700 ring-danger-100",
  violet: "bg-mauve-300/25 text-violet-700 ring-mauve-300/50",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    />
  );
}

/** Pastille de score : la couleur double un chiffre, elle ne le remplace jamais. */
export function ScorePill({ value, label, size = "md" }: { value: number; label?: string; size?: "sm" | "md" }) {
  const tone: BadgeTone = value >= 70 ? "ok" : value >= 45 ? "warn" : "neutral";
  return (
    <Badge tone={tone} className={cx("tabular-nums", size === "sm" ? "text-[11px]" : "text-xs")}>
      {label ? <span className="font-normal opacity-80">{label}</span> : null}
      <span className="font-semibold">{Math.round(value)}</span>
      <span className="opacity-60">/100</span>
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------

const FIELD_BASE =
  "w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-800 " +
  "placeholder:text-ink-400 focus:border-esme-400 focus:outline-none focus:ring-2 focus:ring-esme-400/25 " +
  "disabled:bg-ink-50 disabled:text-ink-400";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(FIELD_BASE, "h-10", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(FIELD_BASE, "min-h-24 resize-y leading-relaxed", className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(FIELD_BASE, "h-10 pr-8", className)} />;
}

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-[13px] font-medium text-ink-700">
        {label}
        {required ? <span className="ml-0.5 text-framboise-500">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table {...props} className={cx("w-full border-collapse text-sm", className)} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      {...props}
      className={cx(
        "border-b border-ink-200 bg-ink-50 px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-500",
        className,
      )}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td {...props} className={cx("border-b border-ink-100 px-3 py-2.5 align-top", className)} />;
}

// ---------------------------------------------------------------------------
// Messages et états vides
// ---------------------------------------------------------------------------

type NoticeTone = "info" | "warn" | "danger" | "ok";

const NOTICE_TONES: Record<NoticeTone, string> = {
  info: "border-esme-200 bg-esme-50 text-esme-800",
  warn: "border-warn-100 bg-warn-50 text-warn-700",
  danger: "border-danger-100 bg-danger-50 text-danger-700",
  ok: "border-ok-100 bg-ok-50 text-ok-700",
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-[13px] leading-relaxed", NOTICE_TONES[tone], className)}>
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-semibold text-esme-900">{title}</p>
      {description ? <p className="max-w-md text-[13px] text-ink-500">{description}</p> : null}
      {action}
    </div>
  );
}

/** Bandeau des affaires de démonstration : jamais confondues avec le réel. */
export function DemoBanner() {
  return (
    <Notice tone="warn" title="Donnée de démonstration">
      Cette affaire a été créée par le jeu de démonstration. Elle ne correspond à aucune consultation
      réelle : acheteur, montants et dates sont fictifs.
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Barre de progression
// ---------------------------------------------------------------------------

export function Meter({ value, tone = "esme" }: { value: number; tone?: "esme" | "accent" | "ok" | "warn" | "danger" }) {
  const colors = {
    esme: "bg-esme-600",
    accent: "bg-framboise-400",
    ok: "bg-ok-500",
    warn: "bg-warn-500",
    danger: "bg-danger-500",
  } as const;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cx("h-full rounded-full transition-[width]", colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
