import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { constraintName, isPgError, num, numOrNull } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, can, canAccessVenture, inNetwork, isStaff } from "@/lib/auth/context";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "@/lib/errors";
import { writeAudit, type AuditActor } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { calculatePricing, type PricingSnapshot } from "@/lib/pricing/engine";
import { db, loadOrgSettings, requireIdempotencyKey, withTx } from "./common";
import { customerInputSchema, resolveCustomer } from "./customers";
import { getUplineChain, resolveCreditedEmployee } from "./employees";
import { loadDiscountsByRefs, loadUsage, mapDiscount } from "./discounts";
import { cancelBookingReminders, createNotification, formatPlotList, notifyUplines } from "./notifications";
import { calculateCommissionsForBooking, reverseOpenCommissionsForBooking } from "./commissions";

export const MAX_PLOTS_PER_BOOKING = 10;
const CUSTOMER_MAX_ACTIVE_HELD_PLOTS = 5;

async function recordPlotStatus(
  q: Queryable,
  orgId: string,
  plotIds: string[],
  toStatus: string,
  reason: string,
  refs: { reservationId?: string | null; bookingId?: string | null; actorUserId?: string | null },
) {
  if (plotIds.length === 0) return;
  await q.query(
    `insert into plot_status_history (organization_id, plot_id, from_status, to_status, reason, reservation_id, booking_id, actor_user_id)
     select $1, p.id, null, $3, $4, $5, $6, $7 from unnest($2::uuid[]) as p(id)`,
    [orgId, plotIds, toStatus, reason, refs.reservationId ?? null, refs.bookingId ?? null, refs.actorUserId ?? null],
  );
}

/** Plots whose status is a temporary engine state are returned to available (never touches blocked/sold). */
async function releasePlots(q: Queryable, orgId: string, plotIds: string[], reason: string, actor: AuditActor, bookingId?: string | null) {
  if (plotIds.length === 0) return [];
  const released = await q.query<{ id: string }>(
    `update plots p set status = 'available', version = version + 1
      where p.organization_id = $1 and p.id = any($2::uuid[]) and p.status in ('held', 'reserved', 'booked')
        and not exists (select 1 from booking_plots bp where bp.plot_id = p.id and bp.is_live)
        and not exists (select 1 from reservations r where r.plot_id = p.id and r.status = 'active')
      returning p.id`,
    [orgId, plotIds],
  );
  await recordPlotStatus(q, orgId, released.map((r) => r.id), "available", reason, {
    bookingId,
    actorUserId: "system" in actor ? null : actor.user.id,
  });
  return released.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Expiry (holds & unpaid bookings). Safe to call often; runs inside callers' tx or its own.
// ---------------------------------------------------------------------------
export async function expireStale(q: Queryable, orgId?: string): Promise<{ expiredBookings: number; expiredHolds: number }> {
  const orgFilter = orgId ? "and b.organization_id = $1" : "";
  const params = orgId ? [orgId] : [];
  // Bookings whose advance window elapsed WITHOUT any verified payment.
  const expiredBookings = await q.query<{ id: string; organization_id: string; hold_group_id: string | null; booking_number: string }>(
    `update bookings b set status = 'expired', cancelled_at = now(), cancel_reason = 'Advance payment window elapsed'
      where b.status = 'payment_pending' and b.payment_due_at <= now() ${orgFilter}
        and not exists (select 1 from payment_transactions t where t.booking_id = b.id and t.status = 'verified')
      returning b.id, b.organization_id, b.hold_group_id, b.booking_number`,
    params,
  );
  for (const b of expiredBookings) {
    await q.query("update discount_redemptions set status = 'released' where booking_id = $1 and status = 'reserved'", [b.id]);
    await q.query("update payment_transactions set status = 'failed', failure_reason = 'Booking expired' where booking_id = $1 and status = 'pending'", [b.id]);
    await q.query(
      "update reservations set status = 'expired', released_at = now(), release_reason = 'booking expired' where hold_group_id = $1 and status = 'active'",
      [b.hold_group_id],
    );
    await cancelBookingReminders(q, b.id);
    const plots = (await q.query<{ plot_id: string }>("select plot_id from booking_plots where booking_id = $1", [b.id])).map((r) => r.plot_id);
    const actor: AuditActor = { system: true, organizationId: b.organization_id };
    await releasePlots(q, b.organization_id, plots, "Booking expired (advance not verified in time)", actor, b.id);
    await writeAudit(q, actor, { action: "booking.expired", entityType: "booking", entityId: b.id, summary: `Booking ${b.booking_number} expired` });
    await enqueueOutboundEvent(q, {
      organizationId: b.organization_id, eventType: "plot.booking.cancelled", aggregateType: "booking", aggregateId: b.id,
      idempotencyKey: `booking.expired:${b.id}`, data: { booking_id: b.id, booking_number: b.booking_number, reason: "expired" },
    });
  }

  // Holds past expiry that are not backing a pending booking.
  const holdOrgFilter = orgId ? "and r.organization_id = $1" : "";
  const expiredHolds = await q.query<{ id: string; organization_id: string; plot_id: string }>(
    `update reservations r set status = 'expired', released_at = now(), release_reason = 'hold expired'
      where r.status = 'active' and r.expires_at <= now() ${holdOrgFilter}
        and not exists (select 1 from bookings b where b.hold_group_id = r.hold_group_id and b.status = 'payment_pending')
      returning r.id, r.organization_id, r.plot_id`,
    params,
  );
  const byOrg = new Map<string, string[]>();
  for (const h of expiredHolds) byOrg.set(h.organization_id, [...(byOrg.get(h.organization_id) ?? []), h.plot_id]);
  for (const [org, plots] of byOrg) {
    const actor: AuditActor = { system: true, organizationId: org };
    await releasePlots(q, org, plots, "Temporary hold expired", actor);
    await writeAudit(q, actor, { action: "hold.expired", entityType: "reservation", summary: `${plots.length} hold(s) expired`, metadata: { plot_ids: plots } });
  }
  return { expiredBookings: expiredBookings.length, expiredHolds: expiredHolds.length };
}

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------
export const holdSchema = z.object({
  plotIds: z.array(z.string().uuid()).min(1).max(MAX_PLOTS_PER_BOOKING),
  customerId: z.string().uuid().optional().nullable(),
  customer: customerInputSchema.optional().nullable(),
  employeeCode: z.string().trim().max(32).optional().nullable(),
  idempotencyKey: z.string(),
});

export interface HoldResult {
  holdGroupId: string;
  expiresAt: string;
  plots: { id: string; plotNumber: string }[];
  customerId: string;
  creditedEmployeeCode: string | null;
  replayed: boolean;
}

export async function placeHold(ctx: AuthContext, input: z.infer<typeof holdSchema>): Promise<HoldResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  if (ctx.role !== "customer") assertPermission(ctx, "booking.create");
  const plotIds = [...new Set(input.plotIds)].sort();

  try {
    return await withTx(async (q) => {
      // Idempotent replay: same key returns the original hold.
      const prior = await q.query<{ hold_group_id: string; plot_id: string; plot_number: string; expires_at: Date; customer_id: string; created_by: string | null }>(
        `select r.hold_group_id, r.plot_id, p.plot_number, r.expires_at, r.customer_id, r.created_by
           from reservations r join plots p on p.id = r.plot_id
          where r.organization_id = $1 and r.idempotency_key = $2`,
        [ctx.organizationId, key],
      );
      if (prior.length > 0) {
        const samePlots = [...prior.map((p) => p.plot_id)].sort().join() === plotIds.join();
        if (!samePlots || prior[0].created_by !== ctx.user.id) throw conflict("Idempotency key was already used for a different request");
        return {
          holdGroupId: prior[0].hold_group_id, expiresAt: new Date(prior[0].expires_at).toISOString(),
          plots: prior.map((p) => ({ id: p.plot_id, plotNumber: p.plot_number })), customerId: prior[0].customer_id,
          creditedEmployeeCode: null, replayed: true,
        };
      }

      await expireStale(q, ctx.organizationId);

      // Lock the plots in a deterministic order to avoid deadlocks between concurrent requests.
      const plots = await q.query<{
        id: string; plot_number: string; status: string; venture_id: string; venture_name: string; venture_status: string;
        is_published: boolean; is_mortgaged:boolean; venture_hold_minutes: number | null;
      }>(
        `select p.id, p.plot_number, p.status, p.is_mortgaged, p.venture_id, v.name as venture_name, v.status as venture_status, v.is_published,
                v.hold_minutes as venture_hold_minutes
           from plots p join ventures v on v.id = p.venture_id
          where p.organization_id = $1 and p.id = any($2::uuid[])
          order by p.id
          for update of p`,
        [ctx.organizationId, plotIds],
      );
      if (plots.length !== plotIds.length) throw notFound("Plot");
      const ventureId = plots[0].venture_id;
      if (plots.some((p) => p.venture_id !== ventureId)) throw badRequest("All plots in one booking must belong to the same venture");
      const v = plots[0];
      if (ctx.role === "customer" ? !v.is_published : !canAccessVenture(ctx, ventureId)) throw notFound("Plot");
      if (v.venture_status !== "launched") throw conflict("This venture is not open for bookings");
      const unavailable = plots.filter((p) => p.status !== "available" || p.is_mortgaged);
      if (unavailable.length) {
        throw conflict(`Not available: ${unavailable.map((p) => `Plot ${p.plot_number} (${p.status})`).join(", ")}`, {
          unavailable: unavailable.map((p) => ({ id: p.id, plotNumber: p.plot_number, status: p.status })),
        });
      }

      const customer = await resolveCustomer(ctx, q, { customerId: input.customerId, customer: input.customer });
      if (ctx.role === "customer") {
        const [{ n }] = await q.query<{ n: number }>(
          "select count(*)::int as n from reservations where customer_id = $1 and status = 'active'",
          [customer.id],
        );
        if (n + plots.length > CUSTOMER_MAX_ACTIVE_HELD_PLOTS) {
          throw conflict(`You can hold at most ${CUSTOMER_MAX_ACTIVE_HELD_PLOTS} plots at a time`);
        }
      }
      const credited = await resolveCreditedEmployee(ctx, q, input.employeeCode);
      const org = await loadOrgSettings(q, ctx.organizationId);
      const holdMinutes = v.venture_hold_minutes ?? org.holdMinutes;
      const groupId = randomUUID();

      const [{ expires_at }] = await q.query<{ expires_at: Date }>("select now() + make_interval(mins => $1) as expires_at", [holdMinutes]);
      for (const p of plots) {
        await q.query(
          `insert into reservations (organization_id, venture_id, plot_id, customer_id, hold_group_id, created_by, credited_employee_id, expires_at, idempotency_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ctx.organizationId, ventureId, p.id, customer.id, groupId, ctx.user.id, credited?.id ?? null, expires_at, key],
        );
      }
      await q.query("update plots set status = 'held', version = version + 1 where id = any($1::uuid[])", [plotIds]);
      await recordPlotStatus(q, ctx.organizationId, plotIds, "held", "Temporary hold placed", { actorUserId: ctx.user.id });

      const plotNumbers = plots.map((p) => p.plot_number);
      await writeAudit(q, ctx, {
        action: "hold.created", entityType: "hold_group", entityId: groupId,
        summary: `Held ${formatPlotList(plotNumbers)} in ${v.venture_name} for ${holdMinutes} min`,
        metadata: { plot_ids: plotIds, customer_id: customer.id, credited_employee: credited?.code ?? null },
      });
      await enqueueOutboundEvent(q, {
        organizationId: ctx.organizationId, eventType: "plot.hold.created", aggregateType: "hold_group", aggregateId: groupId,
        idempotencyKey: `hold.created:${groupId}`,
        data: {
          hold_group_id: groupId, venture_id: ventureId, venture_name: v.venture_name, plot_numbers: plotNumbers,
          customer: { id: customer.id, name: customer.fullName, phone: customer.phone, email: customer.email },
          credited_employee_code: credited?.code ?? null, expires_at,
        },
      });
      if (credited) {
        await notifyUplines(q, {
          organizationId: ctx.organizationId, kind: "reservation", creditedEmployeeId: credited.id, actorUserId: ctx.user.id,
          ventureName: v.venture_name, plotNumbers, holdGroupId: groupId, refKey: groupId,
        });
      }
      return {
        holdGroupId: groupId, expiresAt: new Date(expires_at).toISOString(),
        plots: plots.map((p) => ({ id: p.id, plotNumber: p.plot_number })), customerId: customer.id,
        creditedEmployeeCode: credited?.code ?? null, replayed: false,
      };
    });
  } catch (e) {
    if (isPgError(e, "23505") && constraintName(e) === "reservations_one_active_per_plot") {
      throw conflict("One or more plots were just held by someone else");
    }
    throw e;
  }
}

async function lockHoldGroup(ctx: AuthContext, q: Queryable, holdGroupId: string) {
  const rows = await q.query<{
    id: string; plot_id: string; customer_id: string; status: string; expires_at: Date; created_by: string | null;
    credited_employee_id: string | null; venture_id: string;
  }>(
    `select id, plot_id, customer_id, status, expires_at, created_by, credited_employee_id, venture_id
       from reservations where organization_id = $1 and hold_group_id = $2 order by plot_id for update`,
    [ctx.organizationId, holdGroupId],
  );
  if (rows.length === 0) throw notFound("Hold");
  const r = rows[0];
  const allowed =
    ctx.role === "customer"
      ? r.customer_id === ctx.customerId
      : canAccessVenture(ctx, r.venture_id) &&
        (ctx.networkEmployeeIds === null || r.created_by === ctx.user.id || inNetwork(ctx, r.credited_employee_id));
  if (!allowed) throw notFound("Hold");
  return rows;
}

export async function releaseHold(ctx: AuthContext, holdGroupId: string, reason = "Released by user") {
  return withTx(async (q) => {
    const rows = await lockHoldGroup(ctx, q, holdGroupId);
    const active = rows.filter((r) => r.status === "active");
    if (active.length === 0) throw conflict("Hold is no longer active");
    const [pending] = await q.query("select 1 from bookings where hold_group_id = $1 and status = 'payment_pending'", [holdGroupId]);
    if (pending) throw conflict("This hold backs a pending booking; cancel the booking instead");
    if (ctx.role !== "customer" && rows[0].created_by !== ctx.user.id) assertPermission(ctx, "booking.manage");
    await q.query(
      "update reservations set status = 'released', released_at = now(), release_reason = $2 where hold_group_id = $1 and status = 'active'",
      [holdGroupId, reason],
    );
    await releasePlots(q, ctx.organizationId, active.map((r) => r.plot_id), "Hold released", ctx);
    await writeAudit(q, ctx, { action: "hold.released", entityType: "hold_group", entityId: holdGroupId, summary: reason });
    return { released: active.length };
  });
}

// ---------------------------------------------------------------------------
// Booking request (multi-plot), from an active hold group
// ---------------------------------------------------------------------------
export const bookingRequestSchema = z.object({
  holdGroupId: z.string().uuid(),
  discountRefs: z.array(z.string().trim().min(1).max(64)).max(5).default([]),
  employeeCode: z.string().trim().max(32).optional().nullable(),
  idempotencyKey: z.string(),
});

export async function requestBooking(ctx: AuthContext, input: z.infer<typeof bookingRequestSchema>) {
  const key = requireIdempotencyKey(input.idempotencyKey);
  if (ctx.role !== "customer") assertPermission(ctx, "booking.create");
  return withTx(async (q) => {
    const [existing] = await q.query<{ id: string; requested_by: string }>(
      "select id, requested_by from bookings where organization_id = $1 and idempotency_key = $2",
      [ctx.organizationId, key],
    );
    if (existing) {
      if (existing.requested_by !== ctx.user.id) throw conflict("Idempotency key was already used");
      return { bookingId: existing.id, replayed: true };
    }

    const holds = await lockHoldGroup(ctx, q, input.holdGroupId);
    const now = new Date();
    if (holds.some((h) => h.status !== "active" || new Date(h.expires_at) <= now)) {
      throw conflict("The hold has expired or is no longer active. Please select the plots again.");
    }
    const [pending] = await q.query("select 1 from bookings where hold_group_id = $1 and status in ('payment_pending','confirmed','completed')", [input.holdGroupId]);
    if (pending) throw conflict("A booking already exists for this hold");

    const plotIds = holds.map((h) => h.plot_id);
    const plots = await q.query<{ id: string; plot_number: string; status: string; area_sq_yards: string; base_price_per_sq_yard: string }>(
      "select id, plot_number, status, area_sq_yards, base_price_per_sq_yard from plots where id = any($1::uuid[]) order by id for update",
      [plotIds],
    );
    if (plots.some((p) => p.status !== "held")) throw conflict("Plot status changed; please start again");

    const ventureId = holds[0].venture_id;
    const customerId = holds[0].customer_id;
    const [venture] = await q.query<{ name: string; booking_amount_percent: string | null }>(
      "select name, booking_amount_percent from ventures where id = $1",
      [ventureId],
    );
    const org = await loadOrgSettings(q, ctx.organizationId);

    // Lock requested discounts so concurrent bookings cannot exceed usage limits.
    const requested = await loadDiscountsByRefs(q, ctx.organizationId, input.discountRefs, true);
    const usage = await loadUsage(q, requested.flatMap((r) => (r.discount ? [r.discount.id] : [])), customerId);
    const pricing = calculatePricing({
      ventureId,
      plots: plots.map((p) => ({ id: p.id, plotNumber: p.plot_number, areaSqYards: num(p.area_sq_yards), pricePerSqYard: num(p.base_price_per_sq_yard) })),
      customerId, now, currency: org.currency,
      bookingAmountPercent: numOrNull(venture.booking_amount_percent) ?? org.bookingAmountPercent,
      allowStacking: org.allowDiscountStacking, maxDiscountPercent: org.maxDiscountPercent, requested, usage,
    });
    if (!pricing.ok) throw unprocessable("One or more discounts cannot be applied", pricing.lines.filter((l) => !l.ok));

    // Attribution: explicit (permission-checked) or carried from the hold.
    let credited: { id: string; code: string; fullName: string } | null = null;
    if (input.employeeCode) credited = await resolveCreditedEmployee(ctx, q, input.employeeCode);
    else if (holds[0].credited_employee_id) {
      const [e] = await q.query<{ id: string; employee_code: string; full_name: string }>(
        "select id, employee_code, full_name from employees where id = $1", [holds[0].credited_employee_id],
      );
      credited = e ? { id: e.id, code: e.employee_code, fullName: e.full_name } : null;
    } else credited = await resolveCreditedEmployee(ctx, q, null);
    const attribution = credited ? await buildAttributionSnapshot(q, ctx, credited.id) : null;

    const s = pricing.snapshot;
    const [booking] = await q.query<{ id: string; booking_number: string; payment_due_at: Date }>(
      `insert into bookings (organization_id, venture_id, customer_id, hold_group_id, currency, plot_count, total_area_sq_yards,
                             credited_employee_id, attribution_snapshot, base_amount, discount_amount, net_amount, booking_amount,
                             discount_codes, pricing_snapshot, idempotency_key, payment_due_at, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::text[],$15::jsonb,$16, now() + make_interval(mins => $17), $18)
       returning id, booking_number, payment_due_at`,
      [
        ctx.organizationId, ventureId, customerId, input.holdGroupId, org.currency, s.plots.length, s.totalAreaSqYards,
        credited?.id ?? null, attribution, s.baseAmount, s.discountTotal, s.netAmount, s.bookingAmount,
        s.discounts.map((d) => d.code ?? d.name), s, key, org.paymentWindowMinutes, ctx.user.id,
      ],
    );
    for (const line of s.plots) {
      const hold = holds.find((h) => h.plot_id === line.plotId)!;
      await q.query(
        `insert into booking_plots (organization_id, booking_id, plot_id, reservation_id, plot_number, area_sq_yards, price_per_sq_yard,
                                    base_amount, discount_amount, net_amount)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ctx.organizationId, booking.id, line.plotId, hold.id, line.plotNumber, line.areaSqYards, line.pricePerSqYard, line.baseAmount, line.discountAmount, line.netAmount],
      );
    }
    for (const d of s.discounts) {
      await q.query(
        "insert into discount_redemptions (organization_id, discount_id, booking_id, customer_id, amount) values ($1,$2,$3,$4,$5)",
        [ctx.organizationId, d.discountId, booking.id, customerId, d.amount],
      );
    }
    await q.query("update reservations set expires_at = $2 where hold_group_id = $1 and status = 'active'", [input.holdGroupId, booking.payment_due_at]);
    await q.query("update plots set status = 'reserved', version = version + 1 where id = any($1::uuid[])", [plotIds]);
    await recordPlotStatus(q, ctx.organizationId, plotIds, "reserved", `Booking ${booking.booking_number} requested`, { bookingId: booking.id, actorUserId: ctx.user.id });

    const plotNumbers = s.plots.map((p) => p.plotNumber);
    await writeAudit(q, ctx, {
      action: "booking.requested", entityType: "booking", entityId: booking.id,
      summary: `Booking ${booking.booking_number}: ${formatPlotList(plotNumbers)}, net ${s.netAmount}`,
      after: { pricing: s, credited_employee: credited?.code ?? null, requested_by: ctx.user.id },
    });
    const [customer] = await q.query<{ full_name: string; phone: string | null; email: string | null }>("select full_name, phone, email from customers where id = $1", [customerId]);
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "plot.booking.created", aggregateType: "booking", aggregateId: booking.id,
      idempotencyKey: `booking.created:${booking.id}`,
      data: {
        booking_id: booking.id, booking_number: booking.booking_number, venture_id: ventureId, venture_name: venture.name,
        plots: s.plots.map((p) => ({ plot_number: p.plotNumber, area_sq_yards: p.areaSqYards, base_amount: p.baseAmount, net_amount: p.netAmount })),
        total_area_sq_yards: s.totalAreaSqYards, base_amount: s.baseAmount, discount_amount: s.discountTotal, net_amount: s.netAmount,
        advance_amount: s.bookingAmount, currency: s.currency, payment_status: "pending",
        customer: { id: customerId, name: customer.full_name, phone: customer.phone, email: customer.email },
        selling_employee_code: credited?.code ?? null, created_by_user_id: ctx.user.id, payment_due_at: booking.payment_due_at,
      },
    });
    for (const d of s.discounts) {
      await enqueueOutboundEvent(q, {
        organizationId: ctx.organizationId, eventType: "discount.applied", aggregateType: "booking", aggregateId: booking.id,
        idempotencyKey: `discount.applied:${booking.id}:${d.discountId}`,
        data: { booking_id: booking.id, booking_number: booking.booking_number, discount_id: d.discountId, code: d.code, name: d.name, amount: d.amount },
      });
    }
    if (credited) {
      await notifyUplines(q, {
        organizationId: ctx.organizationId, kind: "booking", creditedEmployeeId: credited.id, actorUserId: ctx.user.id,
        ventureName: venture.name, plotNumbers, bookingId: booking.id, bookingNumber: booking.booking_number, refKey: booking.id,
      });
    }
    return { bookingId: booking.id, bookingNumber: booking.booking_number, replayed: false, pricing: s };
  });
}

/** Seller, reporting manager & eligible upline chain at booking time (no commission rates). */
export async function buildAttributionSnapshot(q: Queryable, ctx: AuthContext, employeeId: string) {
  const chain = await getUplineChain(q, ctx.organizationId, employeeId);
  return {
    captured_at: new Date().toISOString(),
    created_by_user_id: ctx.user.id,
    created_by_name: ctx.user.fullName,
    seller: chain[0] ? { employee_id: chain[0].employeeId, employee_code: chain[0].employeeCode, name: chain[0].fullName, designation: chain[0].designation, level: chain[0].commissionLevel } : null,
    reporting_manager: chain[1] ? { employee_id: chain[1].employeeId, employee_code: chain[1].employeeCode, name: chain[1].fullName } : null,
    chain: chain.map((m, depth) => ({
      depth, employee_id: m.employeeId, employee_code: m.employeeCode, name: m.fullName, designation: m.designation,
      level: m.commissionLevel, active: m.active, commission_eligible: m.commissionEligible,
    })),
  };
}

// ---------------------------------------------------------------------------
// Confirmation — only against server-verified payments (never a success screen)
// ---------------------------------------------------------------------------
export async function confirmBookingInternal(
  q: Queryable,
  bookingId: string,
  source: "payment_webhook" | "staff_verified_payment",
  actor: AuthContext | null,
): Promise<{ confirmed: boolean; reason?: string }> {
  const [b] = await q.query<Record<string, unknown>>("select * from bookings where id = $1 for update", [bookingId]);
  if (!b) throw notFound("Booking");
  const orgId = String(b.organization_id);
  const auditActor: AuditActor = actor ?? { system: true, organizationId: orgId, actorType: "webhook" };
  if (b.status !== "payment_pending") return { confirmed: b.status === "confirmed" || b.status === "completed", reason: `Booking is ${b.status}` };

  const [{ verified }] = await q.query<{ verified: string }>(
    "select coalesce(sum(amount),0) as verified from payment_transactions where booking_id = $1 and status = 'verified'",
    [bookingId],
  );
  if (num(verified) < num(b.booking_amount)) return { confirmed: false, reason: "Awaiting verified payment of the full advance amount" };

  // Revalidate discounts at confirmation. Time-validity is evaluated at the request
  // time (the customer locked the offer); status, approval, applicability and usage
  // limits are re-evaluated now. Quoted plot prices are locked from the request.
  const snapshot = b.pricing_snapshot as PricingSnapshot;
  const org = await loadOrgSettings(q, orgId);
  const discountRows = snapshot.discounts.length
    ? await q.query<Record<string, unknown>>("select * from discounts where id = any($1::uuid[]) for update", [snapshot.discounts.map((d) => d.discountId)])
    : [];
  const byId = new Map(discountRows.map((r) => [String(r.id), mapDiscount(r)]));
  const requested = snapshot.discounts.map((d) => ({ ref: d.code ?? d.discountId, discount: byId.get(d.discountId) ?? null }));
  const usage = await loadUsage(q, [...byId.keys()], String(b.customer_id), bookingId);
  const recheck = calculatePricing({
    ventureId: snapshot.ventureId,
    plots: snapshot.plots.map((p) => ({ id: p.plotId, plotNumber: p.plotNumber, areaSqYards: p.areaSqYards, pricePerSqYard: p.pricePerSqYard })),
    customerId: String(b.customer_id), now: new Date(), validityAt: new Date(b.created_at as string), currency: snapshot.currency,
    bookingAmountPercent: snapshot.bookingAmountPercent, allowStacking: org.allowDiscountStacking, maxDiscountPercent: org.maxDiscountPercent,
    requested, usage,
  });
  const mismatch =
    !recheck.ok ||
    recheck.snapshot.discountTotal !== num(b.discount_amount) ||
    recheck.snapshot.netAmount !== num(b.net_amount) ||
    recheck.snapshot.bookingAmount !== num(b.booking_amount);
  if (mismatch) {
    const reason = !recheck.ok
      ? `Discount revalidation failed: ${recheck.lines.filter((l) => !l.ok).map((l) => `${l.ref}: ${l.reason}`).join("; ")}`
      : "Repriced amounts differ from the quoted booking amounts";
    await q.query("update bookings set review_reason = $2 where id = $1", [bookingId, reason]);
    await writeAudit(q, auditActor, { action: "booking.confirmation_blocked", entityType: "booking", entityId: bookingId, summary: reason });
    return { confirmed: false, reason };
  }

  const confirmedSnapshot = { ...recheck.snapshot, confirmation: { source, confirmed_at: new Date().toISOString(), verified_payments: num(verified) } };
  await q.query("update discount_redemptions set status = 'confirmed' where booking_id = $1 and status = 'reserved'", [bookingId]);
  await q.query(
    `update bookings set status = 'confirmed', confirmed_at = now(), confirmed_by = $2, confirmation_source = $3,
            confirmed_pricing_snapshot = $4::jsonb, review_reason = null where id = $1`,
    [bookingId, actor?.user.id ?? null, source, confirmedSnapshot],
  );
  await q.query("update reservations set status = 'converted' where hold_group_id = $1 and status = 'active'", [b.hold_group_id]);
  const plotRows = await q.query<{ plot_id: string; plot_number: string }>("select plot_id, plot_number from booking_plots where booking_id = $1 order by plot_number", [bookingId]);
  const plotIds = plotRows.map((p) => p.plot_id);
  await q.query("update plots set status = 'booked', version = version + 1 where id = any($1::uuid[])", [plotIds]);
  await recordPlotStatus(q, orgId, plotIds, "booked", `Booking ${b.booking_number} confirmed`, { bookingId, actorUserId: actor?.user.id ?? null });
  await cancelBookingReminders(q, bookingId);
  await writeAudit(q, auditActor, { action: "booking.confirmed", entityType: "booking", entityId: bookingId, summary: `Booking ${b.booking_number} confirmed via ${source}` });
  await enqueueOutboundEvent(q, {
    organizationId: orgId, eventType: "plot.booking.confirmed", aggregateType: "booking", aggregateId: bookingId,
    idempotencyKey: `booking.confirmed:${bookingId}`,
    data: {
      booking_id: bookingId, booking_number: b.booking_number, plot_numbers: plotRows.map((p) => p.plot_number),
      net_amount: num(b.net_amount), advance_amount: num(b.booking_amount), verified_payments: num(verified), confirmation_source: source,
    },
  });
  // Tell the booking creator (if staff) that the booking is confirmed.
  if (b.requested_by) {
    const [m] = await q.query("select 1 from organization_members where organization_id = $1 and user_id = $2 and role <> 'customer' and status = 'active'", [orgId, b.requested_by]);
    if (m) {
      await createNotification(q, {
        organizationId: orgId, recipientUserId: String(b.requested_by), type: "booking_update",
        title: `Booking ${b.booking_number} confirmed`,
        body: `The advance for ${formatPlotList(plotRows.map((p) => p.plot_number))} has been verified and the booking is confirmed.`,
        bookingId, bookingNumber: String(b.booking_number), plotNumbers: plotRows.map((p) => p.plot_number), link: `/bookings/${bookingId}`,
        dedupeKey: `booking.confirmed:${bookingId}`,
      });
    }
  }
  await calculateCommissionsForBooking(q, bookingId);
  return { confirmed: true };
}

/** POST /api/bookings/confirm — staff confirmation against already-verified (e.g. offline) payments. */
export async function confirmBookingByStaff(ctx: AuthContext, bookingId: string) {
  assertPermission(ctx, "booking.confirm");
  return withTx(async (q) => {
    await getBookingRowForStaff(ctx, q, bookingId);
    const result = await confirmBookingInternal(q, bookingId, "staff_verified_payment", ctx);
    if (!result.confirmed) throw unprocessable(result.reason ?? "Booking cannot be confirmed");
    return result;
  });
}

async function getBookingRowForStaff(ctx: AuthContext, q: Queryable, bookingId: string) {
  const [b] = await q.query<Record<string, unknown>>("select * from bookings where organization_id = $1 and id = $2", [ctx.organizationId, bookingId]);
  if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
  return b;
}

export function canSeeBooking(ctx: AuthContext, b: Record<string, unknown>): boolean {
  if (b.organization_id !== ctx.organizationId) return false;
  if (ctx.role === "customer") return b.customer_id === ctx.customerId;
  if (!isStaff(ctx) || !can(ctx, "booking.view")) return false;
  if (!canAccessVenture(ctx, String(b.venture_id))) return false;
  if (ctx.networkEmployeeIds === null) return true;
  return b.requested_by === ctx.user.id || inNetwork(ctx, b.credited_employee_id as string | null);
}

export async function cancelBooking(ctx: AuthContext, bookingId: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest("A cancellation reason (min 5 chars) is required");
  return withTx(async (q) => {
    const [b] = await q.query<Record<string, unknown>>("select * from bookings where organization_id = $1 and id = $2 for update", [ctx.organizationId, bookingId]);
    if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
    const [{ verified }] = await q.query<{ verified: string }>(
      "select coalesce(sum(amount),0) as verified from payment_transactions where booking_id = $1 and status = 'verified'", [bookingId],
    );
    if (ctx.role === "customer") {
      if (b.status !== "payment_pending" || num(verified) > 0) throw forbidden("Please contact the sales team to cancel this booking");
    } else if (b.status !== "payment_pending" || num(verified) > 0) {
      assertPermission(ctx, "booking.manage");
    } else if (b.requested_by !== ctx.user.id) {
      assertPermission(ctx, "booking.manage");
    }
    if (!["payment_pending", "confirmed"].includes(String(b.status))) throw conflict(`A ${b.status} booking cannot be cancelled`);
    await q.query("update bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = $2 where id = $1", [bookingId, reason.trim()]);
    await q.query("update discount_redemptions set status = 'released' where booking_id = $1 and status in ('reserved','confirmed')", [bookingId]);
    await q.query("update payment_transactions set status = 'failed', failure_reason = 'Booking cancelled' where booking_id = $1 and status = 'pending'", [bookingId]);
    await q.query(
      "update reservations set status = 'cancelled', released_at = now(), release_reason = 'booking cancelled' where hold_group_id = $1 and status in ('active')",
      [b.hold_group_id],
    );
    await cancelBookingReminders(q, bookingId);
    await reverseOpenCommissionsForBooking(q, ctx, bookingId, `Booking cancelled: ${reason.trim()}`);
    const plots = (await q.query<{ plot_id: string }>("select plot_id from booking_plots where booking_id = $1", [bookingId])).map((r) => r.plot_id);
    await releasePlots(q, ctx.organizationId, plots, `Booking ${b.booking_number} cancelled`, ctx, bookingId);
    await writeAudit(q, ctx, {
      action: "booking.cancelled", entityType: "booking", entityId: bookingId, summary: `Booking ${b.booking_number} cancelled: ${reason}`,
      metadata: { verified_payments: num(verified), refund_review_required: num(verified) > 0 },
    });
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "plot.booking.cancelled", aggregateType: "booking", aggregateId: bookingId,
      idempotencyKey: `booking.cancelled:${bookingId}`,
      data: { booking_id: bookingId, booking_number: b.booking_number, reason, verified_payments: num(verified), refund_review_required: num(verified) > 0 },
    });
    return { cancelled: true, refundReviewRequired: num(verified) > 0 };
  });
}

/** Marks the sale complete (plots → sold). Requires the full net amount to be verified. */
export async function completeSale(ctx: AuthContext, bookingId: string) {
  assertPermission(ctx, "booking.manage");
  return withTx(async (q) => {
    const [b] = await q.query<Record<string, unknown>>("select * from bookings where organization_id = $1 and id = $2 for update", [ctx.organizationId, bookingId]);
    if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
    if (b.status !== "confirmed") throw conflict("Only confirmed bookings can be completed");
    const [{ verified }] = await q.query<{ verified: string }>(
      "select coalesce(sum(amount),0) as verified from payment_transactions where booking_id = $1 and status = 'verified'", [bookingId],
    );
    const outstanding = Math.round((num(b.net_amount) - num(verified)) * 100) / 100;
    if (outstanding > 0) throw unprocessable(`Outstanding balance of ${outstanding} must be verified before completing the sale`);
    await q.query("update bookings set status = 'completed', completed_at = now() where id = $1", [bookingId]);
    const plots = await q.query<{ plot_id: string; plot_number: string }>("select plot_id, plot_number from booking_plots where booking_id = $1", [bookingId]);
    await q.query("update plots set status = 'sold', version = version + 1 where id = any($1::uuid[])", [plots.map((p) => p.plot_id)]);
    await recordPlotStatus(q, ctx.organizationId, plots.map((p) => p.plot_id), "sold", `Sale completed (${b.booking_number})`, { bookingId, actorUserId: ctx.user.id });
    await writeAudit(q, ctx, { action: "booking.completed", entityType: "booking", entityId: bookingId, summary: `Sale completed for ${b.booking_number}` });
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "plot.sold", aggregateType: "booking", aggregateId: bookingId,
      idempotencyKey: `plot.sold:${bookingId}`,
      data: { booking_id: bookingId, booking_number: b.booking_number, plot_numbers: plots.map((p) => p.plot_number), net_amount: num(b.net_amount) },
    });
    return { completed: true };
  });
}

export const attributionSchema = z.object({
  employeeCode: z.string().trim().min(3).max(32),
  reason: z.string().trim().min(5).max(500),
});

/** Assign/correct sales attribution (managers) — blocked once commissions are approved. */
export async function changeAttribution(ctx: AuthContext, bookingId: string, input: z.infer<typeof attributionSchema>) {
  assertPermission(ctx, "attribution.manage");
  return withTx(async (q) => {
    const [b] = await q.query<Record<string, unknown>>("select * from bookings where organization_id = $1 and id = $2 for update", [ctx.organizationId, bookingId]);
    if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
    if (b.attribution_locked) throw conflict("Attribution is locked because commissions for this booking were approved");
    if (["cancelled", "expired"].includes(String(b.status))) throw conflict(`Cannot change attribution of a ${b.status} booking`);
    const target = await resolveCreditedEmployee(ctx, q, input.employeeCode);
    if (!target) throw notFound("Employee ID");
    if (target.id === b.credited_employee_id) throw badRequest("Booking is already credited to this employee");
    const snapshot = await buildAttributionSnapshot(q, ctx, target.id);
    await reverseOpenCommissionsForBooking(q, ctx, bookingId, `Attribution changed: ${input.reason}`);
    await q.query("update bookings set credited_employee_id = $2, attribution_snapshot = $3::jsonb where id = $1", [bookingId, target.id, snapshot]);
    await q.query(
      `insert into booking_attribution_changes (organization_id, booking_id, from_employee_id, to_employee_id, reason, changed_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [ctx.organizationId, bookingId, b.credited_employee_id, target.id, input.reason, ctx.user.id],
    );
    if (b.status === "confirmed" || b.status === "completed") await calculateCommissionsForBooking(q, bookingId);
    await writeAudit(q, ctx, {
      action: "booking.attribution_changed", entityType: "booking", entityId: bookingId, summary: `Attribution changed to ${target.code}: ${input.reason}`,
      before: { credited_employee_id: b.credited_employee_id }, after: { credited_employee_id: target.id },
    });
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "plot.booking.attribution_changed", aggregateType: "booking", aggregateId: bookingId,
      idempotencyKey: `booking.attribution:${bookingId}:${randomUUID()}`,
      data: { booking_id: bookingId, booking_number: b.booking_number, to_employee_code: target.code, reason: input.reason },
    });
    return { creditedEmployeeCode: target.code };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export interface BookingListFilters {
  status?: string;
  ventureId?: string;
  q?: string;
  limit?: number;
}

export async function listBookings(ctx: AuthContext, f: BookingListFilters = {}) {
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["b.organization_id = $1"];
  if (ctx.role === "customer") {
    params.push(ctx.customerId);
    where.push(`b.customer_id = $${params.length}`);
  } else {
    assertPermission(ctx, "booking.view");
    if (ctx.ventureIds !== null) {
      params.push(ctx.ventureIds);
      where.push(`b.venture_id = any($${params.length}::uuid[])`);
    }
    if (ctx.networkEmployeeIds !== null) {
      params.push(ctx.networkEmployeeIds, ctx.user.id);
      where.push(`(b.credited_employee_id = any($${params.length - 1}::uuid[]) or b.requested_by = $${params.length})`);
    }
  }
  if (f.status) {
    params.push(f.status);
    where.push(`b.status = $${params.length}`);
  }
  if (f.ventureId) {
    params.push(f.ventureId);
    where.push(`b.venture_id = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    where.push(`(lower(b.booking_number) like $${params.length} or lower(c.full_name) like $${params.length} or coalesce(c.phone,'') like $${params.length}
                 or exists (select 1 from booking_plots bp where bp.booking_id = b.id and lower(bp.plot_number) like $${params.length}))`);
  }
  params.push(Math.min(f.limit ?? 200, 500));
  return q.query<Record<string, unknown>>(
    `select b.id, b.booking_number, b.status, b.created_at, b.payment_due_at, b.confirmed_at, b.plot_count, b.total_area_sq_yards,
            b.base_amount, b.discount_amount, b.net_amount, b.booking_amount, b.currency, b.review_reason,
            v.name as venture_name, c.full_name as customer_name, c.phone as customer_phone,
            e.employee_code as credited_employee_code, e.full_name as credited_employee_name,
            array(select bp.plot_number from booking_plots bp where bp.booking_id = b.id order by bp.plot_number) as plot_numbers,
            (select coalesce(sum(t.amount),0) from payment_transactions t where t.booking_id = b.id and t.status = 'verified') as verified_amount,
            (select bool_or(t.is_simulated) from payment_transactions t where t.booking_id = b.id and t.status = 'verified') as has_simulated_payment
       from bookings b
       join ventures v on v.id = b.venture_id
       join customers c on c.id = b.customer_id
       left join employees e on e.id = b.credited_employee_id
      where ${where.join(" and ")}
      order by b.created_at desc limit $${params.length}`,
    params,
  );
}

export async function getBooking(ctx: AuthContext, bookingId: string) {
  const q = await db();
  const [b] = await q.query<Record<string, unknown>>(
    `select b.*, v.name as venture_name, v.code as venture_code, v.is_demo as venture_is_demo, c.full_name as customer_name, c.phone as customer_phone,
            c.email as customer_email, e.employee_code as credited_employee_code, e.full_name as credited_employee_name,
            u.full_name as requested_by_name
       from bookings b join ventures v on v.id = b.venture_id join customers c on c.id = b.customer_id
       left join employees e on e.id = b.credited_employee_id
       left join app_users u on u.id = b.requested_by
      where b.organization_id = $1 and b.id = $2`,
    [ctx.organizationId, bookingId],
  );
  if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
  const plots = await q.query<Record<string, unknown>>(
    "select plot_id, plot_number, area_sq_yards, price_per_sq_yard, base_amount, discount_amount, net_amount from booking_plots where booking_id = $1 order by plot_number",
    [bookingId],
  );
  const payments = await q.query<Record<string, unknown>>(
    `select id, provider, provider_reference, purpose, amount, currency, status, is_simulated, verified_at, failure_reason, created_at
       from payment_transactions where booking_id = $1 order by created_at desc`,
    [bookingId],
  );
  const isCustomer = ctx.role === "customer";
  const attributionHistory = isCustomer || !can(ctx, "attribution.manage")
    ? []
    : await q.query<Record<string, unknown>>(
        `select ac.created_at, ac.reason, fe.employee_code as from_code, te.employee_code as to_code, u.full_name as changed_by_name
           from booking_attribution_changes ac
           left join employees fe on fe.id = ac.from_employee_id left join employees te on te.id = ac.to_employee_id
           left join app_users u on u.id = ac.changed_by
          where ac.booking_id = $1 order by ac.created_at desc`,
        [bookingId],
      );
  const verified = payments.filter((p) => p.status === "verified").reduce((s, p) => s + num(p.amount), 0);
  // Customers never see internal attribution, hierarchy or actor details.
  if (isCustomer) {
    delete b.attribution_snapshot;
    delete b.requested_by;
    delete b.requested_by_name;
    delete b.credited_employee_id;
    delete b.review_reason;
    delete b.idempotency_key;
  } else if (b.attribution_snapshot && ctx.networkEmployeeIds !== null) {
    // Network-scoped staff see the chain without people outside their own line of sight.
    const snap = b.attribution_snapshot as { chain?: { employee_id: string }[] };
    if (snap.chain) snap.chain = snap.chain.filter((m) => inNetwork(ctx, m.employee_id) || m.employee_id === ctx.employee?.id);
  }
  return {
    booking: b,
    plots,
    payments,
    attributionHistory,
    verifiedAmount: Math.round(verified * 100) / 100,
    outstanding: Math.max(0, Math.round((num(b.net_amount) - verified) * 100) / 100),
  };
}

export async function listActiveHolds(ctx: AuthContext) {
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  let scope = "true";
  if (ctx.role === "customer") {
    params.push(ctx.customerId);
    scope = `r.customer_id = $2`;
  } else if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds, ctx.user.id);
    scope = `(r.credited_employee_id = any($2::uuid[]) or r.created_by = $3)`;
  }
  return q.query<Record<string, unknown>>(
    `select r.hold_group_id, min(r.expires_at) as expires_at, max(v.name) as venture_name, max(c.full_name) as customer_name,
            array_agg(p.plot_number order by p.plot_number) as plot_numbers, array_agg(p.id order by p.plot_number) as plot_ids,
            max(e.employee_code) as credited_employee_code,
            bool_or(exists (select 1 from bookings b where b.hold_group_id = r.hold_group_id and b.status = 'payment_pending')) as has_booking
       from reservations r join plots p on p.id = r.plot_id join ventures v on v.id = r.venture_id join customers c on c.id = r.customer_id
       left join employees e on e.id = r.credited_employee_id
      where r.organization_id = $1 and r.status = 'active' and ${scope}
      group by r.hold_group_id order by min(r.expires_at)`,
    params,
  );
}
