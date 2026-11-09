import { describe, expect, it } from "vitest";
import {
  boundsOf, buildTour, centroid, computePresets, damp, fitDistance, focusPose, IntelligenceGate, projectedPixels,
} from "@/components/viewer/camera-math";
import { generateDemoLayout } from "@/lib/demo/layout-generator";

const layout = generateDemoLayout();
const b = boundsOf([...layout.plots.map((p) => p.polygon), ...layout.features.map((f) => f.polygon)]);

describe("framing", () => {
  it("fits the whole venture inside the frustum for portrait and landscape", () => {
    for (const aspect of [0.5, 1, 1.8]) {
      const d = fitDistance(b.radius, 45, aspect);
      // The bounding circle subtends less than the limiting FOV at this distance.
      const vFov = (45 * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const angle = 2 * Math.asin(b.radius / d);
      expect(angle).toBeLessThan(Math.min(vFov, hFov));
    }
  });

  it("derives presets from bounds, not constants", () => {
    const small = boundsOf([[[0, 0], [20, 0], [20, 20], [0, 20]]]);
    const p1 = computePresets(b, { fovDeg: 45, aspect: 1.6, plotSizes: [9] });
    const p2 = computePresets(small, { fovDeg: 45, aspect: 1.6, plotSizes: [9] });
    const dist = (p: { position: number[]; target: number[] }) => Math.hypot(...p.position.map((v, i) => v - p.target[i]));
    expect(dist(p1.aerial)).toBeGreaterThan(dist(p2.aerial));
    expect(p1.top.position[1]).toBeGreaterThan(0);
    expect(p1.maxDistance).toBeGreaterThan(p1.minDistance);
  });

  it("focuses on a plot's centre", () => {
    const plot = layout.plots.find((p) => p.plotNumber === "17")!;
    const pose = focusPose(b, [plot.polygon], { fovDeg: 45, aspect: 1.5 });
    const [cx, cy] = centroid(plot.polygon);
    expect(pose.target[0]).toBeCloseTo(cx - b.cx, 3);
    expect(pose.target[2]).toBeCloseTo(-(cy - b.cy), 3);
  });
});

describe("cinematic tour", () => {
  it("visits entrance, main road, amenities, overview, selection and ends at the aerial overview", () => {
    const presets = computePresets(b, { fovDeg: 45, aspect: 1.6, plotSizes: [9] });
    const sel = layout.plots.filter((p) => ["17", "18", "19", "20"].includes(p.plotNumber)).map((p) => p.polygon);
    const tour = buildTour(b, layout.features, presets, { fovDeg: 45, aspect: 1.6, focusPolys: sel, plotPolys: layout.plots.map((p) => p.polygon) });
    const labels = tour.map((s) => s.label);
    expect(labels[0]).toBe("Aerial approach");
    expect(labels).toContain("Main entrance");
    // Spec order: entrance → main road → amenities → flyover → overview → finish at the interactive aerial overview.
    const idx = (re: RegExp) => labels.findIndex((l) => re.test(l));
    expect(idx(/Main entrance/)).toBeLessThan(idx(/Main Road/i));
    expect(idx(/Park|Clubhouse/i)).toBeLessThan(idx(/Flying over/));
    expect(idx(/Flying over/)).toBeLessThan(idx(/Venture overview/));
    // The flyover is low: below the aerial overview altitude.
    const fly = tour.find((s) => /Flying over/.test(s.label))!;
    expect(fly.pose.position[1]).toBeLessThan(presets.aerial.position[1]);
    expect(labels.some((l) => /Main Road/i.test(l))).toBe(true);
    expect(labels.some((l) => /Park|Clubhouse/i.test(l))).toBe(true);
    expect(labels).toContain("Selected plots");
    expect(tour[tour.length - 1].pose).toEqual(presets.aerial);
  });

  it("degrades gracefully for a venture without features", () => {
    const presets = computePresets(b, { fovDeg: 45, aspect: 1, plotSizes: [] });
    const tour = buildTour(b, [], presets, { fovDeg: 45, aspect: 1 });
    expect(tour.length).toBeGreaterThanOrEqual(3);
  });
});

describe("zoom-based intelligence transition", () => {
  it("uses projected plot size with hysteresis (no flicker near the threshold)", () => {
    const gate = new IntelligenceGate();
    const { enter, exit } = gate.thresholds(1280, 720);
    expect(exit).toBeLessThan(enter);
    expect(gate.update(enter - 1, 1280, 720)).toBe(false);
    expect(gate.update(enter + 0.1, 1280, 720)).toBe(true);
    // Hovering between exit and enter keeps the current state.
    expect(gate.update((enter + exit) / 2, 1280, 720)).toBe(true);
    expect(gate.update(exit - 0.1, 1280, 720)).toBe(false);
    expect(gate.update((enter + exit) / 2, 1280, 720)).toBe(false);
  });

  it("scales thresholds with the viewport", () => {
    const g = new IntelligenceGate();
    expect(g.thresholds(390, 844).enter).toBeLessThanOrEqual(g.thresholds(2560, 1440).enter);
  });

  it("projected size shrinks with distance", () => {
    expect(projectedPixels(9, 50, 45, 800)).toBeGreaterThan(projectedPixels(9, 500, 45, 800));
  });

  it("damping converges and is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 6, 1 / 60);
    let c = 0;
    for (let i = 0; i < 30; i++) c = damp(c, 1, 6, 1 / 30);
    expect(a).toBeCloseTo(c, 5);
    expect(a).toBeGreaterThan(0.99);
  });
});
