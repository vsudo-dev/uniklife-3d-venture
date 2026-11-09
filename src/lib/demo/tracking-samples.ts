/**
 * SAMPLE site-visit trip data for demonstrations (clearly marked "[sample-trip]").
 * Routes: Hyderabad office / employee homes → NH65 (Lingampally, Patancheru, Isnapur,
 * Sangareddy, Sadasivpet, Kohir) → demo venture near Zaheerabad → back to the start.
 * Coordinates are illustrative road waypoints, not surveyed GPS traces.
 */
import type { Queryable } from "@/lib/db/types";
import { haversineM, insideGeofence, pathDistanceM, type GeoPoint, type LatLng } from "@/lib/geo";

export const SAMPLE_TAG = "[sample-trip]";

/** Demo venture site (sample location near Zaheerabad, Telangana). */
export const ZAHEERABAD_VENTURE: LatLng & { radiusM: number } = { lat: 17.6895, lng: 77.6014, radiusM: 400 };

const NH65_WAYPOINTS: LatLng[] = [
  { lat: 17.4943, lng: 78.315 }, // Lingampally
  { lat: 17.5326, lng: 78.2649 }, // Patancheru
  { lat: 17.548, lng: 78.201 }, // Isnapur
  { lat: 17.614, lng: 78.0816 }, // Sangareddy
  { lat: 17.6203, lng: 77.9539 }, // Sadasivpet
  { lat: 17.602, lng: 77.719 }, // Kohir junction
  { lat: 17.6815, lng: 77.6077 }, // Zaheerabad
  ZAHEERABAD_VENTURE,
];

const START_POINTS: Record<string, LatLng & { label: string }> = {
  office: { lat: 17.4474, lng: 78.3762, label: "Office — HITEC City, Hyderabad" },
  kukatpally: { lat: 17.4948, lng: 78.3996, label: "Home — Kukatpally" },
  miyapur: { lat: 17.4968, lng: 78.3534, label: "Home — Miyapur" },
  gachibowli: { lat: 17.4401, lng: 78.3489, label: "Home — Gachibowli" },
  ameerpet: { lat: 17.4375, lng: 78.4483, label: "Home — Ameerpet" },
  kondapur: { lat: 17.47, lng: 78.359, label: "Home — Kondapur" },
  manikonda: { lat: 17.4027, lng: 78.386, label: "Home — Manikonda" },
  secunderabad: { lat: 17.4399, lng: 78.4983, label: "Home — Secunderabad" },
  lingampally: { lat: 17.4867, lng: 78.3179, label: "Home — Lingampally" },
};

interface TripPlan {
  email: string;
  start: keyof typeof START_POINTS;
  end: keyof typeof START_POINTS;
  startHoursAgo: number;
  visitor: string;
  outcome: string;
  /** Where the trip currently is (for live demos). */
  live?: "en_route" | "on_site";
}

const PLANS: TripPlan[] = [
  { email: "anil@demo.local", start: "kukatpally", end: "kukatpally", startHoursAgo: 1.1, visitor: "Ramesh Goud (sample)", outcome: "", live: "en_route" },
  { email: "vikram@demo.local", start: "office", end: "office", startHoursAgo: 2.6, visitor: "Lakshmi Prasanna (sample)", outcome: "", live: "on_site" },
  { email: "sneha@demo.local", start: "miyapur", end: "office", startHoursAgo: 6.5, visitor: "Srinivas Reddy (sample)", outcome: "Liked plots 17–20, requested price for 4-plot combination." },
  { email: "ravi@demo.local", start: "office", end: "office", startHoursAgo: 7.4, visitor: "Anjali Sharma (sample)", outcome: "Family visit; shortlisted corner plot 21. Follow-up call Friday." },
  { email: "lakshmi@demo.local", start: "gachibowli", end: "gachibowli", startHoursAgo: 8.2, visitor: "Mohammed Irfan (sample)", outcome: "Investor; interested in east-facing plots near the clubhouse." },
  { email: "kiran@demo.local", start: "ameerpet", end: "office", startHoursAgo: 9.0, visitor: "Venkatesh Rao (sample)", outcome: "Booked token for plot 33 on site (advance to be verified)." },
  { email: "deepa@demo.local", start: "kondapur", end: "kondapur", startHoursAgo: 10.3, visitor: "Priyanka Nair (sample)", outcome: "Wants bank-loan assistance; sent documents checklist." },
  { email: "priya@demo.local", start: "secunderabad", end: "secunderabad", startHoursAgo: 26.0, visitor: "Harsha Vardhan (sample)", outcome: "Compared with another venture; second visit planned." },
  { email: "venture.manager@demo.local", start: "office", end: "office", startHoursAgo: 28.5, visitor: "Site inspection — road & drainage (sample)", outcome: "Checked road markings and drainage near Block C." },
  { email: "anil@demo.local", start: "lingampally", end: "manikonda", startHoursAgo: 31.0, visitor: "Kavitha Reddy (sample)", outcome: "Customer chose plots 5 & 6 pricing sheet; decision next week." },
];

/** Interpolates points every ~stepM metres along a polyline. */
function densify(path: LatLng[], stepM: number): LatLng[] {
  const out: LatLng[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = haversineM(a, b);
    const n = Math.max(1, Math.round(d / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      // Small deterministic wobble so traces look like real roads, not straight rulers.
      const wob = Math.sin((i * 31 + k) * 1.7) * 0.00025;
      out.push({ lat: a.lat + (b.lat - a.lat) * t + wob, lng: a.lng + (b.lng - a.lng) * t - wob });
    }
  }
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function seedTrackingSamples(q: Queryable, opts: { force?: boolean; now?: Date } = {}): Promise<{ created: number; skipped?: string }> {
  const [v] = await q.query<{ id: string; organization_id: string }>("select id, organization_id from ventures where code = 'SUNRISE-DEMO'");
  if (!v) return { created: 0, skipped: "Demo venture not found" };
  const [existing] = await q.query<{ n: number }>("select count(*)::int as n from site_visits where venture_id = $1 and notes like $2", [v.id, `%${SAMPLE_TAG}%`]);
  if (existing.n > 0 && !opts.force) return { created: 0, skipped: "Sample trips already present" };
  if (opts.force) {
    await q.query("delete from site_visits where venture_id = $1 and notes like $2", [v.id, `%${SAMPLE_TAG}%`]);
  }

  // Move the demo venture to the sample Zaheerabad location with a geofence.
  await q.query(
    `update ventures set latitude = $2, longitude = $3, geofence_radius_m = $4, city = 'Zaheerabad', state = 'Telangana',
            location_text = 'Near Zaheerabad, NH65, Telangana (sample location — demonstration only)'
      where id = $1`,
    [v.id, ZAHEERABAD_VENTURE.lat, ZAHEERABAD_VENTURE.lng, ZAHEERABAD_VENTURE.radiusM],
  );

  const now = opts.now ?? new Date();
  const centre = ZAHEERABAD_VENTURE;
  let created = 0;

  for (const plan of PLANS) {
    const [emp] = await q.query<{ id: string; user_id: string }>(
      `select e.id, e.user_id from employees e join app_users u on u.id = e.user_id where e.organization_id = $1 and lower(u.email) = $2`,
      [v.organization_id, plan.email],
    );
    if (!emp) continue;
    const start = START_POINTS[plan.start];
    const end = START_POINTS[plan.end];
    const outbound = densify([start, ...NH65_WAYPOINTS], 1400);
    const inbound = densify([...[...NH65_WAYPOINTS].reverse(), end], 1400);
    const SPEED = 15.5; // m/s ≈ 56 km/h average incl. traffic
    const t0 = new Date(now.getTime() - plan.startHoursAgo * 3_600_000);

    // Build the timeline.
    const events: { stage: string; source: string; p: LatLng | null; at: Date; note?: string }[] = [];
    let t = t0.getTime();
    events.push({ stage: "trip_started", source: "manual", p: start, at: new Date(t), note: `Started from ${start.label}` });
    let arrivedAt: Date | null = null;
    for (let i = 1; i < outbound.length; i++) {
      t += (haversineM(outbound[i - 1], outbound[i]) / SPEED) * 1000;
      if (t > now.getTime()) break;
      const p = outbound[i];
      if (!arrivedAt && insideGeofence(p, centre, centre.radiusM)) {
        arrivedAt = new Date(t);
        events.push({ stage: "geofence_enter", source: "geofence_auto", p, at: arrivedAt });
        events.push({ stage: "arrived_site", source: "geofence_auto", p, at: arrivedAt, note: "Auto-detected on entering the venture geofence" });
        break;
      }
      events.push({ stage: "location_ping", source: "gps_ping", p, at: new Date(t) });
    }

    let visitStartedAt: Date | null = null, completedAt: Date | null = null, leftAt: Date | null = null, returnedAt: Date | null = null;
    const visitMinutes = 45 + (created % 4) * 10;
    if (arrivedAt) {
      t = arrivedAt.getTime() + 6 * 60_000;
      if (t <= now.getTime()) {
        visitStartedAt = new Date(t);
        events.push({ stage: "visit_started", source: "manual", p: centre, at: visitStartedAt, note: `Met ${plan.visitor}` });
        // On-site pings every 5 minutes while showing plots.
        const visitEnd = t + visitMinutes * 60_000;
        for (let s = t + 5 * 60_000; s < Math.min(visitEnd, now.getTime()); s += 5 * 60_000) {
          const ang = (s / 60_000) % 360;
          events.push({ stage: "location_ping", source: "gps_ping", p: { lat: centre.lat + Math.sin(ang) * 0.0012, lng: centre.lng + Math.cos(ang) * 0.0012 }, at: new Date(s) });
        }
        if (visitEnd <= now.getTime() && !plan.live) {
          completedAt = new Date(visitEnd);
          events.push({ stage: "visit_completed", source: "manual", p: centre, at: completedAt, note: plan.outcome });
          t = visitEnd + 8 * 60_000;
          let exited = false;
          for (let i = 1; i < inbound.length; i++) {
            t += (haversineM(inbound[i - 1], inbound[i]) / SPEED) * 1000;
            const p = inbound[i];
            if (!exited && !insideGeofence(p, centre, centre.radiusM)) {
              exited = true;
              leftAt = new Date(t);
              events.push({ stage: "geofence_exit", source: "geofence_auto", p, at: leftAt });
              events.push({ stage: "left_site", source: "geofence_auto", p, at: leftAt, note: "Auto-detected on leaving the venture geofence" });
              continue;
            }
            events.push({ stage: "location_ping", source: "gps_ping", p, at: new Date(t) });
          }
          returnedAt = new Date(t + 4 * 60_000);
          events.push({ stage: "returned", source: "manual", p: end, at: returnedAt, note: `Returned to ${end.label}` });
        }
      }
    }

    const stage = returnedAt ? "returned" : visitStartedAt ? "visit_in_progress" : arrivedAt ? "arrived_site" : "trip_started";
    const pts: GeoPoint[] = events.filter((e) => e.p).map((e) => ({ lat: e.p!.lat, lng: e.p!.lng, accuracy: 12 }));
    const distance = Math.round(pathDistanceM(pts));
    const checkIn = arrivedAt ? { at: arrivedAt.toISOString(), lat: round6(centre.lat), lng: round6(centre.lng), accuracy: 12, source: "browser_geolocation" } : null;
    const scheduled = new Date(t0.getTime() + 2 * 3_600_000);

    const [sv] = await q.query<{ id: string }>(
      `insert into site_visits (organization_id, venture_id, visitor_name, visitor_phone, scheduled_at, employee_id, status, notes, outcome,
                                created_by, completed_at, tracking_stage, tracking_consent_at, trip_started_at, arrived_at, visit_started_at,
                                visit_completed_at, left_site_at, returned_at, start_lat, start_lng, end_lat, end_lng,
                                check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, total_distance_m)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       returning id`,
      [
        v.organization_id, v.id, plan.visitor, "+91 90000 0" + String(1000 + created).slice(-4), scheduled, emp.id,
        completedAt ? "completed" : "scheduled", `${SAMPLE_TAG} ${start.label} → venture → ${end.label}`,
        completedAt ? JSON.stringify({ v: 1, notes: plan.outcome, checkIn }) : null,
        emp.user_id, completedAt, stage, t0, t0, arrivedAt, visitStartedAt, completedAt, leftAt, returnedAt,
        round6(start.lat), round6(start.lng), returnedAt ? round6(end.lat) : null, returnedAt ? round6(end.lng) : null,
        arrivedAt, checkIn?.lat ?? null, checkIn?.lng ?? null, arrivedAt ? 12 : null, distance,
      ],
    );

    // Bulk insert events.
    await q.query(
      `insert into site_visit_events (organization_id, site_visit_id, employee_id, stage, source, lat, lng, accuracy_m, inside_geofence,
                                      distance_to_site_m, recorded_at, received_at, note, created_by)
       select $1, $2, $3, x.stage, x.source, x.lat, x.lng, 12, x.inside, x.dist, x.at, x.at, x.note, $4
         from unnest($5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::boolean[], $10::numeric[], $11::timestamptz[], $12::text[])
              as x(stage, source, lat, lng, inside, dist, at, note)`,
      [
        v.organization_id, sv.id, emp.id, emp.user_id,
        events.map((e) => e.stage), events.map((e) => e.source),
        events.map((e) => (e.p ? round6(e.p.lat) : null)), events.map((e) => (e.p ? round6(e.p.lng) : null)),
        events.map((e) => (e.p ? insideGeofence(e.p, centre, centre.radiusM) : null)),
        events.map((e) => (e.p ? Math.round(haversineM(e.p, centre)) : null)),
        events.map((e) => e.at.toISOString()), events.map((e) => e.note ?? null),
      ],
    );
    created++;
  }
  return { created };
}
