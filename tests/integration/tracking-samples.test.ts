import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor } from "../support/db";
import { seedTrackingSamples, ZAHEERABAD_VENTURE } from "@/lib/demo/tracking-samples";
import { getVisitTracking, listTeamTracking } from "@/lib/services/site-visits";

let db: Database;
const now = new Date("2026-10-12T15:30:00+05:30");

beforeAll(async () => {
  db = await createTestDb();
  const r = await db.transaction((q) => seedTrackingSamples(q, { now }));
  expect(r.created).toBe(10);
});

describe("sample GPS trips: Hyderabad → Zaheerabad venture → back", () => {
  it("is idempotent and moves the venture to Zaheerabad with a geofence", async () => {
    expect((await db.transaction((q) => seedTrackingSamples(q, { now }))).skipped).toMatch(/already/);
    const [v] = await db.query<{ latitude: string; longitude: string; geofence_radius_m: number; city: string }>(
      "select latitude, longitude, geofence_radius_m, city from ventures where code = 'SUNRISE-DEMO'");
    expect(Number(v.latitude)).toBeCloseTo(ZAHEERABAD_VENTURE.lat, 4);
    expect(Number(v.longitude)).toBeCloseTo(ZAHEERABAD_VENTURE.lng, 4);
    expect(v.city).toBe("Zaheerabad");
  });

  it("completed trips record start, arrival (geofence), visit, departure and return with realistic distance", async () => {
    const rows = await db.query<Record<string, unknown>>(
      "select * from site_visits where notes like '[sample-trip]%' and tracking_stage = 'returned' order by trip_started_at");
    expect(rows.length).toBe(8);
    for (const r of rows) {
      const t = (k: string) => new Date(r[k] as string).getTime();
      expect(t("trip_started_at")).toBeLessThan(t("arrived_at"));
      expect(t("arrived_at")).toBeLessThan(t("visit_started_at"));
      expect(t("visit_started_at")).toBeLessThan(t("visit_completed_at"));
      expect(t("visit_completed_at")).toBeLessThan(t("left_site_at"));
      expect(t("left_site_at")).toBeLessThan(t("returned_at"));
      // Hyderabad ↔ Zaheerabad round trip is roughly 180–240 km.
      expect(Number(r.total_distance_m)).toBeGreaterThan(170_000);
      expect(Number(r.total_distance_m)).toBeLessThan(260_000);
      expect(Number(r.start_lat)).toBeGreaterThan(17.38); // starts in Hyderabad
      expect(Number(r.start_lng)).toBeGreaterThan(78.3);
    }
    const auto = await db.query<{ n: number }>("select count(*)::int n from site_visit_events where stage = 'arrived_site' and source = 'geofence_auto'");
    expect(auto[0].n).toBe(9); // every trip that reached the site
  });

  it("shows live trips (en route / on site) and the team dashboard follows network privacy", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const day = "2026-10-12";
    const all = await listTeamTracking(ceo, day);
    expect(all.items.length).toBeGreaterThanOrEqual(7);
    expect(all.items.some((i) => i.employeeCode === "EMP-00125")).toBe(true);
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const team = await listTeamTracking(lakshmi, day);
    const codes = new Set(team.items.map((i) => i.employeeCode));
    expect(codes.has("EMP-00119")).toBe(false); // priya is Lakshmi's upline — never visible
    const deepaVisit = all.items.find((i) => i.employeeName === "Deepa Nair")!;
    const detail = await getVisitTracking(ceo, deepaVisit.id);
    expect(detail).toBeTruthy();
  });
});
