import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { PLOT_STATUS_COLOR, PLOT_STATUS_LABEL } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "gold" | "ghost" | "danger" | "outline";
// Hologram design: moving gradients + 3D depth (see "HOLOGRAM DESIGN LAYER" in globals.css).
const variants: Record<Variant, string> = {
  primary: "btn-holo btn-primary-holo",
  gold: "btn-holo btn-gold-holo",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110 shadow-sm",
  outline: "btn-holo btn-outline-holo",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    />
  );
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      {...props}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition", variants[variant], className)}
    />
  );
}

export function Card({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} className={cx("card", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-0.5 hidden text-xs font-bold uppercase tracking-[0.18em] text-gold sm:block">{eyebrow}</div>}
        <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-0.5 line-clamp-2 max-w-3xl text-xs text-muted sm:mt-1 sm:line-clamp-none sm:text-sm">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 [&>*]:min-h-10 max-sm:[&>*]:px-3 max-sm:[&>*]:py-1.5 max-sm:[&>*]:text-xs">{actions}</div>}
    </div>
  );
}

const toneClass = {
  neutral: "bg-surface-2 text-muted border-border",
  success: "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success border-[color-mix(in_srgb,var(--success)_30%,transparent)]",
  warning: "bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-warning border-[color-mix(in_srgb,var(--warning)_30%,transparent)]",
  danger: "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger border-[color-mix(in_srgb,var(--danger)_30%,transparent)]",
  info: "bg-[color-mix(in_srgb,var(--info)_12%,transparent)] text-info border-[color-mix(in_srgb,var(--info)_30%,transparent)]",
  gold: "bg-gold-soft text-gold-strong border-[color-mix(in_srgb,var(--gold)_35%,transparent)]",
} as const;
export type Tone = keyof typeof toneClass;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function PlotStatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLOT_STATUS_COLOR[status] ?? "#999" }} aria-hidden />
      {PLOT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  active: "success", confirmed: "success", completed: "info", verified: "success", delivered: "success", paid: "success", approved: "success",
  processed: "success", accepted: "success", matched: "success", scheduled: "info", launched: "success",
  pending: "warning", payment_pending: "warning", pending_approval: "warning", calculated: "warning", submitted: "warning", draft: "neutral",
  requested: "warning", finance_requested: "info", settled: "info", received: "info", queued: "info", upcoming: "info",
  failed: "danger", dead_letter: "danger", rejected: "danger", cancelled: "neutral", expired: "neutral", reversed: "neutral",
  mismatch: "danger", paused: "neutral", archived: "neutral", skipped: "neutral", superseded: "neutral", ignored: "neutral",
  no_show: "danger", on_hold: "neutral", sold_out: "info", resigned: "neutral", terminated: "danger", on_leave: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Stat({ label, value, hint, accent }: { label: ReactNode; value: ReactNode; hint?: ReactNode; accent?: "gold" | "primary" }) {
  return (
    <div className={cx("card card-holo relative overflow-hidden p-3 sm:p-4", accent === "gold" && "shadow-[var(--glow)]")}>
      <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted sm:text-xs">{label}</div>
      <div className={cx("mt-1 text-xl font-extrabold tracking-tight sm:mt-1.5 sm:text-2xl", accent && "holo-text")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="h-10 w-10 rounded-full bg-gold-soft" aria-hidden />
      <div className="font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-sm", toneClass[tone])}>
      {title && <div className="mb-0.5 font-bold">{title}</div>}
      <div className="text-text/90">{children}</div>
    </div>
  );
}

export function Field({ label, htmlFor, children, hint, error }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Text brand mark (temporary until an approved logo is uploaded). Uploaded logos are shown unmodified. */
export function BrandMark({ name, logoUrl, logoWidth, logoHeight, compact }: { name: string; logoUrl?: string | null; logoWidth?: number | null; logoHeight?: number | null; compact?: boolean }) {
  if (logoUrl) {
    const h = compact ? 28 : 36;
    const w = logoWidth && logoHeight ? Math.round((logoWidth / logoHeight) * h) : h * 3;
    // eslint-disable-next-line @next/next/no-img-element -- tenant logos are served as uploaded, preserving proportions
    return <img src={logoUrl} alt={name} width={w} height={h} style={{ height: h, width: "auto", maxWidth: 180, objectFit: "contain" }} />;
  }
  return (
    <span className="inline-flex items-center gap-2 font-extrabold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#f3dc8a] via-[#c9a227] to-[#8f6d10] text-sm text-[#1b1400]" aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
      {!compact && <span className="text-[1.05rem] leading-tight">{name}</span>}
    </span>
  );
}
