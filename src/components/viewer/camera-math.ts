/**
 * Pure camera / intelligence math for the venture viewer (no DOM, no React).
 *
 * World convention: layout plane metres, x → east, y → north. Three.js scene uses
 * X = x − cx, Z = −(y − cy), Y up. All presets are derived from the venture's
 * actual bounds — nothing is hard-coded per venture.
 */

export type Vec3 = [number, number, number];
export interface CameraPose {
  position: Vec3;
  target: Vec3;
}
export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  width: number;
  depth: number;
  radius: number; // bounding circle radius on the layout plane
}

export interface FeatureLike {
  kind: string;
  name: string | null;
  polygon: [number, number][];
}

export function boundsOf(polygons: [number, number][][]): Bounds2D {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 100; maxY = 100;
  }
  const width = maxX - minX;
  const depth = maxY - minY;
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width, depth, radius: Math.max(1, Math.hypot(width, depth) / 2) };
}

/** Layout point → scene coordinates (centred). */
export function toScene(b: Bounds2D, x: number, y: number, h = 0): Vec3 {
  return [x - b.cx, h, -(y - b.cy)];
}

export function centroid(poly: [number, number][]): [number, number] {
  // Area-weighted polygon centroid; falls back to vertex mean for degenerate shapes.
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function polygonExtent(poly: [number, number][]): { w: number; d: number } {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Distance at which a sphere of `radius` fits the viewport for a perspective camera
 * (accounts for both vertical FOV and aspect ratio), with a margin.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, margin = 1.12): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.1));
  const limiting = Math.min(vFov, hFov);
  return (radius * margin) / Math.sin(limiting / 2);
}

/** Pose looking at `target` from `distance` along a polar (from vertical) / azimuth (from +Z) direction. */
export function orbitPose(target: Vec3, distance: number, polarDeg: number, azimuthDeg: number): CameraPose {
  const p = (polarDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return {
    target,
    position: [
      target[0] + distance * Math.sin(p) * Math.sin(az),
      target[1] + distance * Math.cos(p),
      target[2] + distance * Math.sin(p) * Math.cos(az),
    ],
  };
}

export interface Presets {
  aerial: CameraPose; // premium bird's-eye, frames everything
  highAltitude: CameraPose; // tour start
  top: CameraPose; // readable plan view
  angled: CameraPose; // three-quarter intelligence view
  minDistance: number;
  maxDistance: number;
  medianPlotSize: number; // metres, characteristic plot width
}

export function computePresets(b: Bounds2D, opts: { fovDeg: number; aspect: number; plotSizes: number[] }): Presets {
  const centre: Vec3 = [0, 0, 0];
  const fit = fitDistance(b.radius, opts.fovDeg, opts.aspect);
  const sizes = [...opts.plotSizes].filter((s) => s > 0).sort((a, c) => a - c);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : b.radius / 10;
  return {
    // Bounding-circle fit is conservative for rectangular layouts, so frame tighter and tilt to show the horizon.
    aerial: orbitPose(centre, fit * 0.8, 57, 25),
    highAltitude: orbitPose(centre, fit * 1.9, 30, 10),
    top: orbitPose(centre, fit * 1.0, 0.5, 0),
    angled: orbitPose(centre, fit * 0.7, 38, 0),
    minDistance: Math.max(median * 4.5, 18),
    maxDistance: fit * 2.4,
    medianPlotSize: median,
  };
}

/** Pose that frames a single plot (or a selection) closely from a readable angle. */
export function focusPose(b: Bounds2D, polys: [number, number][][], opts: { fovDeg: number; aspect: number; polarDeg?: number; azimuthDeg?: number }): CameraPose {
  const fb = boundsOf(polys);
  const target = toScene(b, fb.cx, fb.cy);
  const radius = Math.max(fb.radius, 6);
  const d = fitDistance(radius, opts.fovDeg, opts.aspect, 2.2);
  return orbitPose(target, d, opts.polarDeg ?? 35, opts.azimuthDeg ?? 0);
}

/** Longest axis of a road polygon as a centreline [start, end] in layout coordinates. */
export function roadCentreline(poly: [number, number][]): [[number, number], [number, number]] {
  const fb = boundsOf([poly]);
  return fb.width >= fb.depth
    ? [[fb.minX, fb.cy], [fb.maxX, fb.cy]]
    : [[fb.cx, fb.minY], [fb.cx, fb.maxY]];
}

export interface TourStep {
  label: string;
  pose: CameraPose;
  holdMs: number; // pause after arriving
}

/**
 * Cinematic flythrough keyframes:
 * high altitude → entrance → along main road → amenities → overview → selected block → interactive overview.
 * Every step is optional and derived from the venture's own features.
 */
export function buildTour(
  b: Bounds2D,
  features: FeatureLike[],
  presets: Presets,
  opts: { fovDeg: number; aspect: number; focusPolys?: [number, number][][]; plotPolys?: [number, number][][] },
): TourStep[] {
  const steps: TourStep[] = [{ label: "Aerial approach", pose: presets.highAltitude, holdMs: 400 }];
  const low = Math.max(presets.medianPlotSize * 2.2, 12);

  const entrance = features.find((f) => f.kind === "entrance");
  const roads = features.filter((f) => f.kind === "road");
  const mainRoad = roads.sort((a, c) => {
    const ea = polygonExtent(a.polygon), ec = polygonExtent(c.polygon);
    return Math.min(ec.w, ec.d) - Math.min(ea.w, ea.d) || Math.max(ec.w, ec.d) - Math.max(ea.w, ea.d);
  })[0];

  if (entrance) {
    const [ex, ey] = centroid(entrance.polygon);
    const t = toScene(b, ex, ey);
    // Look from outside the venture towards the entrance.
    const dirZ = Math.sign(t[2]) || 1;
    steps.push({ label: "Main entrance", pose: { target: t, position: [t[0], low * 1.1, t[2] + dirZ * low * 2.4] }, holdMs: 900 });
  }
  if (mainRoad) {
    const [s, e] = roadCentreline(mainRoad.polygon);
    const ent = entrance ? centroid(entrance.polygon) : s;
    const [from, to] = Math.hypot(ent[0] - s[0], ent[1] - s[1]) <= Math.hypot(ent[0] - e[0], ent[1] - e[1]) ? [s, e] : [e, s];
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const pFrom = toScene(b, from[0], from[1], low);
    steps.push({ label: mainRoad.name ?? "Main road", pose: { position: pFrom, target: toScene(b, mid[0], mid[1]) }, holdMs: 200 });
    const pMid = toScene(b, mid[0], mid[1], low);
    steps.push({ label: mainRoad.name ?? "Main road", pose: { position: pMid, target: toScene(b, to[0], to[1]) }, holdMs: 300 });
  }
  const amenities = features.filter((f) => f.kind === "amenity" || f.kind === "park" || f.kind === "water");
  if (amenities.length) {
    const ab = boundsOf(amenities.map((a) => a.polygon));
    const t = toScene(b, ab.cx, ab.cy);
    steps.push({ label: amenities.map((a) => a.name).filter(Boolean).slice(0, 2).join(" & ") || "Amenities", pose: orbitPose(t, Math.max(ab.radius * 2.2, low * 2), 55, 200), holdMs: 1200 });
  }
  // Low flyover across the plotted layout along its long axis.
  if (opts.plotPolys && opts.plotPolys.length) {
    const pb = boundsOf(opts.plotPolys);
    const alongX = pb.width >= pb.depth;
    const alt = Math.max(presets.medianPlotSize * 3.2, 18);
    const back = alt * 1.4;
    const [sx, sy, ex, ey] = alongX
      ? [pb.minX, pb.cy, pb.maxX, pb.cy]
      : [pb.cx, pb.minY, pb.cx, pb.maxY];
    const ahead = (x: number, y: number, tx: number, ty: number): CameraPose => {
      const len = Math.hypot(tx - x, ty - y) || 1;
      const ux = (tx - x) / len, uy = (ty - y) / len;
      return { position: toScene(b, x - ux * back, y - uy * back, alt), target: toScene(b, x + ux * back * 1.2, y + uy * back * 1.2) };
    };
    steps.push({ label: "Flying over the plotted layout", pose: ahead(sx, sy, ex, ey), holdMs: 150 });
    steps.push({ label: "Flying over the plotted layout", pose: ahead((sx + ex) / 2, (sy + ey) / 2, ex, ey), holdMs: 150 });
    steps.push({ label: "Flying over the plotted layout", pose: ahead(ex - (ex - sx) * 0.1, ey - (ey - sy) * 0.1, ex + (ex - sx), ey + (ey - sy)), holdMs: 500 });
  }
  steps.push({ label: "Venture overview", pose: presets.angled, holdMs: 900 });
  if (opts.focusPolys && opts.focusPolys.length) {
    steps.push({ label: "Selected plots", pose: focusPose(b, opts.focusPolys, { fovDeg: opts.fovDeg, aspect: opts.aspect }), holdMs: 1400 });
  }
  steps.push({ label: "Explore the venture", pose: presets.aerial, holdMs: 0 });
  return steps;
}

/** Height in screen pixels of a world-space length seen at `distance` (perspective). */
export function projectedPixels(worldSize: number, distance: number, fovDeg: number, viewportHeightPx: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  if (distance <= 0) return Infinity;
  return (worldSize / (2 * distance * Math.tan(vFov / 2))) * viewportHeightPx;
}

/**
 * Decides when to switch between cinematic (0) and live plot intelligence (1)
 * using the projected size of a typical plot, with hysteresis so the mode does
 * not flicker near the threshold. Thresholds scale with the viewport.
 */
export class IntelligenceGate {
  active = false;
  constructor(private readonly opts: { enterFraction?: number; exitRatio?: number; minPx?: number; maxPx?: number } = {}) {}

  thresholds(viewportW: number, viewportH: number) {
    const base = Math.min(viewportW, viewportH) * (this.opts.enterFraction ?? 0.045);
    const enter = Math.min(this.opts.maxPx ?? 48, Math.max(this.opts.minPx ?? 22, base));
    return { enter, exit: enter * (this.opts.exitRatio ?? 0.7) };
  }

  /** Returns the new target state given the current projected plot size. */
  update(projectedPx: number, viewportW: number, viewportH: number): boolean {
    const { enter, exit } = this.thresholds(viewportW, viewportH);
    if (!this.active && projectedPx >= enter) this.active = true;
    else if (this.active && projectedPx < exit) this.active = false;
    return this.active;
  }
}

/** Frame-rate independent exponential smoothing toward a target. */
export function damp(current: number, target: number, lambda: number, dtSeconds: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dtSeconds));
}

/** Short, non-colour status labels so status is never conveyed by colour alone. */
export const STATUS_SHORT: Record<string, string> = {
  available: "",
  held: "HELD",
  reserved: "RSVD",
  booked: "BOOKED",
  sold: "SOLD",
  blocked: "BLOCKED",
};
