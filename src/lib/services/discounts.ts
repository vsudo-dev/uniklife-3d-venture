import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { isPgError, constraintName, num, numOrNull } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff, canAccessVenture } from "@/lib/auth/context";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { calculatePricing, checkDiscountEligibility, type DiscountRecord, type DiscountUsage, type PricingPlot } from "@/lib/pricing/engine";
import { evaluateDiscountPolicy } from "@/lib/pricing/discount-policy";
import { db, isUuid, loadOrgSettings, withTx } from "./common";

export function mapDiscount(r: Record<string, unknown>): DiscountRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    code: (r.code as string | null) ?? null,
    valueType: r.value_type as DiscountRecord["valueType"],
    category: r.category as DiscountRecord["category"],
    value: num(r.value),
    maxDiscountAmount: numOrNull(r.max_discount_amount),
    startsAt: new Date(r.starts_at as string),
    expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
    applicableVentureIds: (r.applicable_venture_ids as string[]) ?? [],
    applicablePlotIds: (r.applicable_plot_ids as string[]) ?? [],
    customerId: (r.customer_id as string | null) ?? null,
    usageLimitTotal: r.usage_limit_total === null || r.usage_limit_total === undefined ? null : num(r.usage_limit_total),
    usageLimitPerCustomer: r.usage_limit_per_customer === null || r.usage_limit_per_customer === undefined ? null : num(r.usage_limit_per_customer),
    stackable: Boolean(r.stackable),
    requiresApproval: Boolean(r.requires_approval),
    status: r.status as DiscountRecord["status"],
    approvedAt: r.approved_at ? new Date(r.approved_at as string) : null,
  };
}

/**
 * Resolves discount references: a code (case-insensitive) or, for CODELESS offers
 * only, the discount id. Coupon codes can never be bypassed by id.
 */
export async function loadDiscountsByRefs(
  q: Queryable,
  orgId: string,
  refs: string[],
  lock = false,
): Promise<{ ref: string; discount: DiscountRecord | null }[]> {
  const out: { ref: string; discount: DiscountRecord | null }[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    const rows = isUuid(ref)
      ? await q.query<Record<string, unknown>>(
          `select * from discounts where organization_id = $1 and id = $2 and code is null ${lock ? "for update" : ""}`,
          [orgId, ref],
        )
      : await q.query<Record<string, unknown>>(
          `select * from discounts where organization_id = $1 and upper(code) = upper($2) ${lock ? "for update" : ""}`,
          [orgId, ref],
        );
    out.push({ ref, discount: rows[0] ? mapDiscount(rows[0]) : null });
  }
  return out;
}

export async function loadUsage(
  q: Queryable,
  discountIds: string[],
  customerId: string | null,
  excludeBookingId: string | null = null,
): Promise<Map<string, DiscountUsage>> {
  const map = new Map<string, DiscountUsage>();
  if (discountIds.length === 0) return map;
  const rows = await q.query<{ discount_id: string; total: number; by_customer: number }>(
    `select discount_id, count(*)::int as total,
            count(*) filter (where customer_id = $2)::int as by_customer
       from discount_redemptions
      where discount_id = any($1::uuid[]) and status in ('reserved', 'confirmed')
        and ($3::uuid is null or booking_id <> $3)
      group by discount_id`,
    [discountIds, customerId, excludeBookingId],
  );
  for (const r of rows) map.set(r.discount_id, { total: num(r.total), byCustomer: num(r.by_customer) });
  return map;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date");

export const discountInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, "Code must be 3-32 chars: A-Z, 0-9, _ or -")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  valueType: z.enum(["fixed_amount", "percentage"]),
  category: z.enum(["general", "coupon", "venture", "plot", "promotional", "campaign", "customer"]),
  value: z.coerce.number().positive(),
  maxDiscountAmount: z.coerce.number().positive().optional().nullable(),
  startsAt: optionalDate,
  expiresAt: optionalDate,
  applicableVentureIds: z.array(z.string().uuid()).default([]),
  applicablePlotIds: z.array(z.string().uuid()).default([]),
  customerId: z.string().uuid().optional().nullable(),
  campaignName: z.string().trim().max(120).optional().nullable(),
  usageLimitTotal: z.coerce.number().int().positive().optional().nullable(),
  usageLimitPerCustomer: z.coerce.number().int().positive().optional().nullable(),
  stackable: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
});
export type DiscountInput = z.infer<typeof discountInputSchema>;

function structuralErrors(i: DiscountInput): string[] {
  const e: string[] = [];
  if (i.category === "coupon" && !i.code) e.push("Coupon discounts require a code");
  if (i.category === "customer" && !i.customerId) e.push("Customer-specific discounts require a customer");
  if (i.category === "venture" && i.applicableVentureIds.length === 0) e.push("Venture-specific discounts require at least one venture");
  if (i.category === "plot" && i.applicablePlotIds.length === 0) e.push("Plot-specific discounts require at least one plot");
  if (i.category === "promotional" && !i.expiresAt) e.push("Time-limited promotional offers require an expiry date");
  if (i.category === "campaign" && !i.campaignName) e.push("Campaign offers require a campaign name");
  if (i.expiresAt && i.startsAt && i.expiresAt <= i.startsAt) e.push("Expiry must be after the start date");
  if (i.expiresAt && i.expiresAt <= new Date()) e.push("Expiry date must be in the future");
  return e;
}

async function assertReferencesInOrg(q: Queryable, orgId: string, i: DiscountInput) {
  if (i.applicableVentureIds.length) {
    const r = await q.query("select id from ventures where organization_id = $1 and id = any($2::uuid[])", [orgId, i.applicableVentureIds]);
    if (r.length !== new Set(i.applicableVentureIds).size) throw badRequest("Invalid venture in applicable ventures");
  }
  if (i.applicablePlotIds.length) {
    const r = await q.query("select id from plots where organization_id = $1 and id = any($2::uuid[])", [orgId, i.applicablePlotIds]);
    if (r.length !== new Set(i.applicablePlotIds).size) throw badRequest("Invalid plot in applicable plots");
  }
  if (i.customerId) {
    const r = await q.query("select id from customers where organization_id = $1 and id = $2", [orgId, i.customerId]);
    if (!r.length) throw badRequest("Customer not found");
  }
}

export async function listDiscounts(ctx: AuthContext, filters: { status?: string; q?: string } = {}) {
  assertPermission(ctx, "discount.view");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["d.organization_id = $1"];
  if (filters.status === "expired") where.push("d.expires_at is not null and d.expires_at <= now()");
  else if (filters.status === "active") where.push("d.status = 'active' and (d.expires_at is null or d.expires_at > now())");
  else if (filters.status) {
    params.push(filters.status);
    where.push(`d.status = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    where.push(`(lower(d.name) like $${params.length} or lower(coalesce(d.code,'')) like $${params.length})`);
  }
  return q.query<Record<string, unknown>>(
    `select d.*, c.full_name as customer_name, u.full_name as created_by_name, a.full_name as approved_by_name,
            (select count(*)::int from discount_redemptions r where r.discount_id = d.id and r.status in ('reserved','confirmed')) as usage_count,
            (select coalesce(sum(r.amount),0) from discount_redemptions r where r.discount_id = d.id and r.status = 'confirmed') as granted_amount
       from discounts d
       left join customers c on c.id = d.customer_id
       left join app_users u on u.id = d.created_by
       left join app_users a on a.id = d.approved_by
      where ${where.join(" and ")} order by d.created_at desc`,
    params,
  );
}

export async function getDiscount(ctx: AuthContext, id: string) {
  assertPermission(ctx, "discount.view");
  const q = await db();
  const [d] = await q.query<Record<string, unknown>>(
    `select d.*, c.full_name as customer_name, u.full_name as created_by_name, a.full_name as approved_by_name,
            (select count(*)::int from discount_redemptions r where r.discount_id = d.id and r.status in ('reserved','confirmed')) as usage_count,
            (select coalesce(sum(r.amount),0) from discount_redemptions r where r.discount_id = d.id and r.status = 'confirmed') as granted_amount,
            (select a2.actor_user_id from discount_approvals a2 where a2.discount_id = d.id and a2.action = 'submitted'
              order by a2.created_at desc limit 1) as last_submitted_by
       from discounts d
       left join customers c on c.id = d.customer_id
       left join app_users u on u.id = d.created_by
       left join app_users a on a.id = d.approved_by
      where d.organization_id = $1 and d.id = $2`,
    [ctx.organizationId, id],
  );
  if (!d) throw notFound("Discount");
  const approvals = await q.query<Record<string, unknown>>(
    `select a.*, u.full_name as actor_name from discount_approvals a left join app_users u on u.id = a.actor_user_id
      where a.discount_id = $1 order by a.created_at desc`,
    [id],
  );
  return { discount: d, approvals };
}

export async function createDiscount(ctx: AuthContext, input: DiscountInput) {
  assertPermission(ctx, "discount.create");
  const errs = structuralErrors(input);
  return withTx(async (q) => {
    const org = await loadOrgSettings(q, ctx.organizationId);
    const policy = evaluateDiscountPolicy(
      { valueType: input.valueType, category: input.category, value: input.value, maxDiscountAmount: input.maxDiscountAmount ?? null, requiresApproval: input.requiresApproval, stackable: input.stackable },
      { maxDiscountPercent: org.maxDiscountPercent, approvalThresholdPercent: org.discountApprovalThresholdPercent, allowStacking: org.allowDiscountStacking },
      ctx.role,
    );
    const allErrors = [...errs, ...policy.errors];
    if (allErrors.length) throw badRequest(allErrors.join("; "), allErrors);
    await assertReferencesInOrg(q, ctx.organizationId, input);
    const status = policy.requiresApproval ? "pending_approval" : "active";
    let row: Record<string, unknown>;
    try {
      [row] = await q.query<Record<string, unknown>>(
        `insert into discounts (organization_id, name, code, value_type, category, value, max_discount_amount, starts_at, expires_at,
                                applicable_venture_ids, applicable_plot_ids, customer_id, campaign_name, usage_limit_total,
                                usage_limit_per_customer, stackable, requires_approval, status, approved_by, approved_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, now()),$9,$10::uuid[],$11::uuid[],$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         returning *`,
        [
          ctx.organizationId, input.name, input.code ?? null, input.valueType, input.category, input.value, input.maxDiscountAmount ?? null,
          input.startsAt, input.expiresAt, input.applicableVentureIds, input.applicablePlotIds, input.customerId ?? null,
          input.campaignName ?? null, input.usageLimitTotal ?? null, input.usageLimitPerCustomer ?? null, input.stackable,
          policy.requiresApproval, status, status === "active" ? ctx.user.id : null, status === "active" ? new Date() : null, ctx.user.id,
        ],
      );
    } catch (e) {
      if (isPgError(e, "23505") && constraintName(e) === "discounts_org_code_key") throw conflict("A discount with this code already exists");
      if (isPgError(e, "23514")) throw badRequest("Discount violates a validation rule");
      throw e;
    }
    await q.query(
      "insert into discount_approvals (organization_id, discount_id, action, actor_user_id, note) values ($1,$2,$3,$4,$5)",
      [ctx.organizationId, row.id, status === "active" ? "approved" : "submitted", ctx.user.id, policy.reasons.join("; ") || null],
    );
    await writeAudit(q, ctx, { action: "discount.created", entityType: "discount", entityId: String(row.id), summary: `Created discount ${input.name} (${status})`, after: row });
    return { discount: row, policy };
  });
}

export async function updateDiscount(ctx: AuthContext, id: string, input: DiscountInput) {
  assertPermission(ctx, "discount.create");
  const errs = structuralErrors(input);
  return withTx(async (q) => {
    const [before] = await q.query<Record<string, unknown>>("select * from discounts where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
    if (!before) throw notFound("Discount");
    if (["archived", "rejected"].includes(String(before.status))) throw conflict(`A ${before.status} discount cannot be edited`);
    const org = await loadOrgSettings(q, ctx.organizationId);
    const policy = evaluateDiscountPolicy(
      { valueType: input.valueType, category: input.category, value: input.value, maxDiscountAmount: input.maxDiscountAmount ?? null, requiresApproval: input.requiresApproval, stackable: input.stackable },
      { maxDiscountPercent: org.maxDiscountPercent, approvalThresholdPercent: org.discountApprovalThresholdPercent, allowStacking: org.allowDiscountStacking },
      ctx.role,
    );
    const allErrors = [...errs, ...policy.errors];
    if (allErrors.length) throw badRequest(allErrors.join("; "), allErrors);
    await assertReferencesInOrg(q, ctx.organizationId, input);
    // Any edit by a role that requires approval sends the discount back for approval.
    const status = policy.requiresApproval ? "pending_approval" : before.status === "paused" ? "paused" : "active";
    const [after] = await q.query<Record<string, unknown>>(
      `update discounts set name=$3, code=$4, value_type=$5, category=$6, value=$7, max_discount_amount=$8, starts_at=coalesce($9, starts_at),
              expires_at=$10, applicable_venture_ids=$11::uuid[], applicable_plot_ids=$12::uuid[], customer_id=$13, campaign_name=$14,
              usage_limit_total=$15, usage_limit_per_customer=$16, stackable=$17, requires_approval=$18, status=$19,
              approved_by = case when $19 = 'pending_approval' then null else $20::uuid end,
              approved_at = case when $19 = 'pending_approval' then null else now() end
        where organization_id = $1 and id = $2 returning *`,
      [
        ctx.organizationId, id, input.name, input.code ?? null, input.valueType, input.category, input.value, input.maxDiscountAmount ?? null,
        input.startsAt, input.expiresAt, input.applicableVentureIds, input.applicablePlotIds, input.customerId ?? null, input.campaignName ?? null,
        input.usageLimitTotal ?? null, input.usageLimitPerCustomer ?? null, input.stackable, policy.requiresApproval, status, ctx.user.id,
      ],
    ).catch((e) => {
      if (isPgError(e, "23505")) throw conflict("A discount with this code already exists");
      throw e;
    });
    await q.query(
      "insert into discount_approvals (organization_id, discount_id, action, actor_user_id, note) values ($1,$2,$3,$4,$5)",
      [ctx.organizationId, id, status === "pending_approval" ? "submitted" : "approved", ctx.user.id, "Edited: " + (policy.reasons.join("; ") || "no approval required")],
    );
    await writeAudit(q, ctx, { action: "discount.updated", entityType: "discount", entityId: id, before, after });
    return { discount: after, policy };
  });
}

export async function decideDiscount(ctx: AuthContext, id: string, action: "approve" | "reject" | "pause" | "reactivate" | "archive", note?: string) {
  if (action === "approve" || action === "reject") assertPermission(ctx, "discount.approve");
  else assertPermission(ctx, "discount.create");
  return withTx(async (q) => {
    const [d] = await q.query<Record<string, unknown>>("select * from discounts where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
    if (!d) throw notFound("Discount");
    const transitions: Record<string, { from: string[]; to: string; log: string }> = {
      approve: { from: ["pending_approval"], to: "active", log: "approved" },
      reject: { from: ["pending_approval"], to: "rejected", log: "rejected" },
      pause: { from: ["active"], to: "paused", log: "paused" },
      reactivate: { from: ["paused"], to: "active", log: "reactivated" },
      archive: { from: ["draft", "pending_approval", "active", "paused", "rejected"], to: "archived", log: "archived" },
    };
    const t = transitions[action];
    if (!t.from.includes(String(d.status))) throw conflict(`Cannot ${action} a discount that is ${d.status}`);
    if (action === "approve" && d.created_by === ctx.user.id && d.requires_approval) {
      throw forbidden("A discount that requires approval must be approved by someone other than its creator");
    }
    if (action === "approve") {
      // Four-eyes also applies to whoever last edited & re-submitted the discount.
      const [last] = await q.query<{ actor_user_id: string | null }>(
        "select actor_user_id from discount_approvals where discount_id = $1 and action = 'submitted' order by created_at desc limit 1",
        [id],
      );
      if (last?.actor_user_id === ctx.user.id) {
        throw forbidden("A discount must be approved by someone other than the person who submitted it");
      }
    }
    if (action === "reactivate" && d.requires_approval && !d.approved_at) throw conflict("Discount was never approved");
    const [after] = await q.query<Record<string, unknown>>(
      `update discounts set status = $3,
              approved_by = case when $4 then $5::uuid else approved_by end,
              approved_at = case when $4 then now() else approved_at end
        where id = $1 and organization_id = $2 returning *`,
      [id, ctx.organizationId, t.to, action === "approve", ctx.user.id],
    );
    await q.query(
      "insert into discount_approvals (organization_id, discount_id, action, actor_user_id, note) values ($1,$2,$3,$4,$5)",
      [ctx.organizationId, id, t.log, ctx.user.id, note ?? (action === "archive" ? "Archived" : null)],
    );
    await writeAudit(q, ctx, { action: `discount.${action}`, entityType: "discount", entityId: id, before: d, after });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Validation preview & eligible offers (customer-facing and staff)
// ---------------------------------------------------------------------------
export const validateSchema = z.object({
  plotIds: z.array(z.string().uuid()).min(1).max(10),
  discountRefs: z.array(z.string().trim().min(1).max(64)).max(5).default([]),
  customerId: z.string().uuid().optional().nullable(),
});

async function loadPricingPlots(ctx: AuthContext, q: Queryable, plotIds: string[]) {
  const rows = await q.query<{ id: string; plot_number: string; area_sq_yards: string; base_price_per_sq_yard: string; venture_id: string; is_published: boolean; booking_amount_percent: string | null }>(
    `select p.id, p.plot_number, p.area_sq_yards, p.base_price_per_sq_yard, p.venture_id, v.is_published, v.booking_amount_percent
       from plots p join ventures v on v.id = p.venture_id
      where p.organization_id = $1 and p.id = any($2::uuid[])`,
    [ctx.organizationId, plotIds],
  );
  if (rows.length !== new Set(plotIds).size) throw notFound("Plot");
  const ventureId = rows[0].venture_id;
  if (rows.some((r) => r.venture_id !== ventureId)) throw badRequest("All plots must belong to the same venture");
  if (ctx.role === "customer" ? !rows[0].is_published : !canAccessVenture(ctx, ventureId)) throw notFound("Plot");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const plots: PricingPlot[] = plotIds.map((id) => {
    const r = byId.get(id)!;
    return { id, plotNumber: r.plot_number, areaSqYards: num(r.area_sq_yards), pricePerSqYard: num(r.base_price_per_sq_yard) };
  });
  return { ventureId, plots, ventureBookingPercent: numOrNull(rows[0].booking_amount_percent) };
}

/** POST /api/discounts/validate — server-side price preview; never trusts client amounts. */
export async function validateDiscounts(ctx: AuthContext, input: z.infer<typeof validateSchema>) {
  if (ctx.role !== "customer") assertStaff(ctx);
  const q = await db();
  const customerId = ctx.role === "customer" ? ctx.customerId : (input.customerId ?? null);
  if (input.customerId && ctx.role !== "customer") {
    const [c] = await q.query("select 1 from customers where id = $1 and organization_id = $2", [input.customerId, ctx.organizationId]);
    if (!c) throw notFound("Customer");
  }
  const { ventureId, plots, ventureBookingPercent } = await loadPricingPlots(ctx, q, [...new Set(input.plotIds)]);
  const org = await loadOrgSettings(q, ctx.organizationId);
  const requested = await loadDiscountsByRefs(q, ctx.organizationId, input.discountRefs);
  const usage = await loadUsage(q, requested.flatMap((r) => (r.discount ? [r.discount.id] : [])), customerId);
  const result = calculatePricing({
    ventureId, plots, customerId, now: new Date(), currency: org.currency,
    bookingAmountPercent: ventureBookingPercent ?? org.bookingAmountPercent, allowStacking: org.allowDiscountStacking,
    maxDiscountPercent: org.maxDiscountPercent, requested, usage,
  });
  return result;
}

/** Codeless offers the selection is eligible for (codes are never listed). */
export async function eligibleOffers(ctx: AuthContext, plotIds: string[], customerIdInput?: string | null) {
  if (ctx.role !== "customer") assertStaff(ctx);
  const q = await db();
  const { ventureId, plots } = await loadPricingPlots(ctx, q, [...new Set(plotIds)]);
  const customerId = ctx.role === "customer" ? ctx.customerId : (customerIdInput ?? null);
  const rows = await q.query<Record<string, unknown>>(
    "select * from discounts where organization_id = $1 and code is null and status = 'active'",
    [ctx.organizationId],
  );
  const discounts = rows.map(mapDiscount);
  const usage = await loadUsage(q, discounts.map((d) => d.id), customerId);
  const now = new Date();
  return discounts
    .filter((d) => !checkDiscountEligibility(d, { ventureId, plotIds: plots.map((p) => p.id), customerId, now, usage: usage.get(d.id) }))
    .map((d) => ({ id: d.id, name: d.name, valueType: d.valueType, value: d.value, maxDiscountAmount: d.maxDiscountAmount, expiresAt: d.expiresAt, stackable: d.stackable }));
}

// ---------------------------------------------------------------------------
// Admin dashboard helpers
// ---------------------------------------------------------------------------
export interface DiscountKpis {
  active: number;
  pendingApproval: number;
  paused: number;
  expired: number;
  rejected: number;
  archived: number;
  total: number;
  grantedOnConfirmed: number;
  redemptionsConfirmed: number;
  redemptionsReserved: number;
  settings: { allowStacking: boolean; maxDiscountPercent: number; approvalThresholdPercent: number };
}

/** KPI figures for the discount dashboard (granted amounts only count CONFIRMED bookings). */
export async function discountDashboard(ctx: AuthContext): Promise<DiscountKpis> {
  assertPermission(ctx, "discount.view");
  const q = await db();
  const [k] = await q.query<Record<string, number>>(
    `select count(*) filter (where status = 'active' and (expires_at is null or expires_at > now()))::int as active,
            count(*) filter (where status = 'pending_approval')::int as pending,
            count(*) filter (where status = 'paused')::int as paused,
            count(*) filter (where expires_at is not null and expires_at <= now())::int as expired,
            count(*) filter (where status = 'rejected')::int as rejected,
            count(*) filter (where status = 'archived')::int as archived,
            count(*)::int as total
       from discounts where organization_id = $1`,
    [ctx.organizationId],
  );
  const [r] = await q.query<{ granted: string; confirmed: number; reserved: number }>(
    `select coalesce(sum(r.amount) filter (where r.status = 'confirmed' and b.status in ('confirmed','completed')),0) as granted,
            count(*) filter (where r.status = 'confirmed')::int as confirmed,
            count(*) filter (where r.status = 'reserved')::int as reserved
       from discount_redemptions r join bookings b on b.id = r.booking_id
      where r.organization_id = $1`,
    [ctx.organizationId],
  );
  const org = await loadOrgSettings(q, ctx.organizationId);
  return {
    active: num(k.active), pendingApproval: num(k.pending), paused: num(k.paused), expired: num(k.expired),
    rejected: num(k.rejected), archived: num(k.archived), total: num(k.total),
    grantedOnConfirmed: num(r.granted), redemptionsConfirmed: num(r.confirmed), redemptionsReserved: num(r.reserved),
    settings: { allowStacking: org.allowDiscountStacking, maxDiscountPercent: org.maxDiscountPercent, approvalThresholdPercent: org.discountApprovalThresholdPercent },
  };
}

/** Dry-run of the server policy for the admin form (nothing is saved). */
export async function previewDiscountPolicy(ctx: AuthContext, input: DiscountInput) {
  assertPermission(ctx, "discount.create");
  const q = await db();
  const org = await loadOrgSettings(q, ctx.organizationId);
  const policy = evaluateDiscountPolicy(
    { valueType: input.valueType, category: input.category, value: input.value, maxDiscountAmount: input.maxDiscountAmount ?? null, requiresApproval: input.requiresApproval, stackable: input.stackable },
    { maxDiscountPercent: org.maxDiscountPercent, approvalThresholdPercent: org.discountApprovalThresholdPercent, allowStacking: org.allowDiscountStacking },
    ctx.role,
  );
  return { ...policy, errors: [...structuralErrors(input), ...policy.errors], resultingStatus: policy.requiresApproval ? "pending_approval" : "active" };
}

/** Ventures (and optionally one venture's plots) for the discount form pickers. */
export async function discountFormOptions(ctx: AuthContext, ventureId?: string | null) {
  assertPermission(ctx, "discount.view");
  const q = await db();
  const ventures = await q.query<{ id: string; name: string; code: string }>(
    "select id, name, code from ventures where organization_id = $1 and status <> 'archived' order by name",
    [ctx.organizationId],
  );
  let plots: { id: string; plot_number: string; status: string; venture_id: string }[] = [];
  if (ventureId) {
    if (!isUuid(ventureId) || !ventures.some((v) => v.id === ventureId)) throw notFound("Venture");
    plots = await q.query(
      "select id, plot_number, status, venture_id from plots where organization_id = $1 and venture_id = $2 order by length(plot_number), plot_number",
      [ctx.organizationId, ventureId],
    );
  }
  return { ventures, plots };
}

/** Labels for the plots/customer referenced by a discount (detail page). */
export async function discountReferenceLabels(ctx: AuthContext, plotIds: string[]) {
  assertPermission(ctx, "discount.view");
  if (plotIds.length === 0) return [] as { id: string; plot_number: string; venture_id: string; venture_name: string }[];
  const q = await db();
  return q.query<{ id: string; plot_number: string; venture_id: string; venture_name: string }>(
    `select p.id, p.plot_number, p.venture_id, v.name as venture_name from plots p join ventures v on v.id = p.venture_id
      where p.organization_id = $1 and p.id = any($2::uuid[]) order by v.name, length(p.plot_number), p.plot_number`,
    [ctx.organizationId, plotIds],
  );
}

export { unprocessable };
