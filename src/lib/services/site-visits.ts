import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { num, numOrNull } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff, can, canAccessVenture, inNetwork } from "@/lib/auth/context";
import {
  ACTION_LABELS, ACTION_TARGET, STAGE_LABELS, canTransition, durationS, haversineM, insideGeofence, isPingStage, pathDistanceM,
  type LatLng, type TrackingAction, type TrackingStage,
} from "@/lib/geo";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { db, isUuid, withTx } from "./common";
import { normalizePhone } from "./customers";
import { createNotification } from "./notifications";

/**
 * Site visits: staff schedule visits for prospects; customers request visits for
 * themselves. Reminders (24h / 2h before) go to the assigned employee; check-in on
 * completion records the time and (only with the user's browser permission) location.
 *
 * Storage note: there are no dedicated check-in columns. The completion record is
 * stored as JSON in `outcome` ({ v: 1, notes, checkIn }) and parsed by `parseOutcome`.
 */

export const SITE_VISIT_STATUSES = ["requested", "scheduled", "completed", "cancelled", "no_show"] as const;
export type SiteVisitStatus = (typeof SITE_VISIT_STATUSES)[number];
export const REMINDER_OFFSETS_HOURS = [24, 2];

const dateTimeInput = z
  .string()
  .trim()
  .min(1)
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date/time");

const phoneInput = z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid mobile number");

export const siteVisitCreateSchema = z.object({
  ventureId: z.string().uuid(),
  plotIds: z.array(z.string().uuid()).max(10).default([]),
  scheduledAt: dateTimeInput,
  visitorName: z.string().trim().min(2).max(120).optional().nullable(),
  visitorPhone: phoneInput.optional().nullable().or(z.literal("").transform(() => null)),
  customerId: z.string().uuid().optional().nullable(),
  enquiryId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type SiteVisitCreateInput = z.infer<typeof siteVisitCreateSchema>;

export const siteVisitActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reschedule"), scheduledAt: dateTimeInput, note: z.string().trim().max(500).optional().nullable() }),
  z.object({ action: z.literal("assign"), employeeId: z.string().uuid() }),
  z.object({ action: z.literal("schedule") }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("no_show"), note: z.string().trim().max(500).optional().nullable() }),
  z.object({
    action: z.literal("complete"),
    outcome: z.string().trim().min(3).max(2000),
    checkIn: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000).optional().nullable(),
      })
      .optional()
      .nullable(),
  }),
]);
export type SiteVisitAction = z.infer<typeof siteVisitActionSchema>;

export interface CheckIn {
  at: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  source: "browser_geolocation" | "none";
}

export function parseOutcome(raw: unknown): { notes: string | null; checkIn: CheckIn | null } {
  if (typeof raw !== "string" || !raw) return { notes: null, checkIn: null };
  try {
    const o = JSON.parse(raw) as { v?: number; notes?: string; checkIn?: CheckIn };
    if (o && o.v === 1) return { notes: o.notes ?? null, checkIn: o.checkIn ?? null };
  } catch {
    /* plain text outcome */
  }
  return { notes: raw, checkIn: null };
}

type VisitRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  venture_id: string;
  customer_id: string | null;
  employee_id: string | null;
  created_by: string | null;
  status: SiteVisitStatus;
  scheduled_at: Date | string;
  visitor_name: string;
  plot_ids: string[];
};

/** Visibility: customers → own; org-wide roles → all (venture scope); others → own network, own created, (managers) unassigned. */
export function canSeeVisit(ctx: AuthContext, v: VisitRow): boolean {
  if (v.organization_id !== ctx.organizationId) return false;
  if (ctx.role === "customer") return !!ctx.customerId && v.customer_id === ctx.customerId;
  if (!canAccessVenture(ctx, v.venture_id)) return false;
  if (ctx.networkEmployeeIds === null) return true;
  if (v.created_by === ctx.user.id) return true;
  if (inNetwork(ctx, v.employee_id)) return true;
  return ctx.role === "sales_manager" && !v.employee_id;
}

async function lockVisit(ctx: AuthContext, q: Queryable, id: string): Promise<VisitRow> {
  if (!isUuid(id)) throw notFound("Site visit");
  const [v] = await q.query<VisitRow>("select * from site_visits where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
  if (!v || !canSeeVisit(ctx, v)) throw notFound("Site visit");
  return v;
}

/** Employee the caller may assign: active, in the org and inside the caller's network. */
async function resolveAssignee(ctx: AuthContext, q: Queryable, employeeId: string) {
  if (!inNetwork(ctx, employeeId)) throw notFound("Employee");
  const [e] = await q.query<{ id: string; user_id: string | null; full_name: string; employee_code: string }>(
    "select id, user_id, full_name, employee_code from employees where organization_id = $1 and id = $2 and employment_status = 'active'",
    [ctx.organizationId, employeeId],
  );
  if (!e) throw notFound("Employee");
  return e;
}

async function employeeUser(q: Queryable, orgId: string, employeeId: string | null): Promise<string | null> {
  if (!employeeId) return null;
  const [e] = await q.query<{ user_id: string | null }>(
    `select e.user_id from employees e join organization_members m on m.user_id = e.user_id and m.organization_id = e.organization_id
      where e.id = $1 and e.organization_id = $2 and m.status = 'active' and m.role <> 'customer'`,
    [employeeId, orgId],
  );
  return e?.user_id ?? null;
}

export async function cancelVisitReminders(q: Queryable, visitId: string) {
  await q.query("update follow_up_reminders set status = 'cancelled' where site_visit_id = $1 and status = 'pending'", [visitId]);
}

/** (Re)schedules the 24h and 2h reminders for the assigned employee's user. Past due times are skipped. */
export async function scheduleVisitReminders(q: Queryable, orgId: string, visitId: string, employeeId: string | null, scheduledAt: Date) {
  await cancelVisitReminders(q, visitId);
  const userId = await employeeUser(q, orgId, employeeId);
  if (!userId) return 0;
  let n = 0;
  for (const h of REMINDER_OFFSETS_HOURS) {
    const due = new Date(scheduledAt.getTime() - h * 3600_000);
    if (due.getTime() <= Date.now()) continue;
    await q.query(
      "insert into follow_up_reminders (organization_id, kind, site_visit_id, recipient_user_id, due_at) values ($1, 'site_visit', $2, $3, $4)",
      [orgId, visitId, userId, due],
    );
    n++;
  }
  return n;
}

const fmtWhen = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function notifyAssignee(
  q: Queryable,
  ctx: AuthContext,
  v: { id: string; employee_id: string | null },
  title: string,
  body: string,
  dedupe: string,
) {
  const userId = await employeeUser(q, ctx.organizationId, v.employee_id);
  if (!userId || userId === ctx.user.id) return;
  await createNotification(q, {
    organizationId: ctx.organizationId, recipientUserId: userId, type: "site_visit_update", title, body,
    link: `/site-visits?focus=${v.id}`, followUpAction: "Review the site visit", dedupeKey: `site_visit:${v.id}:${dedupe}:${userId}`,
  });
}

export async function createSiteVisit(ctx: AuthContext, input: SiteVisitCreateInput) {
  const isCustomer = ctx.role === "customer";
  if (!isCustomer) assertPermission(ctx, "site_visit.manage");
  if (input.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw badRequest("The visit time must be in the future");
  if (input.scheduledAt.getTime() > Date.now() + 366 * 86400_000) throw badRequest("The visit must be within the next year");

  return withTx(async (q) => {
    const [v] = await q.query<{ id: string; name: string; is_published: boolean }>(
      "select id, name, is_published from ventures where organization_id = $1 and id = $2",
      [ctx.organizationId, input.ventureId],
    );
    if (!v || (isCustomer ? !v.is_published : !canAccessVenture(ctx, v.id))) throw notFound("Venture");
    const plotIds = [...new Set(input.plotIds)];
    let plotNumbers: string[] = [];
    if (plotIds.length) {
      const rows = await q.query<{ plot_number: string }>(
        "select plot_number from plots where venture_id = $1 and id = any($2::uuid[]) order by length(plot_number), plot_number",
        [v.id, plotIds],
      );
      if (rows.length !== plotIds.length) throw notFound("Plot");
      plotNumbers = rows.map((r) => r.plot_number);
    }

    let customerId: string | null = null;
    let visitorName = input.visitorName ?? null;
    let visitorPhone = input.visitorPhone ? normalizePhone(input.visitorPhone) : null;
    let employeeId: string | null = null;
    let enquiryId: string | null = null;

    if (isCustomer) {
      if (!ctx.customerId) throw forbidden("Your customer profile is incomplete");
      const [c] = await q.query<{ id: string; full_name: string; phone: string | null }>(
        "select id, full_name, phone from customers where id = $1 and organization_id = $2",
        [ctx.customerId, ctx.organizationId],
      );
      if (!c) throw forbidden();
      customerId = c.id;
      visitorName = visitorName ?? c.full_name;
      visitorPhone = visitorPhone ?? (c.phone ? normalizePhone(c.phone) : null);
      // Customers cannot choose staff, link enquiries or pick other customers.
    } else {
      if (input.customerId) {
        const [c] = await q.query<{ id: string; full_name: string; phone: string | null }>(
          "select id, full_name, phone from customers where id = $1 and organization_id = $2",
          [input.customerId, ctx.organizationId],
        );
        if (!c) throw notFound("Customer");
        customerId = c.id;
        visitorName = visitorName ?? c.full_name;
        visitorPhone = visitorPhone ?? (c.phone ? normalizePhone(c.phone) : null);
      }
      if (input.enquiryId) {
        const [e] = await q.query<{ id: string; assigned_employee_id: string | null; venture_id: string }>(
          "select id, assigned_employee_id, venture_id from enquiries where id = $1 and organization_id = $2",
          [input.enquiryId, ctx.organizationId],
        );
        const visible = e && canAccessVenture(ctx, e.venture_id) &&
          (ctx.networkEmployeeIds === null || inNetwork(ctx, e.assigned_employee_id) || (ctx.role === "sales_manager" && !e.assigned_employee_id));
        if (!visible) throw notFound("Enquiry");
        enquiryId = e.id;
      }
      const target = input.employeeId ?? ctx.employee?.id ?? null;
      if (target) employeeId = (await resolveAssignee(ctx, q, target)).id;
    }
    if (!visitorName || visitorName.length < 2) throw badRequest("Visitor name is required");
    if (!visitorPhone) throw badRequest("Visitor mobile number is required");

    const status: SiteVisitStatus = isCustomer || !employeeId ? "requested" : "scheduled";
    const [row] = await q.query<VisitRow>(
      `insert into site_visits (organization_id, venture_id, customer_id, enquiry_id, visitor_name, visitor_phone, scheduled_at, employee_id,
                                status, plot_ids, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12) returning *`,
      [ctx.organizationId, v.id, customerId, enquiryId, visitorName, visitorPhone, input.scheduledAt, employeeId, status, plotIds, input.notes ?? null, ctx.user.id],
    );
    const reminders = await scheduleVisitReminders(q, ctx.organizationId, row.id, employeeId, input.scheduledAt);
    const plotsText = plotNumbers.length ? ` (plots ${plotNumbers.join(", ")})` : "";
    await notifyAssignee(q, ctx, row, "Site visit assigned to you", `${visitorName} — ${v.name}${plotsText} on ${fmtWhen(input.scheduledAt)}.`, "created");
    if (!employeeId) {
      // Unassigned requests: notify org admins and sales managers so someone picks it up.
      const managers = await q.query<{ user_id: string }>(
        "select user_id from organization_members where organization_id = $1 and role in ('org_admin','sales_manager') and status = 'active'",
        [ctx.organizationId],
      );
      for (const m of managers) {
        if (m.user_id === ctx.user.id) continue;
        await createNotification(q, {
          organizationId: ctx.organizationId, recipientUserId: m.user_id, type: "site_visit_update", title: "New site visit request",
          body: `${visitorName} requested a visit to ${v.name}${plotsText} on ${fmtWhen(input.scheduledAt)}.`,
          link: `/site-visits?focus=${row.id}`, followUpAction: "Assign an employee and confirm the visit", dedupeKey: `site_visit:${row.id}:request:${m.user_id}`,
        });
      }
    }
    await writeAudit(q, ctx, {
      action: "site_visit.created", entityType: "site_visit", entityId: row.id,
      summary: `Site visit ${status} for ${visitorName} at ${v.name} on ${input.scheduledAt.toISOString()}`, after: row,
    });
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "site_visit.created", aggregateType: "site_visit", aggregateId: row.id,
      idempotencyKey: `site_visit.created:${row.id}`,
      data: {
        site_visit_id: row.id, venture_id: v.id, venture_name: v.name, plot_numbers: plotNumbers, scheduled_at: input.scheduledAt.toISOString(),
        status, visitor_name: visitorName, visitor_phone: visitorPhone, customer_id: customerId, source: isCustomer ? "portal" : "staff",
      },
    });
    return { id: row.id, status, remindersScheduled: reminders };
  });
}

export interface SiteVisitFilters {
  status?: string;
  ventureId?: string;
  mine?: boolean;
  from?: string;
  to?: string;
  q?: string;
}

export async function listSiteVisits(ctx: AuthContext, f: SiteVisitFilters = {}) {
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["s.organization_id = $1"];
  if (ctx.role === "customer") {
    params.push(ctx.customerId);
    where.push(`s.customer_id = $${params.length}`);
  } else {
    assertStaff(ctx);
    assertPermission(ctx, "site_visit.manage");
    if (ctx.ventureIds !== null) {
      params.push(ctx.ventureIds);
      where.push(`s.venture_id = any($${params.length}::uuid[])`);
    }
    if (ctx.networkEmployeeIds !== null) {
      params.push(ctx.networkEmployeeIds, ctx.user.id);
      where.push(`(s.employee_id = any($${params.length - 1}::uuid[]) or s.created_by = $${params.length}${ctx.role === "sales_manager" ? " or s.employee_id is null" : ""})`);
    }
    if (f.mine) {
      params.push(ctx.employee?.id ?? null);
      where.push(`s.employee_id = $${params.length}`);
    }
  }
  if (f.status && (SITE_VISIT_STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where.push(`s.status = $${params.length}`);
  }
  if (f.ventureId && isUuid(f.ventureId)) {
    params.push(f.ventureId);
    where.push(`s.venture_id = $${params.length}`);
  }
  if (f.from && !Number.isNaN(Date.parse(f.from))) {
    params.push(new Date(f.from));
    where.push(`s.scheduled_at >= $${params.length}`);
  }
  if (f.to && !Number.isNaN(Date.parse(f.to))) {
    params.push(new Date(f.to));
    where.push(`s.scheduled_at < $${params.length}`);
  }
  if (f.q && ctx.role !== "customer") {
    params.push(`%${f.q.toLowerCase()}%`);
    where.push(`(lower(s.visitor_name) like $${params.length} or s.visitor_phone like $${params.length})`);
  }
  const rows = await q.query<Record<string, unknown>>(
    `select s.id, s.venture_id, s.customer_id, s.enquiry_id, s.visitor_name, s.visitor_phone, s.scheduled_at, s.employee_id, s.status,
            s.plot_ids, s.notes, s.outcome, s.completed_at, s.created_at, s.created_by,
            s.tracking_stage, s.arrived_at, s.returned_at,
            v.name as venture_name, emp.employee_code as employee_code, emp.full_name as employee_name,
            array(select p.plot_number from plots p where p.id = any(s.plot_ids) order by length(p.plot_number), p.plot_number) as plot_numbers
       from site_visits s join ventures v on v.id = s.venture_id left join employees emp on emp.id = s.employee_id
      where ${where.join(" and ")}
      order by s.scheduled_at asc limit 500`,
    params,
  );
  return rows.map((r) => {
    const { notes, checkIn } = parseOutcome(r.outcome);
    const out: Record<string, unknown> = { ...r, outcome_notes: notes, check_in: checkIn };
    delete out.outcome;
    if (ctx.role === "customer") {
      // Customers see who will meet them, but never internal notes or employee codes.
      delete out.notes;
      delete out.employee_code;
      delete out.created_by;
      delete out.enquiry_id;
      delete out.check_in;
      delete out.outcome_notes;
      // Employee location / trip tracking is never shown to customers.
      delete out.tracking_stage;
      delete out.arrived_at;
      delete out.returned_at;
    }
    return out;
  });
}

export async function getSiteVisit(ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw notFound("Site visit");
  const rows = await listSiteVisits(ctx, {});
  const v = rows.find((r) => r.id === id);
  if (!v) throw notFound("Site visit");
  return v;
}

export async function updateSiteVisit(ctx: AuthContext, id: string, input: SiteVisitAction) {
  const isCustomer = ctx.role === "customer";
  if (isCustomer && input.action !== "cancel") throw forbidden("Please contact the sales team to change this visit");
  if (!isCustomer) assertPermission(ctx, "site_visit.manage");

  return withTx(async (q) => {
    const before = await lockVisit(ctx, q, id);
    const scheduledAt = new Date(before.scheduled_at);
    const [venture] = await q.query<{ name: string }>("select name from ventures where id = $1", [before.venture_id]);
    let after: VisitRow;
    let summary = "";

    switch (input.action) {
      case "reschedule": {
        if (!["requested", "scheduled"].includes(before.status)) throw conflict(`A ${before.status} visit cannot be rescheduled`);
        if (input.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw badRequest("The visit time must be in the future");
        [after] = await q.query<VisitRow>(
          `update site_visits set scheduled_at = $3, notes = case when $4::text is null then notes else concat_ws(E'\\n', notes, $4::text) end
            where id = $1 and organization_id = $2 returning *`,
          [id, ctx.organizationId, input.scheduledAt, input.note ? `Rescheduled: ${input.note}` : null],
        );
        await scheduleVisitReminders(q, ctx.organizationId, id, after.employee_id, input.scheduledAt);
        summary = `Rescheduled to ${input.scheduledAt.toISOString()}`;
        await notifyAssignee(q, ctx, after, "Site visit rescheduled", `${before.visitor_name} — ${venture.name} moved to ${fmtWhen(input.scheduledAt)}.`, `resched:${input.scheduledAt.getTime()}`);
        break;
      }
      case "assign": {
        if (!["requested", "scheduled"].includes(before.status)) throw conflict(`A ${before.status} visit cannot be reassigned`);
        const e = await resolveAssignee(ctx, q, input.employeeId);
        [after] = await q.query<VisitRow>(
          "update site_visits set employee_id = $3, status = case when status = 'requested' then 'scheduled' else status end where id = $1 and organization_id = $2 returning *",
          [id, ctx.organizationId, e.id],
        );
        await scheduleVisitReminders(q, ctx.organizationId, id, e.id, scheduledAt);
        summary = `Assigned to ${e.employee_code}`;
        await notifyAssignee(q, ctx, after, "Site visit assigned to you", `${before.visitor_name} — ${venture.name} on ${fmtWhen(scheduledAt)}.`, `assign:${e.id}`);
        break;
      }
      case "schedule": {
        if (before.status !== "requested") throw conflict(`A ${before.status} visit cannot be scheduled`);
        if (!before.employee_id) throw conflict("Assign an employee before confirming the visit");
        [after] = await q.query<VisitRow>("update site_visits set status = 'scheduled' where id = $1 and organization_id = $2 returning *", [id, ctx.organizationId]);
        summary = "Visit confirmed (scheduled)";
        break;
      }
      case "cancel": {
        if (!["requested", "scheduled"].includes(before.status)) throw conflict(`A ${before.status} visit cannot be cancelled`);
        [after] = await q.query<VisitRow>(
          "update site_visits set status = 'cancelled', notes = concat_ws(E'\\n', notes, $3::text) where id = $1 and organization_id = $2 returning *",
          [id, ctx.organizationId, `Cancelled${isCustomer ? " by customer" : ""}: ${input.reason}`],
        );
        await cancelVisitReminders(q, id);
        summary = `Cancelled: ${input.reason}`;
        await notifyAssignee(q, ctx, after, "Site visit cancelled", `${before.visitor_name} — ${venture.name} on ${fmtWhen(scheduledAt)} was cancelled.`, "cancel");
        break;
      }
      case "no_show": {
        if (before.status !== "scheduled") throw conflict(`Only a scheduled visit can be marked as no-show`);
        [after] = await q.query<VisitRow>(
          "update site_visits set status = 'no_show', notes = case when $3::text is null then notes else concat_ws(E'\\n', notes, $3::text) end where id = $1 and organization_id = $2 returning *",
          [id, ctx.organizationId, input.note ? `No-show: ${input.note}` : null],
        );
        await cancelVisitReminders(q, id);
        summary = "Marked as no-show";
        break;
      }
      case "complete": {
        if (before.status !== "scheduled") throw conflict("Only a scheduled visit can be completed");
        const checkIn: CheckIn = {
          at: new Date().toISOString(),
          lat: input.checkIn ? Math.round(input.checkIn.lat * 1e6) / 1e6 : null,
          lng: input.checkIn ? Math.round(input.checkIn.lng * 1e6) / 1e6 : null,
          accuracy: input.checkIn?.accuracy != null ? Math.round(input.checkIn.accuracy) : null,
          source: input.checkIn ? "browser_geolocation" : "none",
        };
        const outcome = JSON.stringify({ v: 1, notes: input.outcome, checkIn, by: ctx.user.id });
        [after] = await q.query<VisitRow>(
          "update site_visits set status = 'completed', completed_at = now(), outcome = $3 where id = $1 and organization_id = $2 returning *",
          [id, ctx.organizationId, outcome],
        );
        await cancelVisitReminders(q, id);
        summary = `Completed (check-in ${checkIn.source === "browser_geolocation" ? "with location" : "without location"})`;
        await notifyAssignee(q, ctx, after, "Site visit completed", `${before.visitor_name} — ${venture.name} was marked completed.`, "complete");
        await enqueueOutboundEvent(q, {
          organizationId: ctx.organizationId, eventType: "site_visit.completed", aggregateType: "site_visit", aggregateId: id,
          idempotencyKey: `site_visit.completed:${id}`,
          data: {
            site_visit_id: id, venture_id: before.venture_id, venture_name: venture.name, visitor_name: before.visitor_name,
            customer_id: before.customer_id, completed_at: checkIn.at, outcome: input.outcome, location_captured: checkIn.source === "browser_geolocation",
          },
        });
        break;
      }
    }
    await writeAudit(q, ctx, { action: `site_visit.${input.action}`, entityType: "site_visit", entityId: id, summary, before, after: after! });
    return { id, status: after!.status };
  });
}

/** Employees the caller may assign visits to (own network; everyone for org-wide roles). */
export async function searchVisitAssignees(ctx: AuthContext, term: string) {
  assertPermission(ctx, "site_visit.manage");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["organization_id = $1", "employment_status = 'active'"];
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds);
    where.push(`id = any($${params.length}::uuid[])`);
  }
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    where.push(`(lower(full_name) like $${params.length} or lower(employee_code) like $${params.length})`);
  }
  return q.query<{ id: string; employee_code: string; full_name: string; designation: string | null }>(
    `select id, employee_code, full_name, designation from employees where ${where.join(" and ")} order by full_name limit 20`,
    params,
  );
}

/** Customer portal: the signed-in customer's own name/phone to prefill the request form. */
export async function myVisitorDefaults(ctx: AuthContext): Promise<{ name: string | null; phone: string | null }> {
  if (ctx.role !== "customer" || !ctx.customerId) return { name: ctx.user.fullName, phone: null };
  const q = await db();
  const [c] = await q.query<{ full_name: string; phone: string | null }>(
    "select full_name, phone from customers where id = $1 and organization_id = $2",
    [ctx.customerId, ctx.organizationId],
  );
  return c ? { name: c.full_name, phone: c.phone } : { name: ctx.user.fullName, phone: null };
}

/** Published (customer) or accessible (staff) ventures for the visit form. */
export async function visitFormOptions(ctx: AuthContext, ventureId?: string | null) {
  const q = await db();
  const isCustomer = ctx.role === "customer";
  if (!isCustomer) assertPermission(ctx, "site_visit.manage");
  const params: unknown[] = [ctx.organizationId];
  let where = "organization_id = $1 and status <> 'archived'";
  if (isCustomer) where += " and is_published = true";
  else if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    where += ` and id = any($2::uuid[])`;
  }
  const ventures = await q.query<{ id: string; name: string }>(`select id, name from ventures where ${where} order by name`, params);
  let plots: { id: string; plot_number: string; status: string }[] = [];
  if (ventureId && ventures.some((v) => v.id === ventureId)) {
    plots = await q.query("select id, plot_number, status from plots where venture_id = $1 order by length(plot_number), plot_number", [ventureId]);
  }
  return { ventures, plots };
}

// ===========================================================================
// Site-visit trip tracking (consent-based, foreground GPS, stage by stage)
// ===========================================================================
//
// Privacy model:
// - Tracking happens ONLY during a trip the assigned employee starts, after explicit
//   consent (tracking_consent_at). Pings are refused outside an active trip.
// - Location data is visible to the employee, their reporting chain (managers whose
//   network contains them) and org-wide roles (org admin / venture manager, within
//   their venture scope). Never to peers, other teams or customers.
// - Events are append-only evidence (DB trigger forbids updates).
// Retention recommendation: purge raw location_ping events after 90 days and keep
// the stage events + summary columns (see RETENTION_NOTE).

export const RETENTION_NOTE =
  "Recommended retention: keep raw GPS pings for 90 days, then purge them and keep only stage times and trip totals. Stage events are retained as audit evidence for as long as the site-visit record.";

/** Server-side minimum spacing between stored GPS pings for one visit. */
export const MIN_PING_INTERVAL_MS = 15_000;
export const MAX_PINGS_PER_BATCH = 50;
const FUTURE_TOLERANCE_MS = 2 * 60_000;
const MAX_AGE_MS = 24 * 3600_000;

const instantInput = z
  .union([z.string().trim().min(1), z.number()])
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid timestamp");

export const trackingPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional().nullable(),
  recordedAt: instantInput,
});
export type TrackingPoint = z.infer<typeof trackingPointSchema>;

export const trackingPingSchema = z.object({
  points: z.array(trackingPointSchema).min(1).max(MAX_PINGS_PER_BATCH),
});

export const TRACKING_ACTIONS = ["start", "arrive", "start_visit", "complete", "leave", "return", "cancel"] as const;

export const trackingActionSchema = z
  .object({
    action: z.enum(TRACKING_ACTIONS),
    consent: z.boolean().optional(),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    accuracy: z.number().min(0).max(100000).optional().nullable(),
    recordedAt: instantInput.optional().nullable(),
    outcome: z.string().trim().max(2000).optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => (v.lat == null) === (v.lng == null), { message: "Latitude and longitude must be given together", path: ["lat"] });
export type TrackingActionInput = Omit<z.infer<typeof trackingActionSchema>, "action">;

type TrackRow = VisitRow & {
  tracking_stage: TrackingStage;
  tracking_consent_at: Date | string | null;
  trip_started_at: Date | string | null;
  arrived_at: Date | string | null;
  visit_started_at: Date | string | null;
  visit_completed_at: Date | string | null;
  left_site_at: Date | string | null;
  returned_at: Date | string | null;
  check_in_at: Date | string | null;
  check_in_lat: string | null;
  check_in_lng: string | null;
  check_in_accuracy_m: string | null;
  total_distance_m: string;
  outcome: string | null;
};

const STAGE_TIME_COLUMN: Partial<Record<TrackingStage, keyof TrackRow>> = {
  trip_started: "trip_started_at",
  arrived_site: "arrived_at",
  visit_in_progress: "visit_started_at",
  visit_completed: "visit_completed_at",
  left_site: "left_site_at",
  returned: "returned_at",
};

const EVENT_STAGE: Record<TrackingStage, string | null> = {
  not_started: null,
  trip_started: "trip_started",
  arrived_site: "arrived_site",
  visit_in_progress: "visit_started",
  visit_completed: "visit_completed",
  left_site: "left_site",
  returned: "returned",
  cancelled: "cancelled",
};

/**
 * Tracking visibility (stricter than canSeeVisit): staff only, the visit must be
 * assigned, inside the caller's venture scope, and the assignee must be the caller
 * or in the caller's downline (org-wide roles: everyone).
 */
export function canSeeTracking(ctx: AuthContext, v: { organization_id: string; venture_id: string; employee_id: string | null }): boolean {
  if (v.organization_id !== ctx.organizationId) return false;
  if (ctx.role === "customer") return false;
  if (!v.employee_id) return false;
  if (!canAccessVenture(ctx, v.venture_id)) return false;
  return inNetwork(ctx, v.employee_id);
}

async function lockTrackedVisit(ctx: AuthContext, q: Queryable, id: string): Promise<TrackRow> {
  if (!isUuid(id)) throw notFound("Site visit");
  const [v] = await q.query<TrackRow>("select * from site_visits where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
  if (!v || !canSeeTracking(ctx, v)) throw notFound("Site visit");
  return v;
}

type Actor = { mode: "self" } | { mode: "correction"; note: string };

/** The assigned employee acts directly; upline managers with site_visit.manage may correct with a reason. */
function trackingActor(ctx: AuthContext, v: TrackRow, reason?: string | null): Actor {
  if (ctx.employee && ctx.employee.id === v.employee_id) return { mode: "self" };
  if (!can(ctx, "site_visit.manage")) throw forbidden();
  if (!reason || reason.trim().length < 3) throw forbidden("Only the assigned employee can update this trip. Managers must give a reason (min 3 characters) to correct it.");
  return { mode: "correction", note: `Correction by ${ctx.user.fullName}: ${reason.trim()}` };
}

function checkRecordedAt(d: Date, now = Date.now()) {
  if (d.getTime() > now + FUTURE_TOLERANCE_MS) throw badRequest("Location time is in the future — please check the device clock");
  if (d.getTime() < now - MAX_AGE_MS) throw badRequest("Location time is more than 24 hours old");
}

const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : null);
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

interface VentureGeo {
  id: string;
  name: string;
  centre: LatLng | null;
  radiusM: number;
}

async function loadVentureGeo(q: Queryable, orgId: string, ventureId: string): Promise<VentureGeo> {
  const [v] = await q.query<{ id: string; name: string; latitude: string | null; longitude: string | null; geofence_radius_m: number | string | null }>(
    "select id, name, latitude, longitude, geofence_radius_m from ventures where organization_id = $1 and id = $2",
    [orgId, ventureId],
  );
  if (!v) throw notFound("Venture");
  const lat = numOrNull(v.latitude);
  const lng = numOrNull(v.longitude);
  return { id: v.id, name: v.name, centre: lat != null && lng != null ? { lat, lng } : null, radiusM: num(v.geofence_radius_m ?? 300) || 300 };
}

function geoFor(venture: VentureGeo, p: { lat: number; lng: number; accuracy?: number | null } | null) {
  if (!p || !venture.centre) return { inside: null as boolean | null, distance: null as number | null };
  const distance = Math.round(haversineM(p, venture.centre) * 10) / 10;
  return { inside: insideGeofence(p, venture.centre, venture.radiusM, p.accuracy ?? null), distance };
}

async function insertEvent(
  q: Queryable,
  ctx: AuthContext,
  v: TrackRow,
  e: {
    stage: string; source: "manual" | "gps_ping" | "geofence_auto"; at: Date;
    point?: { lat: number; lng: number; accuracy?: number | null } | null; inside?: boolean | null; distance?: number | null; note?: string | null;
  },
) {
  await q.query(
    `insert into site_visit_events (organization_id, site_visit_id, employee_id, stage, source, lat, lng, accuracy_m, inside_geofence,
                                    distance_to_site_m, recorded_at, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      ctx.organizationId, v.id, v.employee_id, e.stage, e.source, e.point?.lat ?? null, e.point?.lng ?? null,
      e.point?.accuracy != null ? Math.round(e.point.accuracy * 10) / 10 : null, e.inside ?? null, e.distance ?? null, e.at, e.note ?? null, ctx.user.id,
    ],
  );
}

/** Recomputes the jitter-filtered travelled distance from every located event of the trip. */
async function recomputeDistance(q: Queryable, visitId: string): Promise<number> {
  const pts = await q.query<{ lat: string; lng: string; accuracy_m: string | null }>(
    "select lat, lng, accuracy_m from site_visit_events where site_visit_id = $1 and lat is not null order by recorded_at, received_at",
    [visitId],
  );
  const total = pathDistanceM(pts.map((p) => ({ lat: num(p.lat), lng: num(p.lng), accuracy: numOrNull(p.accuracy_m) })));
  await q.query("update site_visits set total_distance_m = $2 where id = $1", [visitId, total]);
  return total;
}

const fmtTime = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

/** Notifies the assignee's direct reporting manager (not the actor themself). */
async function notifyDirectManager(q: Queryable, ctx: AuthContext, v: TrackRow, kind: "arrived" | "returned", venture: VentureGeo, at: Date) {
  const [e] = await q.query<{ reporting_manager_id: string | null; full_name: string }>(
    "select reporting_manager_id, full_name from employees where id = $1 and organization_id = $2",
    [v.employee_id, ctx.organizationId],
  );
  if (!e) return;
  const userId = await employeeUser(q, ctx.organizationId, e.reporting_manager_id);
  if (!userId || userId === ctx.user.id) return;
  const title = kind === "arrived" ? `${e.full_name} arrived at ${venture.name}` : `${e.full_name} is back from ${venture.name}`;
  const body = kind === "arrived"
    ? `Arrived ${fmtTime(at)} for the visit with ${v.visitor_name}.`
    : `Returned ${fmtTime(at)} after the visit with ${v.visitor_name}.`;
  await createNotification(q, {
    organizationId: ctx.organizationId, recipientUserId: userId, type: "site_visit_update", title, body,
    link: `/site-visits/${v.id}/track`, followUpAction: "View the trip timeline", dedupeKey: `site_visit:${v.id}:track:${kind}:${userId}`,
  });
}

function trackingState(v: TrackRow) {
  return {
    id: v.id,
    status: v.status,
    stage: v.tracking_stage,
    consentAt: iso(v.tracking_consent_at),
    tripStartedAt: iso(v.trip_started_at),
    arrivedAt: iso(v.arrived_at),
    visitStartedAt: iso(v.visit_started_at),
    visitCompletedAt: iso(v.visit_completed_at),
    leftSiteAt: iso(v.left_site_at),
    returnedAt: iso(v.returned_at),
    totalDistanceM: num(v.total_distance_m),
  };
}
export type TrackingState = ReturnType<typeof trackingState>;

async function applyTransition(ctx: AuthContext, id: string, action: TrackingAction, input: TrackingActionInput) {
  assertStaff(ctx);
  const at = input.recordedAt ?? new Date();
  checkRecordedAt(at);

  return withTx(async (q) => {
    const v = await lockTrackedVisit(ctx, q, id);
    const actor = trackingActor(ctx, v, input.reason);
    const target = ACTION_TARGET[action];
    if (!canTransition(v.tracking_stage, target)) {
      throw conflict(`"${ACTION_LABELS[action]}" is not possible while the trip is at "${STAGE_LABELS[v.tracking_stage] ?? v.tracking_stage}"`);
    }
    if (action === "start") {
      if (actor.mode !== "self") throw forbidden("Only the assigned employee can start a trip");
      if (input.consent !== true) throw badRequest("Your consent to location tracking during this trip is required to start it");
      if (v.status !== "scheduled") throw conflict("Only a scheduled visit can be tracked");
    }
    if (action === "complete" && !["scheduled", "completed"].includes(v.status)) throw conflict(`A ${v.status} visit cannot be completed`);
    if (action === "complete" && v.status === "scheduled" && (!input.outcome || input.outcome.trim().length < 3)) {
      throw badRequest("Outcome notes (min 3 characters) are required to complete the visit");
    }

    // Monotonic stage times: a stage can never be earlier than the previous one.
    const prevTimes = Object.values(STAGE_TIME_COLUMN).map((c) => ms(v[c!] as Date | string | null)).filter((t): t is number => t != null);
    const prev = prevTimes.length ? Math.max(...prevTimes) : null;
    if (prev != null && at.getTime() < prev - 1000) throw badRequest("This time is earlier than the previous stage of the trip");

    // Managers correcting a trip are not at the location: their coordinates are never recorded.
    const point = actor.mode === "self" && input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng, accuracy: input.accuracy ?? null }
      : null;
    const venture = await loadVentureGeo(q, ctx.organizationId, v.venture_id);
    const g = geoFor(venture, point);

    const params: unknown[] = [id, ctx.organizationId, target];
    const sets = ["tracking_stage = $3"];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    let impliedLeave = false;
    switch (action) {
      case "start":
        set("trip_started_at", at);
        set("tracking_consent_at", new Date());
        if (point) { set("start_lat", point.lat); set("start_lng", point.lng); }
        break;
      case "arrive":
        set("arrived_at", at);
        set("check_in_at", at);
        if (point) { set("check_in_lat", point.lat); set("check_in_lng", point.lng); set("check_in_accuracy_m", point.accuracy); }
        break;
      case "start_visit":
        set("visit_started_at", at);
        break;
      case "complete": {
        set("visit_completed_at", at);
        if (v.status === "scheduled") {
          const ciLat = numOrNull(v.check_in_lat) ?? point?.lat ?? null;
          const ciLng = numOrNull(v.check_in_lng) ?? point?.lng ?? null;
          const ciAcc = numOrNull(v.check_in_accuracy_m) ?? (ciLat != null ? point?.accuracy ?? null : null);
          const checkIn: CheckIn = {
            at: iso(v.check_in_at) ?? at.toISOString(),
            lat: ciLat != null ? Math.round(ciLat * 1e6) / 1e6 : null,
            lng: ciLng != null ? Math.round(ciLng * 1e6) / 1e6 : null,
            accuracy: ciAcc != null ? Math.round(ciAcc) : null,
            source: ciLat != null ? "browser_geolocation" : "none",
          };
          set("status", "completed");
          set("completed_at", at);
          set("outcome", JSON.stringify({ v: 1, notes: input.outcome!.trim(), checkIn, by: ctx.user.id }));
          if (!v.check_in_at) set("check_in_at", at);
        }
        break;
      }
      case "leave":
        set("left_site_at", at);
        break;
      case "return":
        set("returned_at", at);
        if (!v.left_site_at) { set("left_site_at", at); impliedLeave = true; }
        if (point) { set("end_lat", point.lat); set("end_lng", point.lng); }
        break;
      case "cancel":
        break;
    }
    const [after] = await q.query<TrackRow>(`update site_visits set ${sets.join(", ")} where id = $1 and organization_id = $2 returning *`, params);

    const baseNote = actor.mode === "correction" ? actor.note : action === "cancel" && input.reason ? `Cancelled: ${input.reason}` : null;
    if (impliedLeave) await insertEvent(q, ctx, v, { stage: "left_site", source: "manual", at, note: "Implied by return" });
    await insertEvent(q, ctx, v, { stage: EVENT_STAGE[target]!, source: "manual", at, point, inside: g.inside, distance: g.distance, note: baseNote });
    let totalDistanceM = num(after.total_distance_m);
    if (point) totalDistanceM = await recomputeDistance(q, id);
    after.total_distance_m = String(totalDistanceM);

    if (action === "complete" && v.status === "scheduled") {
      await cancelVisitReminders(q, id);
      await enqueueOutboundEvent(q, {
        organizationId: ctx.organizationId, eventType: "site_visit.completed", aggregateType: "site_visit", aggregateId: id,
        idempotencyKey: `site_visit.completed:${id}`,
        data: {
          site_visit_id: id, venture_id: v.venture_id, venture_name: venture.name, visitor_name: v.visitor_name, customer_id: v.customer_id,
          completed_at: at.toISOString(), outcome: input.outcome!.trim(), location_captured: after.check_in_lat != null,
          trip: { trip_started_at: iso(after.trip_started_at), arrived_at: iso(after.arrived_at), visit_started_at: iso(after.visit_started_at) },
        },
      });
    }
    if (action === "arrive") await notifyDirectManager(q, ctx, after, "arrived", venture, at);
    if (action === "return") await notifyDirectManager(q, ctx, after, "returned", venture, at);

    await writeAudit(q, ctx, {
      action: `site_visit.tracking.${action}`, entityType: "site_visit", entityId: id,
      summary: `Trip ${STAGE_LABELS[v.tracking_stage]} → ${STAGE_LABELS[target]}${actor.mode === "correction" ? ` (${actor.note})` : ""}${point ? " with location" : ""}`,
      before: { tracking_stage: v.tracking_stage, status: v.status },
      after: { tracking_stage: after.tracking_stage, status: after.status, recorded_at: at.toISOString() },
      metadata: { source: "manual", correction: actor.mode === "correction" },
    });
    return trackingState(after);
  });
}

export function startTrip(ctx: AuthContext, id: string, input: TrackingActionInput) { return applyTransition(ctx, id, "start", input); }
export function markArrived(ctx: AuthContext, id: string, input: TrackingActionInput = {}) { return applyTransition(ctx, id, "arrive", input); }
export function startVisit(ctx: AuthContext, id: string, input: TrackingActionInput = {}) { return applyTransition(ctx, id, "start_visit", input); }
export function completeVisit(ctx: AuthContext, id: string, input: TrackingActionInput) { return applyTransition(ctx, id, "complete", input); }
export function leaveSite(ctx: AuthContext, id: string, input: TrackingActionInput = {}) { return applyTransition(ctx, id, "leave", input); }
export function markReturned(ctx: AuthContext, id: string, input: TrackingActionInput = {}) { return applyTransition(ctx, id, "return", input); }
export function cancelTrip(ctx: AuthContext, id: string, input: TrackingActionInput = {}) { return applyTransition(ctx, id, "cancel", input); }

/** API dispatcher for { action, ... } bodies. */
export function applyTrackingAction(ctx: AuthContext, id: string, input: z.infer<typeof trackingActionSchema>) {
  const { action, ...rest } = input;
  return applyTransition(ctx, id, action, rest);
}

/**
 * Stores a batch of GPS fixes (max 50) for an active trip of the caller. Fixes closer
 * than 15 s to the previous stored ping are dropped. Auto-detects geofence entry
 * (trip_started → arrived_site) and exit (visit_completed → left_site) when the
 * venture has coordinates.
 */
export async function recordPing(ctx: AuthContext, id: string, points: TrackingPoint[]) {
  assertStaff(ctx);
  if (!points.length) throw badRequest("No location points");
  if (points.length > MAX_PINGS_PER_BATCH) throw badRequest(`At most ${MAX_PINGS_PER_BATCH} points per batch`);
  const now = Date.now();
  for (const p of points) {
    if (!(p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180)) throw badRequest("Invalid coordinates");
    checkRecordedAt(p.recordedAt, now);
  }

  return withTx(async (q) => {
    const v = await lockTrackedVisit(ctx, q, id);
    if (!ctx.employee || ctx.employee.id !== v.employee_id) throw forbidden("Only the assigned employee can share location for this trip");
    if (!isPingStage(v.tracking_stage)) throw conflict("There is no active trip for this visit — location is not being recorded");
    const venture = await loadVentureGeo(q, ctx.organizationId, v.venture_id);
    const [meta] = await q.query<{ last_ping: Date | string | null; ever_inside: boolean }>(
      `select max(recorded_at) filter (where stage = 'location_ping') as last_ping, coalesce(bool_or(inside_geofence), false) as ever_inside
         from site_visit_events where site_visit_id = $1`,
      [id],
    );
    let lastAt = ms(meta?.last_ping) ?? Number.NEGATIVE_INFINITY;
    let everInside = !!meta?.ever_inside;
    const tripStart = ms(v.trip_started_at) ?? 0;
    let stage = v.tracking_stage;
    let accepted = 0;
    let dropped = 0;
    let last: { inside: boolean | null; distance: number | null; at: string } | null = null;
    const autoTransitions: { stage: TrackingStage; at: string }[] = [];

    for (const p of [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
      const t = p.recordedAt.getTime();
      if (t < tripStart - 1000 || t - lastAt < MIN_PING_INTERVAL_MS) {
        dropped++;
        continue;
      }
      lastAt = t;
      const point = { lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null };
      const g = geoFor(venture, point);
      await insertEvent(q, ctx, v, { stage: "location_ping", source: "gps_ping", at: p.recordedAt, point, inside: g.inside, distance: g.distance });
      accepted++;
      last = { inside: g.inside, distance: g.distance, at: p.recordedAt.toISOString() };

      if (g.inside === true && stage === "trip_started") {
        await insertEvent(q, ctx, v, { stage: "geofence_enter", source: "geofence_auto", at: p.recordedAt, point, inside: true, distance: g.distance });
        await insertEvent(q, ctx, v, { stage: "arrived_site", source: "geofence_auto", at: p.recordedAt, point, inside: true, distance: g.distance, note: "Detected automatically on entering the site geofence" });
        const [after] = await q.query<TrackRow>(
          `update site_visits set tracking_stage = 'arrived_site', arrived_at = $2, check_in_at = $2, check_in_lat = $3, check_in_lng = $4, check_in_accuracy_m = $5
            where id = $1 returning *`,
          [id, p.recordedAt, p.lat, p.lng, p.accuracy ?? null],
        );
        stage = "arrived_site";
        autoTransitions.push({ stage, at: p.recordedAt.toISOString() });
        await notifyDirectManager(q, ctx, after, "arrived", venture, p.recordedAt);
        await writeAudit(q, ctx, {
          action: "site_visit.tracking.arrive", entityType: "site_visit", entityId: id,
          summary: `Arrival detected by geofence (${Math.round(g.distance ?? 0)} m from site)`,
          before: { tracking_stage: "trip_started" }, after: { tracking_stage: stage, recorded_at: p.recordedAt.toISOString() }, metadata: { source: "geofence_auto" },
        });
      } else if (g.inside === false && stage === "visit_completed" && everInside) {
        await insertEvent(q, ctx, v, { stage: "geofence_exit", source: "geofence_auto", at: p.recordedAt, point, inside: false, distance: g.distance });
        await insertEvent(q, ctx, v, { stage: "left_site", source: "geofence_auto", at: p.recordedAt, point, inside: false, distance: g.distance, note: "Detected automatically on leaving the site geofence" });
        await q.query("update site_visits set tracking_stage = 'left_site', left_site_at = $2 where id = $1", [id, p.recordedAt]);
        stage = "left_site";
        autoTransitions.push({ stage, at: p.recordedAt.toISOString() });
        await writeAudit(q, ctx, {
          action: "site_visit.tracking.leave", entityType: "site_visit", entityId: id, summary: "Departure detected by geofence",
          before: { tracking_stage: "visit_completed" }, after: { tracking_stage: stage, recorded_at: p.recordedAt.toISOString() }, metadata: { source: "geofence_auto" },
        });
      }
      if (g.inside === true) everInside = true;
    }
    const totalDistanceM = accepted ? await recomputeDistance(q, id) : num(v.total_distance_m);
    return {
      accepted, dropped, stage, autoTransitions, totalDistanceM,
      insideGeofence: last?.inside ?? null, distanceToSiteM: last?.distance ?? null, lastPingAt: last?.at ?? null,
      minIntervalMs: MIN_PING_INTERVAL_MS,
    };
  });
}

// ---------------------------------------------------------------------------
// Tracking queries
// ---------------------------------------------------------------------------

export interface TrackingEvent {
  id: string;
  stage: string;
  source: "manual" | "gps_ping" | "geofence_auto";
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  insideGeofence: boolean | null;
  distanceToSiteM: number | null;
  recordedAt: string;
  receivedAt: string;
  note: string | null;
}

function summarize(v: Record<string, unknown>, nowMs = Date.now()) {
  const stage = String(v.tracking_stage) as TrackingStage;
  const now = new Date(nowMs);
  const onSite = ["arrived_site", "visit_in_progress", "visit_completed"].includes(stage);
  const active = isPingStage(stage);
  const d = (k: string) => (v[k] ? (v[k] as Date | string) : null);
  return {
    stage,
    tripStartedAt: iso(d("trip_started_at")),
    arrivedAt: iso(d("arrived_at")),
    visitStartedAt: iso(d("visit_started_at")),
    visitCompletedAt: iso(d("visit_completed_at")),
    leftSiteAt: iso(d("left_site_at")),
    returnedAt: iso(d("returned_at")),
    travelToSiteS: durationS(d("trip_started_at"), d("arrived_at") ?? (stage === "trip_started" ? now : null)),
    timeOnSiteS: durationS(d("arrived_at"), d("left_site_at") ?? (onSite ? now : null)),
    visitDurationS: durationS(d("visit_started_at"), d("visit_completed_at") ?? (stage === "visit_in_progress" ? now : null)),
    returnTravelS: durationS(d("left_site_at"), d("returned_at") ?? (stage === "left_site" ? now : null)),
    totalTripS: durationS(d("trip_started_at"), d("returned_at") ?? (active ? now : null)),
    totalDistanceM: num(v.total_distance_m),
    active,
    onSite,
  };
}
export type TrackingSummary = ReturnType<typeof summarize>;

/** Full trip timeline + summary for one visit (employee, upline managers, org-wide roles only). */
export async function getVisitTracking(ctx: AuthContext, id: string) {
  assertStaff(ctx);
  if (!isUuid(id)) throw notFound("Site visit");
  const q = await db();
  const [v] = await q.query<Record<string, unknown> & TrackRow>(
    `select s.*, v.name as venture_name, v.latitude as venture_lat, v.longitude as venture_lng, v.geofence_radius_m,
            e.full_name as employee_name, e.employee_code
       from site_visits s join ventures v on v.id = s.venture_id left join employees e on e.id = s.employee_id
      where s.organization_id = $1 and s.id = $2`,
    [ctx.organizationId, id],
  );
  if (!v || !canSeeTracking(ctx, v)) throw notFound("Site visit");
  const rows = await q.query<Record<string, unknown>>(
    `select id, stage, source, lat, lng, accuracy_m, inside_geofence, distance_to_site_m, recorded_at, received_at, note
       from site_visit_events where organization_id = $1 and site_visit_id = $2 order by recorded_at, received_at limit 5000`,
    [ctx.organizationId, id],
  );
  const events: TrackingEvent[] = rows.map((r) => ({
    id: String(r.id), stage: String(r.stage), source: r.source as TrackingEvent["source"],
    lat: numOrNull(r.lat), lng: numOrNull(r.lng), accuracy: numOrNull(r.accuracy_m),
    insideGeofence: r.inside_geofence == null ? null : Boolean(r.inside_geofence), distanceToSiteM: numOrNull(r.distance_to_site_m),
    recordedAt: iso(r.recorded_at as Date)!, receivedAt: iso(r.received_at as Date)!, note: (r.note as string | null) ?? null,
  }));
  const located = events.filter((e) => e.lat != null);
  const lastLoc = located[located.length - 1] ?? null;
  const vLat = numOrNull(v.venture_lat);
  const vLng = numOrNull(v.venture_lng);
  const isAssignee = !!ctx.employee && ctx.employee.id === v.employee_id;
  const { notes } = parseOutcome(v.outcome);
  return {
    visit: {
      id: v.id, status: v.status, visitorName: v.visitor_name, scheduledAt: iso(v.scheduled_at)!, employeeId: v.employee_id,
      employeeName: (v.employee_name as string | null) ?? null, employeeCode: (v.employee_code as string | null) ?? null,
      consentAt: iso(v.tracking_consent_at), outcomeNotes: notes,
      start: v.start_lat != null ? { lat: num(v.start_lat), lng: num(v.start_lng) } : null,
      end: v.end_lat != null ? { lat: num(v.end_lat), lng: num(v.end_lng) } : null,
      checkIn: v.check_in_lat != null ? { lat: num(v.check_in_lat), lng: num(v.check_in_lng), accuracy: numOrNull(v.check_in_accuracy_m), at: iso(v.check_in_at) } : null,
    },
    venture: {
      id: v.venture_id, name: String(v.venture_name),
      centre: vLat != null && vLng != null ? { lat: vLat, lng: vLng } : null,
      radiusM: num(v.geofence_radius_m) || 300,
    },
    events,
    summary: { ...summarize(v), lastLocationAt: lastLoc?.recordedAt ?? null, lastLocation: lastLoc ? { lat: lastLoc.lat!, lng: lastLoc.lng! } : null, pingCount: events.filter((e) => e.stage === "location_ping").length },
    viewer: { isAssignee, canCorrect: !isAssignee && can(ctx, "site_visit.manage") },
    retentionNote: RETENTION_NOTE,
  };
}
export type VisitTracking = Awaited<ReturnType<typeof getVisitTracking>>;

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * Team tracking for one day (IST): every visible employee's visits scheduled or
 * started that day. Org-wide roles see all (within venture scope); everyone else
 * only their network (self + downline) — a leaf employee sees only themself.
 */
export async function listTeamTracking(ctx: AuthContext, date?: string | null) {
  assertStaff(ctx);
  assertPermission(ctx, "site_visit.manage");
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00+05:30`)) ? date : istDay(new Date());
  const from = new Date(`${day}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 86_400_000);
  const q = await db();
  const params: unknown[] = [ctx.organizationId, from, to];
  const where = [
    "s.organization_id = $1", "s.employee_id is not null",
    "((s.scheduled_at >= $2 and s.scheduled_at < $3) or (s.trip_started_at >= $2 and s.trip_started_at < $3))",
  ];
  if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    where.push(`s.venture_id = any($${params.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds);
    where.push(`s.employee_id = any($${params.length}::uuid[])`);
  }
  const rows = await q.query<Record<string, unknown>>(
    `select s.id, s.employee_id, s.visitor_name, s.scheduled_at, s.status, s.tracking_stage, s.trip_started_at, s.arrived_at, s.visit_started_at,
            s.visit_completed_at, s.left_site_at, s.returned_at, s.total_distance_m, v.name as venture_name,
            e.full_name as employee_name, e.employee_code,
            (select max(ev.recorded_at) from site_visit_events ev where ev.site_visit_id = s.id) as last_update_at,
            (select max(ev.recorded_at) from site_visit_events ev where ev.site_visit_id = s.id and ev.lat is not null) as last_location_at
       from site_visits s join ventures v on v.id = s.venture_id join employees e on e.id = s.employee_id
      where ${where.join(" and ")}
      order by e.full_name, s.scheduled_at limit 1000`,
    params,
  );
  const items = rows.map((r) => ({
    id: String(r.id), employeeId: String(r.employee_id), employeeName: String(r.employee_name), employeeCode: String(r.employee_code),
    visitorName: String(r.visitor_name), ventureName: String(r.venture_name), scheduledAt: iso(r.scheduled_at as Date)!, status: String(r.status),
    lastUpdateAt: iso(r.last_update_at as Date | null), lastLocationAt: iso(r.last_location_at as Date | null),
    ...summarize(r),
  }));
  return {
    date: day,
    items,
    counts: {
      employees: new Set(items.map((i) => i.employeeId)).size,
      visits: items.length,
      active: items.filter((i) => i.active).length,
      onSite: items.filter((i) => i.onSite).length,
      returned: items.filter((i) => i.stage === "returned").length,
    },
  };
}
export type TeamTracking = Awaited<ReturnType<typeof listTeamTracking>>;
