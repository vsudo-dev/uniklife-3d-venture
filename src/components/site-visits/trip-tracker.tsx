"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, CircleDot, ExternalLink, Flag, Home, Loader2, LocateFixed, LogOut, MapPinned, Navigation, Pause, Play,
  PlayCircle, Smartphone, Wifi, WifiOff, X,
} from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Button, cx } from "@/components/ui";
import {
  ACTION_LABELS, allowedActions, formatDistance, googleMapsDirectionsUrl, haversineM, insideGeofence, isPingStage,
  type LatLng, type TrackingAction,
} from "@/lib/geo";
import type { TrackingState } from "@/lib/services/site-visits";
import { StageBadge, StageStepper } from "./tracking-ui";

type Point = { lat: number; lng: number; accuracy: number | null; recordedAt: string };
type Pos = { lat: number; lng: number; accuracy: number; at: number };
type PingResult = {
  accepted: number; dropped: number; stage: TrackingState["stage"]; totalDistanceM: number;
  insideGeofence: boolean | null; distanceToSiteM: number | null; autoTransitions: { stage: string; at: string }[];
};
type Perm = "idle" | "locating" | "granted" | "denied" | "unavailable";
type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };

const QUEUE_INTERVAL_MS = 15_000; // matches the server's minimum ping spacing
const FLUSH_EVERY_MS = 30_000;
const MAX_QUEUE = 1000;

const STEP_ACTIONS: { action: TrackingAction; icon: typeof Play }[] = [
  { action: "start", icon: Play },
  { action: "arrive", icon: MapPinned },
  { action: "start_visit", icon: PlayCircle },
  { action: "complete", icon: CheckCircle2 },
  { action: "leave", icon: LogOut },
  { action: "return", icon: Home },
];

/**
 * Mobile-first trip tracker for the ASSIGNED employee. GPS is used only while this
 * page is open and the trip is active, after explicit consent. Fixes are queued in
 * memory every ≥15 s and sent in batches every ~30 s (kept while offline).
 */
export function TripTracker({
  visitId, initial, venture, visitorName, visitStatus,
}: {
  visitId: string;
  initial: TrackingState;
  venture: { name: string; centre: LatLng | null; radiusM: number };
  visitorName: string;
  visitStatus: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<TrackingState>(initial);
  const [perm, setPerm] = useState<Perm>("idle");
  const [gpsOn, setGpsOn] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [queued, setQueued] = useState(0);
  const [lastSync, setLastSync] = useState<{ at: number; ok: boolean; msg?: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<TrackingAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [panel, setPanel] = useState<null | "complete" | "cancel">(null);
  const [outcome, setOutcome] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [wakeWanted, setWakeWanted] = useState(true);
  const [wakeState, setWakeState] = useState<"unsupported" | "off" | "on">("off");

  const queue = useRef<Point[]>([]);
  const lastQueuedAt = useRef(0);
  const flushing = useRef(false);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const consentRef = useRef<HTMLButtonElement>(null);

  const active = isPingStage(state.stage);
  const tracking = active && gpsOn && perm !== "denied" && perm !== "unavailable";
  const allowed = allowedActions(state.stage);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    if (typeof navigator !== "undefined" && !("wakeLock" in navigator)) setWakeState("unsupported");
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const batch = queue.current.slice(0, 50);
        try {
          const r = await api<PingResult>(`/api/site-visits/${visitId}/tracking/pings`, { method: "POST", body: { points: batch } });
          queue.current.splice(0, batch.length);
          setState((s) => {
            const next = { ...s, stage: r.stage, totalDistanceM: r.totalDistanceM };
            for (const t of r.autoTransitions) {
              if (t.stage === "arrived_site") next.arrivedAt = t.at;
              if (t.stage === "left_site") next.leftSiteAt = t.at;
            }
            return next;
          });
          setLastSync({ at: Date.now(), ok: true });
          if (r.autoTransitions.length) router.refresh();
        } catch (e) {
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
            // The server will never accept these (no active trip, too old, …): drop them.
            queue.current.splice(0, batch.length);
            setLastSync({ at: Date.now(), ok: false, msg: e.message });
          } else {
            setLastSync({ at: Date.now(), ok: false, msg: "Offline or server busy — locations are kept on this device and sent later." });
            break;
          }
        }
      }
    } finally {
      flushing.current = false;
      setQueued(queue.current.length);
    }
  }, [router, visitId]);

  // Foreground GPS watch: only while the page is open, the trip is active and sharing is on.
  useEffect(() => {
    if (!tracking) return;
    if (!("geolocation" in navigator)) {
      setPerm("unavailable");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPerm("granted");
        const fix: Pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() };
        setPos(fix);
        if (fix.at - lastQueuedAt.current >= QUEUE_INTERVAL_MS) {
          lastQueuedAt.current = fix.at;
          queue.current.push({ lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy * 10) / 10, recordedAt: new Date(fix.at).toISOString() });
          if (queue.current.length > MAX_QUEUE) queue.current.splice(0, queue.current.length - MAX_QUEUE);
          setQueued(queue.current.length);
        }
      },
      (e) => setPerm(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  // Periodic batch upload (also drains anything left after the trip ends).
  useEffect(() => {
    if (!active && queued === 0) return;
    const t = window.setInterval(() => void flush(), FLUSH_EVERY_MS);
    return () => window.clearInterval(t);
  }, [active, queued, flush]);

  useEffect(() => {
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [flush]);

  // Screen Wake Lock (optional): keeps the screen on so the browser keeps delivering GPS.
  const wakeSupported = wakeState !== "unsupported";
  useEffect(() => {
    if (!tracking || !wakeWanted || !wakeSupported) return;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
    const acquire = async () => {
      try {
        if (!nav.wakeLock || document.visibilityState !== "visible") return;
        const s = await nav.wakeLock.request("screen");
        if (cancelled) { await s.release(); return; }
        wakeLock.current = s;
        setWakeState("on");
        s.addEventListener?.("release", () => setWakeState((w) => (w === "unsupported" ? w : "off")));
      } catch {
        setWakeState("off");
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") { void acquire(); void flush(); }
    };
    void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      setWakeState((w) => (w === "unsupported" ? w : "off"));
    };
  }, [tracking, wakeWanted, wakeSupported, flush]);

  useEffect(() => {
    if (showConsent) consentRef.current?.focus();
  }, [showConsent]);

  const freshPos = pos && gpsOn && Date.now() - pos.at < 120_000 ? pos : null;

  async function act(action: TrackingAction, extra: Record<string, unknown> = {}, coords: Pos | null = freshPos) {
    setBusy(action);
    setErr(null);
    try {
      await flush();
      const body: Record<string, unknown> = { action, recordedAt: new Date().toISOString(), ...extra };
      if (coords) Object.assign(body, { lat: coords.lat, lng: coords.lng, accuracy: Math.round(coords.accuracy * 10) / 10 });
      const s = await api<TrackingState>(`/api/site-visits/${visitId}/tracking`, { method: "POST", body });
      setState(s);
      setPanel(null);
      setOutcome("");
      setCancelReason("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** After consent: one high-accuracy fix for the start point, then start (manual if denied). */
  function startWithConsent() {
    setShowConsent(false);
    setGpsOn(true);
    if (!("geolocation" in navigator)) {
      setPerm("unavailable");
      void act("start", { consent: true }, null);
      return;
    }
    setPerm("locating");
    setBusy("start");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPerm("granted");
        const fix: Pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() };
        setPos(fix);
        lastQueuedAt.current = fix.at; // the start point itself is stored with the stage event
        void act("start", { consent: true }, fix);
      },
      (e) => {
        setPerm(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
        void act("start", { consent: true }, null);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  function onStep(action: TrackingAction) {
    if (action === "start") return setShowConsent(true);
    if (action === "complete") return setPanel(panel === "complete" ? null : "complete");
    void act(action);
  }

  const distance = freshPos && venture.centre ? haversineM(freshPos, venture.centre) : null;
  const inside = freshPos && venture.centre ? insideGeofence(freshPos, venture.centre, venture.radiusM, freshPos.accuracy) : null;
  const nextAction = STEP_ACTIONS.find((s) => allowed.includes(s.action))?.action ?? null;
  const outcomeNeeded = visitStatus === "scheduled";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted">Visit with {visitorName}</div>
          <div className="text-lg font-bold">{venture.name}</div>
        </div>
        <StageBadge stage={state.stage} />
      </div>

      <StageStepper stage={state.stage} times={{
        trip_started: state.tripStartedAt, arrived_site: state.arrivedAt, visit_in_progress: state.visitStartedAt,
        visit_completed: state.visitCompletedAt, left_site: state.leftSiteAt, returned: state.returnedAt,
      }} />

      {/* Live status */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">Distance to site</div>
          <div className="text-xl font-extrabold">{distance != null ? formatDistance(distance) : "—"}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">Geofence</div>
          <div className="mt-1">
            {!venture.centre ? <span className="text-xs text-muted">No site coordinates</span>
              : inside == null ? <span className="text-xs text-muted">Waiting for GPS</span>
              : inside ? <span className="rounded-full bg-success px-2 py-0.5 text-xs font-bold text-white">Inside site ({venture.radiusM} m)</span>
              : <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-muted">Outside site</span>}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">Travelled</div>
          <div className="text-xl font-extrabold">{formatDistance(state.totalDistanceM)}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">GPS</div>
          <div className="text-xs">
            {freshPos ? <>±{Math.round(freshPos.accuracy)} m · {new Date(freshPos.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</> : tracking ? "Locating…" : active ? "Off" : "Not in use"}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[0.7rem] text-muted">
            {online ? <Wifi size={11} aria-hidden /> : <WifiOff size={11} className="text-warning" aria-hidden />}
            {queued > 0 ? `${queued} point(s) waiting to send` : lastSync?.ok ? "All sent" : online ? "Online" : "Offline"}
          </div>
        </div>
      </div>

      {perm === "denied" && (
        <div role="alert" className="flex gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <div>
            <strong>Location permission is blocked.</strong> You can still use the stage buttons — each stage is recorded as <em>manual</em> without a location.
            To share location, allow it for this site in your browser settings and reload the page.
          </div>
        </div>
      )}
      {perm === "unavailable" && active && (
        <div role="status" className="rounded-xl border border-border bg-surface-2 p-3 text-sm">Location is unavailable on this device right now. Stage buttons still work and are recorded as manual.</div>
      )}
      {lastSync && !lastSync.ok && lastSync.msg && <p role="status" className="text-xs text-warning">{lastSync.msg}</p>}

      {/* Stage buttons */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STEP_ACTIONS.map(({ action, icon: Icon }) => {
          const enabled = allowed.includes(action) && !busy;
          const primary = action === nextAction;
          return (
            <Button key={action} type="button" variant={primary ? "gold" : "outline"} disabled={!enabled} onClick={() => onStep(action)}
              className={cx("min-h-14 text-base", primary && "col-span-2 sm:col-span-1")}
              title={!allowed.includes(action) ? "Not available at the current stage" : undefined}>
              {busy === action ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Icon size={18} aria-hidden />}
              {ACTION_LABELS[action]}
            </Button>
          );
        })}
      </div>

      {panel === "complete" && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
          <label htmlFor="trip-outcome" className="label">Outcome notes{outcomeNeeded ? " (required)" : " (visit already marked completed)"}</label>
          <textarea id="trip-outcome" className="input text-sm" rows={3} maxLength={2000} value={outcome} onChange={(e) => setOutcome(e.target.value)}
            placeholder="Interest level, plots shown, next steps…" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="gold" disabled={!!busy || (outcomeNeeded && outcome.trim().length < 3)} onClick={() => void act("complete", { outcome: outcome.trim() || null })}>
              {busy === "complete" && <Loader2 size={14} className="animate-spin" aria-hidden />}Complete visit
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPanel(null)}>Close</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {venture.centre && (
          <a href={googleMapsDirectionsUrl(venture.centre)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 font-semibold hover:border-gold">
            <Navigation size={15} aria-hidden />Open in Google Maps<ExternalLink size={12} aria-hidden />
          </a>
        )}
        {active && perm !== "denied" && perm !== "unavailable" && (
          <button type="button" onClick={() => setGpsOn(!gpsOn)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 font-semibold hover:border-gold" aria-pressed={!gpsOn}>
            {gpsOn ? <><Pause size={15} aria-hidden />Pause location sharing</> : <><LocateFixed size={15} aria-hidden />Resume location sharing</>}
          </button>
        )}
        {tracking && wakeState !== "unsupported" && (
          <label className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2">
            <input type="checkbox" checked={wakeWanted} onChange={(e) => setWakeWanted(e.target.checked)} />
            <Smartphone size={15} aria-hidden />Keep screen on {wakeState === "on" ? <span className="text-xs text-success">(on)</span> : null}
          </label>
        )}
        {tracking && wakeState === "unsupported" && (
          <span className="text-xs text-muted">Keep this page open and the screen on while travelling — this browser cannot keep the screen awake automatically.</span>
        )}
        {allowed.includes("cancel") && (
          <button type="button" onClick={() => setPanel(panel === "cancel" ? null : "cancel")} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 font-semibold text-danger hover:border-danger">
            <X size={15} aria-hidden />Cancel trip
          </button>
        )}
      </div>

      {panel === "cancel" && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3 sm:flex-row">
          <input className="input py-1.5 text-sm" placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} aria-label="Reason for cancelling the trip" maxLength={500} />
          <Button type="button" variant="danger" disabled={!!busy} onClick={() => void act("cancel", { reason: cancelReason.trim() || null })}>
            {busy === "cancel" && <Loader2 size={14} className="animate-spin" aria-hidden />}Cancel trip & stop tracking
          </Button>
        </div>
      )}

      {active && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <CircleDot size={12} className={cx("mt-0.5 shrink-0", tracking ? "text-danger" : "text-muted")} aria-hidden />
          {tracking
            ? "Location is being shared for this trip while this page stays open. Locking the phone or switching apps pauses it — that is a browser limit."
            : "Location sharing is off. Stage buttons are recorded without location."}
        </p>
      )}
      {state.stage === "returned" && <p className="flex items-center gap-1.5 text-sm text-success"><Flag size={14} aria-hidden />Trip complete — location sharing has stopped.</p>}
      {state.stage === "cancelled" && <p className="text-sm text-muted">Trip cancelled — location sharing has stopped.</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      {showConsent && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="consent-title"
          onKeyDown={(e) => { if (e.key === "Escape") setShowConsent(false); }}>
          <div className="w-full max-w-md rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl">
            <h2 id="consent-title" className="text-lg font-bold">Share your location during this trip?</h2>
            <div className="mt-2 space-y-2 text-sm text-muted">
              <p>To record this site visit stage by stage, the app will collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>your GPS position and its accuracy, about every 15–30 seconds, <strong>only while this page is open</strong>;</li>
                <li>where you start, when you arrive at {venture.name} (detected automatically near the site), when the visit starts and ends, when you leave and when you return;</li>
                <li>the distance travelled for this trip.</li>
              </ul>
              <p><strong>Tracking stops</strong> when you mark “Returned”, cancel the trip, pause sharing, or close this page. Nothing is recorded outside this trip.</p>
              <p>Visible only to you, your managers above you in the reporting chain, and organization admins / venture managers.</p>
              <p className="text-xs">Your browser will ask for location permission. If you decline, you can still use the stage buttons (recorded without location).</p>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setShowConsent(false)}>Not now</Button>
              <Button ref={consentRef} type="button" variant="gold" onClick={startWithConsent}>I agree — start trip</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
