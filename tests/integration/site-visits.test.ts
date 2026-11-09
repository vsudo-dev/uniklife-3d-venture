import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor, demoVenture, plotIds } from "../support/db";
import {
  cancelTrip, completeVisit, createSiteVisit, getVisitTracking, leaveSite, listSiteVisits, listTeamTracking, markArrived, markReturned,
  parseOutcome, recordPing, searchVisitAssignees, siteVisitCreateSchema, startTrip, startVisit, trackingActionSchema, trackingPingSchema,
  updateSiteVisit,
} from "@/lib/services/site-visits";

let db: Database;
let ventureId: string;

beforeAll(async () => {
  db = await createTestDb();
  ventureId = (await demoVenture(db)).id;
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const empId = async (code: string) => (await db.query<{ id: string }>("select id from employees where employee_code = $1", [code]))[0].id;
const reminders = (visitId: string) =>
  db.query<{ status: string; due_at: Date; recipient_user_id: string }>("select status, due_at, recipient_user_id from follow_up_reminders where site_visit_id = $1 order by due_at", [visitId]);

describe("site visits", () => {
  it("staff assignment is limited to the caller's network", async () => {
    const anil = await ctxFor(db, "anil@demo.local"); // L8, no downline
    const lakshmi = await ctxFor(db, "lakshmi@demo.local"); // L4, manages ravi … anil and deepa
    const sneha = await empId("EMP-00123");
    const ceoEmp = await empId("EMP-00118");
    const base = { ventureId, scheduledAt: inDays(3), visitorName: "Prospect A", visitorPhone: "+919811122233" };

    await expect(createSiteVisit(anil, siteVisitCreateSchema.parse({ ...base, employeeId: sneha }))).rejects.toMatchObject({ status: 404 });
    await expect(createSiteVisit(lakshmi, siteVisitCreateSchema.parse({ ...base, employeeId: ceoEmp }))).rejects.toMatchObject({ status: 404 });
    const ok = await createSiteVisit(lakshmi, siteVisitCreateSchema.parse({ ...base, employeeId: sneha }));
    expect(ok.status).toBe("scheduled");

    const assignable = await searchVisitAssignees(anil, "");
    expect(assignable.map((e) => e.employee_code)).toEqual(["EMP-00125"]);

    // Defaults to the caller when no employee is chosen.
    const own = await createSiteVisit(anil, siteVisitCreateSchema.parse(base));
    expect(own.status).toBe("scheduled");
    const deepa = await ctxFor(db, "deepa@demo.local"); // parallel team
    expect((await listSiteVisits(deepa)).some((v) => v.id === own.id)).toBe(false);
    expect((await listSiteVisits(lakshmi)).some((v) => v.id === own.id)).toBe(true);
    await expect(updateSiteVisit(deepa, own.id, { action: "cancel", reason: "not mine" })).rejects.toMatchObject({ status: 404 });
  });

  it("creates 24h/2h reminders and notifications, cancels reminders on cancel and reschedules them", async () => {
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const ravi = await empId("EMP-00122");
    const [raviUser] = await db.query<{ user_id: string }>("select user_id from employees where id = $1", [ravi]);
    const plots = await plotIds(db, ventureId, ["50", "51"]);
    const v = await createSiteVisit(lakshmi, siteVisitCreateSchema.parse({ ventureId, plotIds: plots, scheduledAt: inDays(2), visitorName: "Prospect B", visitorPhone: "+919811100099", employeeId: ravi }));
    expect(v.remindersScheduled).toBe(2);
    let rs = await reminders(v.id);
    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.status === "pending" && r.recipient_user_id === raviUser.user_id)).toBe(true);
    const notes = await db.query<{ type: string }>("select type from notifications where recipient_user_id = $1 and link like $2", [raviUser.user_id, `%${v.id}%`]);
    expect(notes.some((n) => n.type === "site_visit_update")).toBe(true);
    const [evt] = await db.query<{ n: number }>("select count(*)::int as n from outbound_events where event_type = 'site_visit.created' and aggregate_id = $1", [v.id]);
    expect(evt.n).toBe(1);

    // Reschedule to 5 hours from now: only the 2h reminder is still in the future.
    const soon = new Date(Date.now() + 5 * 3600_000);
    await updateSiteVisit(lakshmi, v.id, { action: "reschedule", scheduledAt: soon, note: "Customer asked" });
    rs = await reminders(v.id);
    expect(rs.filter((r) => r.status === "pending")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "cancelled")).toHaveLength(2);

    await updateSiteVisit(lakshmi, v.id, { action: "cancel", reason: "Customer travelling" });
    rs = await reminders(v.id);
    expect(rs.every((r) => r.status === "cancelled")).toBe(true);
    await expect(updateSiteVisit(lakshmi, v.id, { action: "complete", outcome: "should fail" })).rejects.toMatchObject({ status: 409 });
  });

  it("customers request visits for themselves and only see their own", async () => {
    const customer = await ctxFor(db, "customer@demo.local");
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const req = await createSiteVisit(customer, siteVisitCreateSchema.parse({ ventureId, scheduledAt: inDays(4), employeeId: await empId("EMP-00125") }));
    expect(req.status).toBe("requested");
    const [row] = await db.query<{ employee_id: string | null; visitor_name: string; customer_id: string }>("select employee_id, visitor_name, customer_id from site_visits where id = $1", [req.id]);
    expect(row.employee_id).toBeNull(); // customers cannot choose staff
    expect(row.visitor_name).toBe("Demo Customer");
    expect(row.customer_id).toBe(customer.customerId);

    const staffVisit = await createSiteVisit(lakshmi, siteVisitCreateSchema.parse({ ventureId, scheduledAt: inDays(5), visitorName: "Someone Else", visitorPhone: "+919800011111" }));
    const mine = await listSiteVisits(customer);
    expect(mine.map((v) => v.id)).toContain(req.id);
    expect(mine.map((v) => v.id)).not.toContain(staffVisit.id);
    expect(mine.every((v) => !("notes" in v) && !("employee_code" in v))).toBe(true);
    await expect(updateSiteVisit(customer, staffVisit.id, { action: "cancel", reason: "not mine" })).rejects.toMatchObject({ status: 404 });
    await expect(updateSiteVisit(customer, req.id, { action: "reschedule", scheduledAt: new Date(inDays(6)) })).rejects.toMatchObject({ status: 403 });

    // Unassigned requests are visible to the sales manager, who can assign and confirm them.
    expect((await listSiteVisits(lakshmi)).some((v) => v.id === req.id)).toBe(true);
    const assigned = await updateSiteVisit(lakshmi, req.id, { action: "assign", employeeId: await empId("EMP-00124") });
    expect(assigned.status).toBe("scheduled");
    expect((await reminders(req.id)).filter((r) => r.status === "pending")).toHaveLength(2);
    await updateSiteVisit(customer, req.id, { action: "cancel", reason: "Change of plans" });
    expect((await reminders(req.id)).every((r) => r.status === "cancelled")).toBe(true);
  });

  it("completes a visit with check-in time and optional location", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const v = await createSiteVisit(anil, siteVisitCreateSchema.parse({ ventureId, scheduledAt: inDays(1), visitorName: "Prospect C", visitorPhone: "+919811144455" }));
    const before = Date.now();
    await updateSiteVisit(anil, v.id, { action: "complete", outcome: "Liked plots 60-61, will revert", checkIn: { lat: 17.385044, lng: 78.486671, accuracy: 12.4 } });
    const [row] = await db.query<{ status: string; completed_at: Date; outcome: string }>("select status, completed_at, outcome from site_visits where id = $1", [v.id]);
    expect(row.status).toBe("completed");
    expect(new Date(row.completed_at).getTime()).toBeGreaterThanOrEqual(before - 5000);
    const parsed = parseOutcome(row.outcome);
    expect(parsed.notes).toMatch(/Liked plots/);
    expect(parsed.checkIn).toMatchObject({ lat: 17.385044, lng: 78.486671, accuracy: 12, source: "browser_geolocation" });
    expect((await reminders(v.id)).every((r) => r.status === "cancelled")).toBe(true);
    const [evt] = await db.query<{ n: number }>("select count(*)::int as n from outbound_events where event_type = 'site_visit.completed' and aggregate_id = $1", [v.id]);
    expect(evt.n).toBe(1);
    const [audit] = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where entity_id = $1 and action = 'site_visit.complete'", [v.id]);
    expect(audit.n).toBe(1);

    // Without location permission the check-in is still recorded.
    const v2 = await createSiteVisit(anil, siteVisitCreateSchema.parse({ ventureId, scheduledAt: inDays(1), visitorName: "Prospect D", visitorPhone: "+919811144456" }));
    await updateSiteVisit(anil, v2.id, { action: "complete", outcome: "Visited, no decision yet", checkIn: null });
    const [row2] = await db.query<{ outcome: string }>("select outcome from site_visits where id = $1", [v2.id]);
    expect(parseOutcome(row2.outcome).checkIn).toMatchObject({ lat: null, lng: null, source: "none" });
    const listed = (await listSiteVisits(anil)).find((x) => x.id === v2.id)!;
    expect(listed.outcome_notes).toBe("Visited, no decision yet");
  });
});

describe("site visit trip tracking", () => {
  const SITE = { lat: 17.4, lng: 78.5 };
  /** Point `m` metres north of the site. */
  const fromSite = (m: number) => ({ lat: SITE.lat + m / 111_195, lng: SITE.lng });
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  let n = 0;
  const newAnilVisit = async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    return createSiteVisit(anil, siteVisitCreateSchema.parse({ ventureId, scheduledAt: inDays(1), visitorName: `Tracked ${++n}`, visitorPhone: "+919811155566" }));
  };
  const managerUserOf = async (code: string) =>
    (await db.query<{ user_id: string }>(
      "select m.user_id from employees e join employees m on m.id = e.reporting_manager_id where e.employee_code = $1",
      [code],
    ))[0].user_id;

  beforeAll(async () => {
    await db.query("update ventures set latitude = $2, longitude = $3, geofence_radius_m = 300 where id = $1", [ventureId, SITE.lat, SITE.lng]);
  });

  it("runs the full stage flow with timestamps, notifications, outbound event and audit", async () => {
    // Every recorded stage belongs to one timeline, independent of test runtime.
    const scenarioNow = Date.now();
    const ago = (min: number) => new Date(scenarioNow - min * 60_000);
    const anil = await ctxFor(db, "anil@demo.local");
    const v = await newAnilVisit();
    const far = fromSite(8000);

    await expect(startTrip(anil, v.id, { consent: false, ...far, recordedAt: ago(120) })).rejects.toMatchObject({ status: 400 });
    await expect(markArrived(anil, v.id, {})).rejects.toMatchObject({ status: 409 }); // not started

    const s1 = await startTrip(anil, v.id, { consent: true, ...far, accuracy: 10, recordedAt: ago(120) });
    expect(s1.stage).toBe("trip_started");
    expect(s1.consentAt).not.toBeNull();
    await expect(startVisit(anil, v.id, { recordedAt: ago(110) })).rejects.toMatchObject({ status: 409 }); // must arrive first

    // Pings 5 s apart: the second is dropped by the server-side 15 s spacing rule.
    const p = await recordPing(anil, v.id, [
      { ...fromSite(4000), accuracy: 10, recordedAt: ago(100) },
      { ...fromSite(3990), accuracy: 10, recordedAt: new Date(ago(100).getTime() + 5000) },
    ]);
    expect(p).toMatchObject({ accepted: 1, dropped: 1, stage: "trip_started", insideGeofence: false });
    expect(p.totalDistanceM).toBeGreaterThan(3900);

    await expect(markArrived(anil, v.id, { recordedAt: ago(130) })).rejects.toMatchObject({ status: 400 }); // earlier than trip start
    await markArrived(anil, v.id, { ...fromSite(50), accuracy: 8, recordedAt: ago(80) });
    await startVisit(anil, v.id, { recordedAt: ago(75) });
    await expect(completeVisit(anil, v.id, { recordedAt: ago(40) })).rejects.toMatchObject({ status: 400 }); // outcome required
    const done = await completeVisit(anil, v.id, { outcome: "Shown plots 12-14, will revert", recordedAt: ago(40) });
    expect(done).toMatchObject({ stage: "visit_completed", status: "completed" });
    await leaveSite(anil, v.id, { recordedAt: ago(35) });
    const back = await markReturned(anil, v.id, { ...fromSite(8000), accuracy: 12, recordedAt: ago(10) });
    expect(back.stage).toBe("returned");

    const [row] = await db.query<Record<string, unknown>>("select * from site_visits where id = $1", [v.id]);
    expect(row.status).toBe("completed");
    expect(Number(row.check_in_lat)).toBeCloseTo(fromSite(50).lat, 5);
    expect(Number(row.end_lat)).toBeCloseTo(far.lat, 5);
    expect(parseOutcome(row.outcome).checkIn).toMatchObject({ source: "browser_geolocation" });

    const t = await getVisitTracking(anil, v.id);
    expect(t.summary.travelToSiteS).toBe(40 * 60);
    expect(t.summary.timeOnSiteS).toBe(45 * 60);
    expect(t.summary.visitDurationS).toBe(35 * 60);
    expect(t.summary.returnTravelS).toBe(25 * 60);
    expect(t.summary.totalTripS).toBe(110 * 60);
    expect(t.summary.totalDistanceM).toBeGreaterThan(15_500);
    expect(t.events.map((e) => e.stage)).toEqual(["trip_started", "location_ping", "arrived_site", "visit_started", "visit_completed", "left_site", "returned"]);
    expect(t.viewer.isAssignee).toBe(true);

    const vikramUser = await managerUserOf("EMP-00125");
    const notes = await db.query<{ title: string; link: string }>("select title, link from notifications where recipient_user_id = $1 and link = $2 order by created_at", [vikramUser, `/site-visits/${v.id}/track`]);
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toMatch(/arrived/i);
    expect(notes[1].title).toMatch(/back/i);
    const [evt] = await db.query<{ n: number }>("select count(*)::int as n from outbound_events where event_type = 'site_visit.completed' and aggregate_id = $1", [v.id]);
    expect(evt.n).toBe(1);
    const [audit] = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where entity_id = $1 and action like 'site_visit.tracking.%'", [v.id]);
    expect(audit.n).toBe(6);

    // Terminal: no further stages and no pings after return.
    await expect(markArrived(anil, v.id, {})).rejects.toMatchObject({ status: 409 });
    await expect(cancelTrip(anil, v.id, {})).rejects.toMatchObject({ status: 409 });
    await expect(recordPing(anil, v.id, [{ ...far, accuracy: 5, recordedAt: new Date() }])).rejects.toMatchObject({ status: 409 });
  });

  it("auto-detects arrival on entering the geofence and departure on leaving it", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const v = await newAnilVisit();
    await startTrip(anil, v.id, { consent: true, ...fromSite(5000), accuracy: 15, recordedAt: ago(60) });
    const r = await recordPing(anil, v.id, [
      { ...fromSite(3000), accuracy: 20, recordedAt: ago(50) },
      { ...fromSite(1200), accuracy: 20, recordedAt: ago(45) },
      { ...fromSite(120), accuracy: 15, recordedAt: ago(40) },
      { ...fromSite(60), accuracy: 10, recordedAt: ago(39) },
    ]);
    expect(r.stage).toBe("arrived_site");
    expect(r.autoTransitions.map((x) => x.stage)).toEqual(["arrived_site"]);
    expect(Math.abs(new Date(r.autoTransitions[0].at).getTime() - ago(40).getTime())).toBeLessThan(5000);
    expect(r.insideGeofence).toBe(true);
    const evts = await db.query<{ stage: string; source: string }>("select stage, source from site_visit_events where site_visit_id = $1 and source = 'geofence_auto' order by recorded_at, received_at", [v.id]);
    expect(evts.map((e) => e.stage)).toEqual(["geofence_enter", "arrived_site"]);
    const [row] = await db.query<{ tracking_stage: string; arrived_at: Date; check_in_lat: string }>("select tracking_stage, arrived_at, check_in_lat from site_visits where id = $1", [v.id]);
    expect(row.tracking_stage).toBe("arrived_site");
    expect(Number(row.check_in_lat)).toBeCloseTo(fromSite(120).lat, 5);

    await startVisit(anil, v.id, { recordedAt: ago(35) });
    await completeVisit(anil, v.id, { outcome: "Interested in corner plots", recordedAt: ago(20) });
    // Still on site → no exit; then well outside → left_site.
    const stay = await recordPing(anil, v.id, [{ ...fromSite(80), accuracy: 10, recordedAt: ago(15) }]);
    expect(stay.stage).toBe("visit_completed");
    const exit = await recordPing(anil, v.id, [{ ...fromSite(900), accuracy: 10, recordedAt: ago(10) }]);
    expect(exit.stage).toBe("left_site");
    const back = await markReturned(anil, v.id, { recordedAt: ago(1) });
    expect(back.leftSiteAt).not.toBeNull();
    expect(back.returnedAt).not.toBeNull();
  });

  it("rejects pings outside an active trip, from others and with bad timestamps", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const deepa = await ctxFor(db, "deepa@demo.local");
    const v = await newAnilVisit();
    const pt = { ...fromSite(2000), accuracy: 10 };

    await expect(recordPing(anil, v.id, [{ ...pt, recordedAt: new Date() }])).rejects.toMatchObject({ status: 409 }); // no trip yet
    await expect(startTrip(lakshmi, v.id, { consent: true, reason: "on behalf" })).rejects.toMatchObject({ status: 403 });
    await startTrip(anil, v.id, { consent: true, ...pt, recordedAt: ago(5) });

    await expect(recordPing(lakshmi, v.id, [{ ...pt, recordedAt: new Date() }])).rejects.toMatchObject({ status: 403 }); // upline, not assignee
    await expect(recordPing(deepa, v.id, [{ ...pt, recordedAt: new Date() }])).rejects.toMatchObject({ status: 404 }); // peer
    await expect(recordPing(anil, v.id, [{ ...pt, recordedAt: new Date(Date.now() + 10 * 60_000) }])).rejects.toMatchObject({ status: 400 });
    await expect(recordPing(anil, v.id, [{ ...pt, recordedAt: new Date(Date.now() - 25 * 3600_000) }])).rejects.toMatchObject({ status: 400 });
    expect(() => trackingPingSchema.parse({ points: [{ lat: 95, lng: 78, recordedAt: new Date().toISOString() }] })).toThrow();
    expect(() => trackingPingSchema.parse({ points: Array.from({ length: 51 }, () => ({ lat: 1, lng: 1, recordedAt: new Date().toISOString() })) })).toThrow();
    expect(() => trackingActionSchema.parse({ action: "arrive", lat: 17.4 })).toThrow();

    // Upline correction requires a reason and never stores the manager's coordinates.
    await expect(markArrived(lakshmi, v.id, {})).rejects.toMatchObject({ status: 403 });
    await markArrived(lakshmi, v.id, { reason: "Anil's phone battery died at the site", lat: 1, lng: 1 });
    const [e] = await db.query<{ note: string; lat: string | null; source: string }>("select note, lat, source from site_visit_events where site_visit_id = $1 and stage = 'arrived_site'", [v.id]);
    expect(e).toMatchObject({ lat: null, source: "manual" });
    expect(e.note).toMatch(/Correction by .*battery/);
    await cancelTrip(anil, v.id, { reason: "Customer postponed" });
    await expect(recordPing(anil, v.id, [{ ...pt, recordedAt: new Date() }])).rejects.toMatchObject({ status: 409 });
  });

  it("location data is visible only to the employee, their upline and org-wide roles", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const v = await newAnilVisit();
    await startTrip(anil, v.id, { consent: true, ...fromSite(3000), accuracy: 10, recordedAt: ago(3) });

    const deepa = await ctxFor(db, "deepa@demo.local");
    await expect(getVisitTracking(deepa, v.id)).rejects.toMatchObject({ status: 404 });
    expect((await listTeamTracking(deepa)).items.some((i) => i.id === v.id)).toBe(false);

    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const t = await getVisitTracking(lakshmi, v.id);
    expect(t.events).toHaveLength(1);
    expect(t.viewer).toMatchObject({ isAssignee: false, canCorrect: true });
    const team = await listTeamTracking(lakshmi);
    expect(team.items.find((i) => i.id === v.id)).toMatchObject({ stage: "trip_started", employeeCode: "EMP-00125" });

    const ceo = await ctxFor(db, "ceo@demo.local");
    expect((await getVisitTracking(ceo, v.id)).visit.id).toBe(v.id);
    const vm = await ctxFor(db, "venture.manager@demo.local");
    expect((await getVisitTracking(vm, v.id)).visit.id).toBe(v.id);

    const orgB = await ctxFor(db, "admin@sample-b.local");
    await expect(getVisitTracking(orgB, v.id)).rejects.toMatchObject({ status: 404 });
    expect((await listTeamTracking(orgB)).items.some((i) => i.id === v.id)).toBe(false);
    const customer = await ctxFor(db, "customer@demo.local");
    await expect(getVisitTracking(customer, v.id)).rejects.toMatchObject({ status: 403 });
    expect((await listSiteVisits(customer)).every((x) => !("tracking_stage" in x))).toBe(true);

    // Employees see only their own rows.
    const own = await listTeamTracking(anil);
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((i) => i.employeeId === anil.employee!.id)).toBe(true);
  });

  it("location events are append-only", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const v = await newAnilVisit();
    await startTrip(anil, v.id, { consent: true, ...fromSite(3000), accuracy: 10, recordedAt: ago(2) });
    await expect(db.query("update site_visit_events set note = 'tampered' where site_visit_id = $1", [v.id])).rejects.toThrow();
    const [e] = await db.query<{ note: string | null }>("select note from site_visit_events where site_visit_id = $1", [v.id]);
    expect(e.note).toBeNull();
  });
});
