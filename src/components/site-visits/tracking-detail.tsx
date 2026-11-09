import { ExternalLink, MapPin, Navigation, UserRound } from "lucide-react";
import type { VisitTracking } from "@/lib/services/site-visits";
import { formatDistance, formatDuration, googleMapsDirectionsUrl } from "@/lib/geo";
import { dateTime, relative } from "@/lib/format";
import { Badge, StatusBadge } from "@/components/ui";
import type { MapRuntime } from "@/lib/services/maps";
import { GoogleRouteMap } from "./google-route-map";
import { RouteSketch } from "./route-sketch";
import { StageBadge, StageStepper, TrackingPrivacyNotice } from "./tracking-ui";

const EVENT_LABEL: Record<string, string> = {
  trip_started: "Trip started",
  arrived_site: "Arrived at site",
  visit_started: "Visit started",
  visit_completed: "Visit completed",
  left_site: "Left site",
  returned: "Returned",
  cancelled: "Trip cancelled",
  geofence_enter: "Entered site geofence",
  geofence_exit: "Left site geofence",
  location_ping: "Location",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Read-only trip summary, timeline and route sketch (manager view and dashboard drill-down). */
export function TrackingDetail({ data, showPrivacy = true, map }: { data: VisitTracking; showPrivacy?: boolean; map?: MapRuntime }) {
  const { visit, venture, events, summary } = data;
  const located = events.filter((e) => e.lat != null && e.lng != null).map((e) => ({ lat: e.lat!, lng: e.lng! }));
  const stageEvents = events.filter((e) => e.stage !== "location_ping");
  const pings = events.filter((e) => e.stage === "location_ping");
  const routeUrl = venture.centre
    ? googleMapsDirectionsUrl(visit.end ?? venture.centre, visit.start, visit.end ? [venture.centre] : [])
    : visit.start && visit.end ? googleMapsDirectionsUrl(visit.end, visit.start) : null;

  const stats: { label: string; value: string; hint?: string }[] = [
    { label: "Travel to site", value: formatDuration(summary.travelToSiteS) },
    { label: "Time on site", value: formatDuration(summary.timeOnSiteS) },
    { label: "Visit duration", value: formatDuration(summary.visitDurationS) },
    { label: "Return travel", value: formatDuration(summary.returnTravelS) },
    { label: "Distance", value: formatDistance(summary.totalDistanceM), hint: "jitter-filtered GPS path" },
    { label: "Last location", value: summary.lastLocationAt ? relative(summary.lastLocationAt) : "—", hint: summary.lastLocationAt ? dateTime(summary.lastLocationAt) : undefined },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <UserRound size={14} aria-hidden />{visit.employeeCode} · {visit.employeeName}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden />{venture.name}</span>
            <span>Visitor: {visit.visitorName}</span>
            <span>Scheduled {dateTime(visit.scheduledAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5"><StageBadge stage={summary.stage} /><StatusBadge status={visit.status} /></div>
      </div>

      <StageStepper stage={summary.stage} times={{
        trip_started: summary.tripStartedAt, arrived_site: summary.arrivedAt, visit_in_progress: summary.visitStartedAt,
        visit_completed: summary.visitCompletedAt, left_site: summary.leftSiteAt, returned: summary.returnedAt,
      }} />

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">{s.label}</dt>
            <dd className="mt-0.5 text-base font-bold" title={s.hint}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {(() => {
            const sketch = <RouteSketch path={located} centre={venture.centre} radiusM={venture.radiusM} start={visit.start} end={visit.end} last={summary.lastLocation} />;
            return map?.apiKey && (venture.centre || located.length)
              ? <GoogleRouteMap apiKey={map.apiKey} centre={venture.centre} radiusM={venture.radiusM} path={located} start={visit.start} end={visit.end} last={summary.lastLocation} fallback={sketch} />
              : sketch;
          })()}
          <div className="flex flex-wrap gap-2 text-xs">
            {routeUrl && (
              <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-semibold hover:border-gold">
                <Navigation size={12} aria-hidden />Open route in Google Maps<ExternalLink size={11} aria-hidden />
              </a>
            )}
            {!venture.centre && <span className="text-muted">The venture has no map coordinates yet — geofence arrival detection is off.</span>}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-bold">Timeline</h3>
          {stageEvents.length === 0 ? (
            <p className="text-xs text-muted">The trip has not been started.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {stageEvents.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.32rem] top-1 h-2.5 w-2.5 rounded-full bg-gold" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <strong>{EVENT_LABEL[e.stage] ?? e.stage}</strong>
                    <span className="text-xs text-muted">{time(e.recordedAt)}</span>
                    <Badge tone={e.source === "geofence_auto" ? "info" : "neutral"}>
                      {e.source === "geofence_auto" ? "auto (geofence)" : e.lat != null ? "manual + GPS" : "manual"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted">
                    {e.distanceToSiteM != null && <>{formatDistance(e.distanceToSiteM)} from site{e.insideGeofence ? " · inside geofence" : ""} · </>}
                    {e.accuracy != null && <>±{Math.round(e.accuracy)} m · </>}
                    {dateTime(e.recordedAt)}
                  </div>
                  {e.note && <div className="text-xs">{e.note}</div>}
                </li>
              ))}
            </ol>
          )}
          {pings.length > 0 && (
            <details className="mt-3 rounded-xl border border-border p-2 text-xs">
              <summary className="cursor-pointer font-semibold">{pings.length} GPS ping(s)</summary>
              <div className="mt-2 max-h-64 overflow-auto">
                <table className="table w-full text-xs">
                  <thead><tr><th>Time</th><th>From site</th><th>Accuracy</th><th>Geofence</th></tr></thead>
                  <tbody>
                    {pings.map((p) => (
                      <tr key={p.id}>
                        <td>{time(p.recordedAt)}</td>
                        <td>{formatDistance(p.distanceToSiteM)}</td>
                        <td>{p.accuracy != null ? `±${Math.round(p.accuracy)} m` : "—"}</td>
                        <td>{p.insideGeofence == null ? "—" : p.insideGeofence ? "inside" : "outside"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {visit.outcomeNotes && <p className="mt-3 rounded-lg bg-surface-2 p-2 text-xs"><strong>Outcome:</strong> {visit.outcomeNotes}</p>}
          {visit.consentAt && <p className="mt-2 text-[0.7rem] text-muted">Employee consented to trip tracking at {dateTime(visit.consentAt)}.</p>}
        </div>
      </div>
      {showPrivacy && <TrackingPrivacyNotice retentionNote={data.retentionNote} />}
    </div>
  );
}
