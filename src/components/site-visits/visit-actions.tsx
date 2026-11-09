"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Loader2, LocateFixed, UserRound, X, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, cx } from "@/components/ui";

type Employee = { id: string; employee_code: string; full_name: string; designation: string | null };
type Panel = null | "assign" | "reschedule" | "cancel" | "complete" | "no_show";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Staff actions on one visit. Customers only get "cancel" (see CustomerVisitCancel). */
export function VisitActions({ id, status, scheduledAt, hasEmployee }: { id: string; status: string; scheduledAt: string; hasEmployee: boolean }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState("");
  const [empQ, setEmpQ] = useState("");
  const [emps, setEmps] = useState<Employee[]>([]);
  const [outcome, setOutcome] = useState("");
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "denied" | "unavailable">("idle");

  useEffect(() => {
    if (panel === "reschedule") setWhen(toLocalInput(scheduledAt));
  }, [panel, scheduledAt]);

  useEffect(() => {
    if (panel !== "assign") return;
    const t = window.setTimeout(() => api<Employee[]>(`/api/site-visits/assignees?q=${encodeURIComponent(empQ)}`).then(setEmps).catch(() => setEmps([])), 200);
    return () => window.clearTimeout(t);
  }, [empQ, panel]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/site-visits/${id}`, { method: "PATCH", body });
      setPanel(null);
      setReason("");
      setOutcome("");
      setGeo(null);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Location is requested ONLY when the user presses the button; the browser asks for permission. */
  function captureLocation() {
    if (!("geolocation" in navigator)) return setGeoState("unavailable");
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGeoState("idle");
      },
      (e) => setGeoState(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  const open = status === "requested" || status === "scheduled";
  if (!open) return null;
  const toggle = (p: Panel) => { setErr(null); setPanel(panel === p ? null : p); };
  const chip = "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:border-gold";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {status === "requested" && hasEmployee && (
          <button type="button" className={chip} disabled={busy} onClick={() => send({ action: "schedule" })}><CheckCircle2 size={12} className="text-success" />Confirm</button>
        )}
        {status === "scheduled" && <button type="button" className={cx(chip, "border-gold bg-gold-soft")} onClick={() => toggle("complete")}><LocateFixed size={12} />Check in & complete</button>}
        <button type="button" className={chip} onClick={() => toggle("assign")}><UserRound size={12} />{hasEmployee ? "Reassign" : "Assign"}</button>
        <button type="button" className={chip} onClick={() => toggle("reschedule")}><CalendarClock size={12} />Reschedule</button>
        {status === "scheduled" && <button type="button" className={chip} onClick={() => toggle("no_show")}><XCircle size={12} />No-show</button>}
        <button type="button" className={cx(chip, "text-danger")} onClick={() => toggle("cancel")}><X size={12} />Cancel</button>
      </div>

      {panel && (
        <div className="mt-2 space-y-2 rounded-xl border border-border bg-surface-2 p-3">
          {panel === "assign" && (
            <>
              <input autoFocus className="input py-1.5 text-sm" placeholder="Search your team" value={empQ} onChange={(e) => setEmpQ(e.target.value)} aria-label="Search employees" />
              <ul className="max-h-48 overflow-y-auto">
                {emps.map((x) => (
                  <li key={x.id}><button type="button" disabled={busy} className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface" onClick={() => send({ action: "assign", employeeId: x.id })}><strong>{x.employee_code}</strong> · {x.full_name} <span className="text-muted">{x.designation}</span></button></li>
                ))}
                {emps.length === 0 && <li className="px-2 py-1 text-xs text-muted">No permitted employees match.</li>}
              </ul>
            </>
          )}
          {panel === "reschedule" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="datetime-local" className="input py-1.5 text-sm" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="New date and time" />
              <Button variant="primary" disabled={busy || !when} onClick={() => send({ action: "reschedule", scheduledAt: new Date(when).toISOString() })}>{busy && <Loader2 size={14} className="animate-spin" />}Save</Button>
            </div>
          )}
          {(panel === "cancel" || panel === "no_show") && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input py-1.5 text-sm" placeholder={panel === "cancel" ? "Reason (required)" : "Note (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
              <Button variant={panel === "cancel" ? "danger" : "outline"} disabled={busy || (panel === "cancel" && reason.trim().length < 3)}
                onClick={() => send(panel === "cancel" ? { action: "cancel", reason } : { action: "no_show", note: reason || null })}>
                {busy && <Loader2 size={14} className="animate-spin" />}{panel === "cancel" ? "Cancel visit" : "Mark no-show"}
              </Button>
            </div>
          )}
          {panel === "complete" && (
            <div className="space-y-2">
              <label className="label" htmlFor={`oc-${id}`}>Outcome notes</label>
              <textarea id={`oc-${id}`} className="input text-sm" rows={3} maxLength={2000} placeholder="What happened? Interest level, plots shown, next steps…" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
              <div className="rounded-lg border border-dashed border-border p-2 text-xs">
                {geo ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-success">Location captured ({geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} · ±{Math.round(geo.accuracy)} m)</span>
                    <button type="button" className="font-semibold text-muted" onClick={() => setGeo(null)}>Remove</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted">
                      {geoState === "denied" ? "Location permission was denied — you can complete without it." : geoState === "unavailable" ? "Location is unavailable on this device." : "Optional: attach your current location as check-in proof. Your browser will ask for permission."}
                    </span>
                    <button type="button" className={chip} onClick={captureLocation} disabled={geoState === "locating"}>
                      {geoState === "locating" ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}Use my location
                    </button>
                  </div>
                )}
              </div>
              <Button variant="gold" disabled={busy || outcome.trim().length < 3}
                onClick={() => send({ action: "complete", outcome, checkIn: geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : null })}>
                {busy && <Loader2 size={14} className="animate-spin" />}Check in & mark completed
              </Button>
              <p className="text-[0.7rem] text-muted">Check-in time is recorded by the server.</p>
            </div>
          )}
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}

/** Customer: cancel own visit request. */
export function CustomerVisitCancel({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={busy} className="text-xs font-semibold text-danger hover:underline"
        onClick={async () => {
          const reason = window.prompt("Why are you cancelling? (optional)") ?? null;
          if (reason === null) return;
          setBusy(true);
          setErr(null);
          try {
            await api(`/api/site-visits/${id}`, { method: "PATCH", body: { action: "cancel", reason: reason.trim().length >= 3 ? reason.trim() : "Cancelled by customer" } });
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>
        {busy ? "Cancelling…" : "Cancel request"}
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
