import { describe, expect, it } from "vitest";
import {
  allowedActions, canTransition, durationS, formatDistance, googleMapsDirectionsUrl, haversineM, insideGeofence, makeProjector,
  pathDistanceM, pathStep, validLatLng,
} from "@/lib/geo";

/** Offset a point north by `m` metres (good enough for tests at small distances). */
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_195, lng: p.lng });
const east = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat, lng: p.lng + m / (111_195 * Math.cos((p.lat * Math.PI) / 180)) });

describe("haversine", () => {
  it("matches known distances", () => {
    // One degree along a meridian / the equator ≈ 111.195 km with the mean Earth radius.
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
    // London → Paris ≈ 343.5 km; New York → Los Angeles ≈ 3,936 km (great circle).
    const lp = haversineM({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
    expect(lp / 1000).toBeGreaterThan(342.5);
    expect(lp / 1000).toBeLessThan(344.5);
    const nyla = haversineM({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
    expect(Math.abs(nyla / 1000 - 3936) / 3936).toBeLessThan(0.005);
    expect(haversineM({ lat: 17.385, lng: 78.4867 }, { lat: 17.385, lng: 78.4867 })).toBe(0);
  });

  it("is symmetric and handles the antimeridian", () => {
    const a = { lat: 10, lng: 179.9 }, b = { lat: 10, lng: -179.9 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
    expect(haversineM(a, b)).toBeLessThan(25_000);
  });

  it("validates coordinates", () => {
    expect(validLatLng({ lat: 17.4, lng: 78.5 })).toBe(true);
    expect(validLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(validLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(validLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
  });
});

describe("geofence", () => {
  const site = { lat: 17.385, lng: 78.4867 };
  it("is inside within the radius", () => {
    expect(insideGeofence(north(site, 250), site, 300, 5)).toBe(true);
    expect(insideGeofence(north(site, 350), site, 300, 5)).toBe(false);
  });
  it("credits accuracy, capped at 100 m", () => {
    // 380 m away with ±90 m accuracy: 380 − 90 = 290 ≤ 300 → inside.
    expect(insideGeofence(east(site, 380), site, 300, 90)).toBe(true);
    // 450 m away with ±2000 m accuracy: credit capped to 100 → 350 > 300 → outside.
    expect(insideGeofence(east(site, 450), site, 300, 2000)).toBe(false);
    // Unknown accuracy = no credit.
    expect(insideGeofence(east(site, 320), site, 300, null)).toBe(false);
  });
});

describe("path distance (jitter filtering)", () => {
  const a = { lat: 17.4, lng: 78.4, accuracy: 8 };
  it("sums real movement", () => {
    const pts = [a, { ...north(a, 500), accuracy: 8 }, { ...north(a, 1000), accuracy: 8 }];
    expect(pathDistanceM(pts)).toBeGreaterThan(995);
    expect(pathDistanceM(pts)).toBeLessThan(1005);
  });
  it("ignores inaccurate fixes and small moves", () => {
    const pts = [
      a,
      { ...north(a, 5), accuracy: 5 }, // < 10 m: jitter
      { ...east(a, 30), accuracy: 40 }, // move 30 m < accuracy 40: jitter
      { ...north(a, 3000), accuracy: 900 }, // accuracy > 150: skipped
      { ...north(a, 200), accuracy: 10 }, // real move
    ];
    const d = pathDistanceM(pts);
    expect(d).toBeGreaterThan(195);
    expect(d).toBeLessThan(205);
    expect(pathStep(null, { ...a, accuracy: 151 }).accept).toBe(false);
    expect(pathStep(a, { ...north(a, 12), accuracy: 5 })).toMatchObject({ accept: true });
  });
  it("stationary jitter adds nothing", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ ...north(a, (i % 2) * 8), accuracy: 12 }));
    expect(pathDistanceM(pts)).toBe(0);
  });
});

describe("stage machine", () => {
  it("allows only the next stage, return straight after completion, and cancel before completion", () => {
    expect(canTransition("not_started", "trip_started")).toBe(true);
    expect(canTransition("not_started", "arrived_site")).toBe(false);
    expect(canTransition("trip_started", "arrived_site")).toBe(true);
    expect(canTransition("arrived_site", "trip_started")).toBe(false);
    expect(canTransition("visit_completed", "returned")).toBe(true);
    expect(canTransition("visit_completed", "left_site")).toBe(true);
    expect(canTransition("returned", "cancelled")).toBe(false);
    expect(canTransition("visit_in_progress", "cancelled")).toBe(true);
    expect(canTransition("not_started", "cancelled")).toBe(false);
    expect(allowedActions("not_started")).toEqual(["start"]);
    expect(allowedActions("trip_started")).toEqual(["arrive", "cancel"]);
    expect(allowedActions("returned")).toEqual([]);
  });
  it("formats durations, distances and map links", () => {
    expect(durationS("2026-01-01T10:00:00Z", "2026-01-01T10:45:00Z")).toBe(2700);
    expect(durationS("2026-01-01T10:00:00Z", null)).toBeNull();
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(12_400)).toBe("12 km");
    expect(googleMapsDirectionsUrl({ lat: 17.385, lng: 78.4867 })).toBe("https://www.google.com/maps/dir/?api=1&destination=17.385000,78.486700");
  });
  it("projects points into an SVG box", () => {
    const p = makeProjector([{ lat: 17.4, lng: 78.4 }, { lat: 17.41, lng: 78.41 }], 300, 200, 10)!;
    const a = p.project({ lat: 17.4, lng: 78.4 });
    const b = p.project({ lat: 17.41, lng: 78.41 });
    for (const pt of [a, b]) {
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(300);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(200);
    }
    expect(b.y).toBeLessThan(a.y); // north is up
    expect(b.x).toBeGreaterThan(a.x); // east is right
  });
});
