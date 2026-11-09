/**
 * Pure matching logic for the DXF → plot geometry import preview. Server code
 * recomputes this from the stored DXF on apply — client-side previews are never trusted.
 */
import type { DxfParseResult } from "./dxf";
import { isSelfIntersecting, pointInPolygon, polygonArea, polygonCentroid, round2, round3, SQ_M_TO_SQ_YD, type Pt } from "./geometry";

export const AREA_DEVIATION_THRESHOLD = 0.03; // 3 %

export type ImportFeatureKind = "road" | "park" | "amenity" | "boundary" | "entrance" | "water";

/** Layers named like ROAD / PARK / AMENITY … are treated as venture features, not plots. */
export function featureKindForLayer(layer: string): ImportFeatureKind | null {
  const l = layer.toUpperCase();
  if (/ROAD|STREET|CARRIAGE/.test(l)) return "road";
  if (/PARK|GREEN|OPEN[\s_-]?SPACE|GARDEN/.test(l)) return "park";
  if (/AMENIT|CLUB|COMMUNITY/.test(l)) return "amenity";
  if (/BOUNDARY|BOUNDRY|SITE[\s_-]?LIMIT/.test(l)) return "boundary";
  if (/ENTRANCE|ENTRY|GATE/.test(l)) return "entrance";
  if (/WATER|LAKE|POND|TANK/.test(l)) return "water";
  return null;
}

export function normalizePlotLabel(s: string): string {
  let t = s.toUpperCase().replace(/\s+/g, " ").trim();
  t = t.replace(/^(PLOT|PLT|PL|P)\s*(NO\.?|NUMBER)?\s*[-_.:#]?\s*(?=[A-Z0-9])/, "");
  t = t.replace(/^0+(?=\d)/, "");
  return t;
}

/** Default GLB node / mesh name for a plot: PLOT_001 for numeric plot numbers, PLOT_A_12 otherwise. */
export function meshIdForPlot(plotNumber: string): string {
  const p = plotNumber.trim();
  if (/^\d+$/.test(p)) return `PLOT_${p.padStart(3, "0")}`;
  return `PLOT_${p.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 128);
}

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

export interface ImportPlotRef {
  id: string;
  plotNumber: string;
  areaSqYards: number;
  meshId: string | null;
}

export interface PolygonPreview {
  index: number;
  layer: string;
  points: Pt[];
  centroid: Pt;
  areaSqM: number;
  areaSqYards: number;
  labels: string[];
  selfIntersecting: boolean;
  zeroArea: boolean;
  duplicate: boolean;
  plotId: string | null;
  plotNumber: string | null;
  matchedBy: "label" | "order" | null;
  recordedAreaSqYards: number | null;
  deviationPct: number | null;
  deviationFlag: boolean;
  issues: string[];
  applicable: boolean;
}

export interface FeaturePreview {
  index: number;
  layer: string;
  kind: ImportFeatureKind;
  name: string | null;
  points: Pt[];
  areaSqM: number;
}

export interface ImportPreview {
  unitName: string;
  scaleToMetres: number;
  warnings: string[];
  matchMode: "label" | "order" | "none";
  polygons: PolygonPreview[];
  features: FeaturePreview[];
  ignored: { index: number; layer: string; reason: string }[];
  unmatchedPlots: { id: string; plotNumber: string }[];
  duplicateLabels: string[];
  openPolylines: number;
  summary: { detected: number; matched: number; applicable: number; deviations: number; conflicts: number; features: number };
}

export function buildImportPreview(parsed: DxfParseResult, plots: ImportPlotRef[], opts: { deviationThreshold?: number } = {}): ImportPreview {
  const threshold = opts.deviationThreshold ?? AREA_DEVIATION_THRESHOLD;
  const warnings = [...parsed.warnings];
  const features: FeaturePreview[] = [];
  const ignored: ImportPreview["ignored"] = [];
  const nonFeature = parsed.polygons.filter((p) => {
    const kind = featureKindForLayer(p.layer);
    if (!kind) return true;
    const label = parsed.texts.find((t) => pointInPolygon(t.position, p.points));
    features.push({ index: p.index, layer: p.layer, kind, name: label?.text ?? null, points: p.points, areaSqM: round2(polygonArea(p.points)) });
    return false;
  });
  const hasPlotLayer = nonFeature.some((p) => /PLOT/i.test(p.layer));
  const candidates = nonFeature.filter((p) => {
    if (hasPlotLayer && !/PLOT/i.test(p.layer)) {
      ignored.push({ index: p.index, layer: p.layer, reason: "Not on a PLOT layer" });
      return false;
    }
    return true;
  });

  const areas = new Map(candidates.map((c) => [c.index, polygonArea(c.points)]));
  // Each label belongs to the SMALLEST candidate outline containing it (so a boundary drawn on the plot layer does not swallow labels).
  const labelsByPoly = new Map<number, string[]>();
  for (const t of parsed.texts) {
    if (featureKindForLayer(t.layer)) continue;
    let best: { index: number; area: number } | null = null;
    for (const c of candidates) {
      if (!pointInPolygon(t.position, c.points)) continue;
      const a = areas.get(c.index)!;
      if (!best || a < best.area) best = { index: c.index, area: a };
    }
    if (best) labelsByPoly.set(best.index, [...(labelsByPoly.get(best.index) ?? []), t.text]);
  }

  const exact = new Map(plots.map((p) => [p.plotNumber.trim().toUpperCase(), p]));
  const normalized = new Map<string, ImportPlotRef[]>();
  for (const p of plots) {
    const k = normalizePlotLabel(p.plotNumber);
    normalized.set(k, [...(normalized.get(k) ?? []), p]);
  }
  const resolveLabel = (label: string): ImportPlotRef | null => {
    const e = exact.get(label.trim().toUpperCase());
    if (e) return e;
    const n = normalized.get(normalizePlotLabel(label));
    return n && n.length === 1 ? n[0] : null;
  };

  const anyLabels = candidates.some((c) => (labelsByPoly.get(c.index)?.length ?? 0) > 0);
  const matchMode: ImportPreview["matchMode"] = candidates.length === 0 ? "none" : anyLabels ? "label" : "order";
  const sortedPlots = [...plots].sort((a, b) => naturalCompare(a.plotNumber, b.plotNumber));
  if (matchMode === "order") {
    warnings.push("No plot labels were found inside the outlines — polygons were matched to plots BY ORDER. Verify every match carefully.");
    if (candidates.length !== plots.length) warnings.push(`Outline count (${candidates.length}) differs from the plot count (${plots.length}).`);
  }

  const polygons: PolygonPreview[] = candidates.map((c, i) => {
    const areaSqM = areas.get(c.index)!;
    const labels = labelsByPoly.get(c.index) ?? [];
    const issues: string[] = [];
    let plot: ImportPlotRef | null = null;
    let matchedBy: PolygonPreview["matchedBy"] = null;
    if (matchMode === "label") {
      const matched = [...new Map(labels.map(resolveLabel).filter((p): p is ImportPlotRef => !!p).map((p) => [p.id, p])).values()];
      if (matched.length === 1) {
        plot = matched[0];
        matchedBy = "label";
      } else if (matched.length > 1) issues.push(`Contains labels for several plots (${matched.map((m) => m.plotNumber).join(", ")})`);
      else if (labels.length) issues.push(`Label "${labels.join(" / ")}" does not match any plot`);
      else issues.push("No label inside this outline");
    } else if (matchMode === "order" && sortedPlots[i]) {
      plot = sortedPlots[i];
      matchedBy = "order";
    } else issues.push("No plot left to match by order");
    const zeroArea = areaSqM < 0.01;
    const selfIntersecting = isSelfIntersecting(c.points);
    if (zeroArea) issues.push("Zero area");
    if (selfIntersecting) issues.push("Self-intersecting outline");
    if (c.hadBulge) issues.push("Arc segments approximated by chords");
    const areaSqYards = round2(areaSqM * SQ_M_TO_SQ_YD);
    const recorded = plot ? plot.areaSqYards : null;
    const deviation = recorded && recorded > 0 ? Math.abs(areaSqYards - recorded) / recorded : null;
    const deviationFlag = deviation !== null && deviation > threshold;
    if (deviationFlag) issues.push(`Area deviates ${(deviation! * 100).toFixed(1)}% from the recorded ${recorded} sq yd`);
    return {
      index: c.index, layer: c.layer, points: c.points.map(([x, y]) => [round3(x), round3(y)] as Pt),
      centroid: polygonCentroid(c.points).map(round3) as Pt, areaSqM: round2(areaSqM), areaSqYards, labels, selfIntersecting, zeroArea,
      duplicate: false, plotId: plot?.id ?? null, plotNumber: plot?.plotNumber ?? null, matchedBy, recordedAreaSqYards: recorded,
      deviationPct: deviation === null ? null : round2(deviation * 100), deviationFlag, issues, applicable: false,
    };
  });

  // Duplicate labels: several outlines claim the same plot → none of them is applied.
  const byPlot = new Map<string, PolygonPreview[]>();
  for (const p of polygons) if (p.plotId) byPlot.set(p.plotId, [...(byPlot.get(p.plotId) ?? []), p]);
  const duplicateLabels: string[] = [];
  for (const group of byPlot.values()) {
    if (group.length < 2) continue;
    duplicateLabels.push(group[0].plotNumber!);
    for (const p of group) {
      p.duplicate = true;
      p.issues.push(`Duplicate: ${group.length} outlines are labelled plot ${p.plotNumber}`);
    }
  }
  for (const p of polygons) p.applicable = !!p.plotId && !p.duplicate && !p.zeroArea && !p.selfIntersecting;

  const matchedIds = new Set(polygons.filter((p) => p.plotId).map((p) => p.plotId));
  const unmatchedPlots = sortedPlots.filter((p) => !matchedIds.has(p.id)).map((p) => ({ id: p.id, plotNumber: p.plotNumber }));

  return {
    unitName: parsed.unitName, scaleToMetres: parsed.scaleToMetres, warnings, matchMode, polygons, features, ignored, unmatchedPlots,
    duplicateLabels, openPolylines: parsed.openPolylines,
    summary: {
      detected: polygons.length,
      matched: polygons.filter((p) => p.plotId).length,
      applicable: polygons.filter((p) => p.applicable).length,
      deviations: polygons.filter((p) => p.deviationFlag).length,
      conflicts: polygons.filter((p) => !p.applicable).length + unmatchedPlots.length,
      features: features.length,
    },
  };
}
