/**
 * Pure geo helpers shared by the server (site-visit tracking service) and the
 * browser (trip tracker). No I/O, no dependencies — safe to import anywhere.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoPoint extends LatLng {
  /** Reported horizontal accuracy in metres (null/undefined = unknown). */
  accuracy?: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8; // mean Earth radius (IUGG)
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}

/** Maximum accuracy credit given when deciding whether a fix is inside a geofence. */
export const GEOFENCE_ACCURACY_CREDIT_M = 100;

/**
 * Inside if the fix *could* be inside: distance − min(accuracy, 100 m) ≤ radius.
 * The credit is capped so a wildly inaccurate fix (e.g. ±2 km cell-tower) cannot
 * count as an arrival.
 */
export function insideGeofence(point: LatLng, centre: LatLng, radiusM: number, accuracyM?: number | null): boolean {
  const d = haversineM(point, centre);
  const credit = Math.min(Math.max(0, accuracyM ?? 0), GEOFENCE_ACCURACY_CREDIT_M);
  return d - credit <= radiusM;
}

/** Fixes worse than this are ignored for path distance (still stored as evidence). */
export const MAX_PATH_ACCURACY_M = 150;
/** Minimum movement counted, regardless of how good the accuracy is. */
export const MIN_PATH_STEP_M = 10;

/**
 * Incremental path step: returns the distance to add and whether `next` becomes the
 * new anchor. Points with accuracy > 150 m are skipped; moves smaller than
 * max(10 m, accuracy) are treated as jitter (anchor kept, nothing added).
 */
export function pathStep(anchor: GeoPoint | null, next: GeoPoint): { add: number; accept: boolean } {
  if (!validLatLng(next)) return { add: 0, accept: false };
  const acc = next.accuracy ?? 0;
  if (acc > MAX_PATH_ACCURACY_M) return { add: 0, accept: false };
  if (!anchor) return { add: 0, accept: true };
  const d = haversineM(anchor, next);
  if (d < Math.max(MIN_PATH_STEP_M, acc)) return { add: 0, accept: false };
  return { add: d, accept: true };
}

/** Total travelled distance (metres) over an ordered list of fixes, ignoring jitter. */
export function pathDistanceM(points: GeoPoint[]): number {
  let anchor: GeoPoint | null = null;
  let total = 0;
  for (const p of points) {
    const s = pathStep(anchor, p);
    if (s.accept) {
      total += s.add;
      anchor = p;
    }
  }
  return Math.round(total * 10) / 10;
}

/** Google Maps directions link (no API key needed). */
export function googleMapsDirectionsUrl(dest: LatLng, origin?: LatLng | null, waypoints: LatLng[] = []): string {
  const f = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  let url = `https://www.google.com/maps/dir/?api=1&destination=${f(dest)}`;
  if (origin) url += `&origin=${f(origin)}`;
  if (waypoints.length) url += `&waypoints=${waypoints.slice(0, 8).map(f).join("%7C")}`;
  return url;
}

// ---------------------------------------------------------------------------
// Site-visit tracking stage machine
// ---------------------------------------------------------------------------

export const TRACKING_STAGES = [
  "not_started", "trip_started", "arrived_site", "visit_in_progress", "visit_completed", "left_site", "returned", "cancelled",
] as const;
export type TrackingStage = (typeof TRACKING_STAGES)[number];

/** Linear order of the happy path (cancelled is outside it). */
export const STAGE_FLOW: TrackingStage[] = ["not_started", "trip_started", "arrived_site", "visit_in_progress", "visit_completed", "left_site", "returned"];

/** Stages during which the trip is running and GPS pings are accepted. */
export const PING_STAGES: TrackingStage[] = ["trip_started", "arrived_site", "visit_in_progress", "visit_completed", "left_site"];
/** Stages from which the trip may be cancelled (before the visit is completed). */
export const CANCELLABLE_STAGES: TrackingStage[] = ["trip_started", "arrived_site", "visit_in_progress"];

export const STAGE_LABELS: Record<TrackingStage, string> = {
  not_started: "Not started",
  trip_started: "Travelling to site",
  arrived_site: "Arrived at site",
  visit_in_progress: "Visit in progress",
  visit_completed: "Visit completed",
  left_site: "Returning",
  returned: "Returned",
  cancelled: "Trip cancelled",
};

export type TrackingAction = "start" | "arrive" | "start_visit" | "complete" | "leave" | "return" | "cancel";

export const ACTION_TARGET: Record<TrackingAction, TrackingStage> = {
  start: "trip_started",
  arrive: "arrived_site",
  start_visit: "visit_in_progress",
  complete: "visit_completed",
  leave: "left_site",
  return: "returned",
  cancel: "cancelled",
};

export const ACTION_LABELS: Record<TrackingAction, string> = {
  start: "Start trip",
  arrive: "Arrived",
  start_visit: "Start visit",
  complete: "Complete visit",
  leave: "Leave site",
  return: "Returned",
  cancel: "Cancel trip",
};

export const isPingStage = (s: string): boolean => (PING_STAGES as string[]).includes(s);
export const stageIndex = (s: string): number => STAGE_FLOW.indexOf(s as TrackingStage);

/**
 * Valid transitions: strictly the next stage on the flow; "returned" may also be
 * recorded straight after "visit_completed" (leaving is then implied); cancel from
 * any stage before completion. Terminal: returned, cancelled.
 */
export function canTransition(from: string, to: TrackingStage): boolean {
  if (to === "cancelled") return (CANCELLABLE_STAGES as string[]).includes(from);
  const i = stageIndex(from);
  const j = stageIndex(to);
  if (i < 0 || j < 0) return false;
  if (j === i + 1) return true;
  return from === "visit_completed" && to === "returned";
}

export function allowedActions(from: string): TrackingAction[] {
  return (Object.keys(ACTION_TARGET) as TrackingAction[]).filter((a) => canTransition(from, ACTION_TARGET[a]));
}

/** Seconds between two instants, or null when either is missing / negative. */
export function durationS(from: Date | string | null | undefined, to: Date | string | null | undefined): number | null {
  if (!from || !to) return null;
  const s = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return Number.isFinite(s) && s >= 0 ? Math.round(s) : null;
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

export function formatDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

/**
 * Projects lat/lng points into an SVG box (equirectangular, aspect-corrected by
 * cos(latitude)), so a route sketch needs no map tiles. Returns a projector plus
 * metres-per-unit so a geofence circle can be drawn to scale.
 */
export function makeProjector(points: LatLng[], width: number, height: number, pad = 16, extraM = 0) {
  const valid = points.filter(validLatLng);
  if (!valid.length) return null;
  const midLat = valid.reduce((s, p) => s + p.lat, 0) / valid.length;
  const kx = Math.cos(rad(midLat)) * 111_320; // metres per degree lng
  const ky = 110_540; // metres per degree lat
  const xs = valid.map((p) => p.lng * kx);
  const ys = valid.map((p) => p.lat * ky);
  let minX = Math.min(...xs) - extraM, maxX = Math.max(...xs) + extraM;
  let minY = Math.min(...ys) - extraM, maxY = Math.max(...ys) + extraM;
  const spanX = Math.max(maxX - minX, 50);
  const spanY = Math.max(maxY - minY, 50);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  minX = cx - spanX / 2; maxX = cx + spanX / 2; minY = cy - spanY / 2; maxY = cy + spanY / 2;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY); // px per metre
  const ox = (width - spanX * scale) / 2;
  const oy = (height - spanY * scale) / 2;
  return {
    pxPerM: scale,
    project: (p: LatLng) => ({ x: ox + (p.lng * kx - minX) * scale, y: oy + (maxY - p.lat * ky) * scale }),
  };
}
