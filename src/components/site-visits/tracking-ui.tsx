import { Check, ShieldCheck } from "lucide-react";
import { Badge, cx, type Tone } from "@/components/ui";
import { STAGE_FLOW, STAGE_LABELS, stageIndex, type TrackingStage } from "@/lib/geo";

/** Hook-free presentational pieces shared by the server views and the client trip tracker. */

const STAGE_TONE: Record<TrackingStage, Tone> = {
  not_started: "neutral",
  trip_started: "info",
  arrived_site: "gold",
  visit_in_progress: "gold",
  visit_completed: "success",
  left_site: "info",
  returned: "success",
  cancelled: "danger",
};

export function StageBadge({ stage }: { stage: string }) {
  const s = stage as TrackingStage;
  return <Badge tone={STAGE_TONE[s] ?? "neutral"}>{STAGE_LABELS[s] ?? stage}</Badge>;
}

const STEP_LABELS: Record<string, string> = {
  trip_started: "Trip started",
  arrived_site: "Arrived",
  visit_in_progress: "Visit started",
  visit_completed: "Visit completed",
  left_site: "Left site",
  returned: "Returned",
};

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : null;

/** Vertical (mobile) / horizontal (desktop) stage stepper with the time each stage was reached. */
export function StageStepper({ stage, times }: { stage: string; times: Partial<Record<string, string | null>> }) {
  const current = stageIndex(stage);
  const cancelled = stage === "cancelled";
  const steps = STAGE_FLOW.slice(1);
  return (
    <ol className="grid gap-2 sm:grid-cols-6" aria-label="Trip stages">
      {steps.map((s, i) => {
        const idx = i + 1;
        const done = !cancelled && current >= idx;
        const isCurrent = !cancelled && current === idx;
        const t = fmt(times[s]);
        return (
          <li key={s} aria-current={isCurrent ? "step" : undefined}
            className={cx("flex items-center gap-2 rounded-xl border px-3 py-2 sm:flex-col sm:items-start",
              done ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)]" : "border-border bg-surface",
              isCurrent && "ring-2 ring-gold")}>
            <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-success text-white" : "bg-surface-2 text-muted")}>
              {done ? <Check size={14} aria-hidden /> : idx}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{STEP_LABELS[s]}</span>
              <span className="block text-xs text-muted">{t ?? (done ? "—" : "Pending")}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The honest constraints of browser-based tracking, shown wherever tracking appears. */
export function TrackingPrivacyNotice({ retentionNote, compact }: { retentionNote?: string; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3 text-xs text-muted">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-text"><ShieldCheck size={14} className="text-success" aria-hidden />How trip tracking works</div>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>Location is recorded <strong>only during a site-visit trip the employee starts</strong>, after their consent, and stops when the trip ends or is cancelled. Nothing is tracked outside trips.</li>
        <li>This is a web app: the browser shares GPS <strong>only while the tracker page is open in the foreground</strong>. Continuous background tracking would need a native mobile app.</li>
        {!compact && <li>Visible only to the employee, managers above them in the reporting chain, and organization admins / venture managers — never to peers, other teams or customers.</li>}
        {!compact && retentionNote && <li>{retentionNote}</li>}
      </ul>
    </div>
  );
}
