import { randomUUID } from "node:crypto";
import { z } from "zod";
import ExcelJS from "exceljs";
import type { Queryable } from "@/lib/db/types";
import { isPgError, num } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff, can, inNetwork } from "@/lib/auth/context";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "@/lib/errors";
import { writeAudit, type AuditActor } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { PROPERTY_TYPES } from "@/lib/viewer-settings";
import {
  calculateCommissions, DEFAULT_LEVELS, MAX_LEVELS, selectApplicablePlan, validatePlanLevels,
  type ChainMember, type CommissionBasis, type CommissionPlanInput, type PlanLevel,
} from "@/lib/commissions/engine";
import { db, withTx } from "./common";
import { createNotification } from "./notifications";

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
export const PLAN_PROPERTY_TYPES = ["any", ...PROPERTY_TYPES.map((p) => p.id)] as [string, ...string[]];

/** Postgres uuid[] can come back as a JS array or as a "{a,b}" literal depending on the driver. */
function uuidArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const inner = v.replace(/^\{|\}$/g, "").trim();
    return inner ? inner.split(",").map((s) => s.trim().replace(/^"|"$/g, "")) : [];
  }
  return [];
}

async function loadPlan(q: Queryable, orgId: string, planId: string): Promise<{ row: Record<string, unknown>; input: CommissionPlanInput }> {
  const [row] = await q.query<Record<string, unknown>>("select * from commission_plans where organization_id = $1 and id = $2", [orgId, planId]);
  if (!row) throw notFound("Commission plan");
  row.venture_ids = uuidArray(row.venture_ids);
  const basis = (row.basis as CommissionBasis) ?? "per_sq_yard";
  const levels = await q.query<{ level: number; label: string; rate_per_sq_yard: string; rate_percent: string | null; is_eligible: boolean }>(
    "select level, label, rate_per_sq_yard, rate_percent, is_eligible from commission_plan_levels where plan_id = $1 order by level",
    [planId],
  );
  return {
    row,
    input: {
      id: String(row.id),
      version: num(row.version),
      method: row.calculation_method as CommissionPlanInput["method"],
      paySellingEmployee: Boolean(row.pay_selling_employee),
      ceoSeparateEntitlement: Boolean(row.ceo_separate_entitlement),
      maxPayableLevels: num(row.max_payable_levels),
      levelCount: num(row.level_count),
      basis,
      levels: levels.map((l) => ({
        level: l.level, label: l.label, rate: basis === "percentage" ? num(l.rate_percent ?? 0) : num(l.rate_per_sq_yard), eligible: l.is_eligible,
      })),
    },
  };
}

export async function listPlans(ctx: AuthContext) {
  assertPermission(ctx, "commission.plan_manage");
  const q = await db();
  const rows = await q.query<Record<string, unknown>>(
    `select p.*, cu.full_name as created_by_name, au.full_name as approved_by_name, su.full_name as submitted_by_name,
            (select json_agg(json_build_object('level', l.level, 'label', l.label,
                     'rate', case when p.basis = 'percentage' then l.rate_percent else l.rate_per_sq_yard end, 'eligible', l.is_eligible) order by l.level)
               from commission_plan_levels l where l.plan_id = p.id) as levels,
            (select json_agg(json_build_object('id', v.id, 'name', v.name) order by v.name)
               from ventures v where v.organization_id = p.organization_id and v.id = any(p.venture_ids)) as ventures,
            (select json_agg(json_build_object('action', a.action, 'note', a.note, 'actor_name', au2.full_name, 'created_at', a.created_at) order by a.created_at desc)
               from commission_plan_approvals a left join app_users au2 on au2.id = a.actor_user_id where a.plan_id = p.id) as approvals
       from commission_plans p left join app_users cu on cu.id = p.created_by left join app_users au on au.id = p.approved_by
       left join app_users su on su.id = p.submitted_by
      where p.organization_id = $1 order by p.version desc`,
    [ctx.organizationId],
  );
  for (const r of rows) r.venture_ids = uuidArray(r.venture_ids);
  return rows;
}

/** Ventures a plan can be scoped to (plan managers only). */
export async function listPlanVentures(ctx: AuthContext) {
  assertPermission(ctx, "commission.plan_manage");
  const q = await db();
  return q.query<{ id: string; name: string; property_type: string }>(
    "select id, name, property_type from ventures where organization_id = $1 order by name",
    [ctx.organizationId],
  );
}

export async function getPlan(ctx: AuthContext, planId: string) {
  assertPermission(ctx, "commission.plan_manage");
  const q = await db();
  const { row, input } = await loadPlan(q, ctx.organizationId, planId);
  const approvals = await q.query<Record<string, unknown>>(
    `select a.*, u.full_name as actor_name from commission_plan_approvals a left join app_users u on u.id = a.actor_user_id
      where a.plan_id = $1 order by a.created_at desc`,
    [planId],
  );
  return { plan: row, levels: input.levels, levelCount: input.levelCount, basis: input.basis, approvals };
}

const levelSchema = z.object({
  level: z.number().int().min(1).max(MAX_LEVELS),
  label: z.string().trim().min(1).max(60),
  rate: z.coerce.number().min(0),
  eligible: z.boolean(),
});

export const planInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  calculationMethod: z.enum(["differential", "full_rate"]),
  paySellingEmployee: z.boolean(),
  ceoSeparateEntitlement: z.boolean(),
  maxPayableLevels: z.coerce.number().int().min(1).max(MAX_LEVELS),
  /** Defaults to the number of level rows supplied. */
  levelCount: z.coerce.number().int().min(1).max(MAX_LEVELS).optional(),
  basis: z.enum(["per_sq_yard", "percentage"]).optional(),
  propertyType: z.enum(PLAN_PROPERTY_TYPES).optional(),
  /** Empty = all ventures of the organization. */
  ventureIds: z.array(z.string().uuid()).max(500).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  levels: z.array(levelSchema).min(1).max(MAX_LEVELS),
});
export type PlanInput = z.input<typeof planInputSchema>;

interface NormalizedPlan {
  name: string;
  calculationMethod: "differential" | "full_rate";
  paySellingEmployee: boolean;
  ceoSeparateEntitlement: boolean;
  maxPayableLevels: number;
  levelCount: number;
  basis: CommissionBasis;
  propertyType: string;
  ventureIds: string[];
  notes: string | null;
  levels: PlanLevel[];
}

function normalizePlan(input: PlanInput): NormalizedPlan {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Invalid commission plan", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const p = parsed.data;
  const n: NormalizedPlan = {
    name: p.name, calculationMethod: p.calculationMethod, paySellingEmployee: p.paySellingEmployee, ceoSeparateEntitlement: p.ceoSeparateEntitlement,
    maxPayableLevels: p.maxPayableLevels, levelCount: p.levelCount ?? p.levels.length, basis: p.basis ?? "per_sq_yard",
    propertyType: p.propertyType ?? "any", ventureIds: [...new Set((p.ventureIds ?? []).map((v) => v.toLowerCase()))].sort(),
    notes: p.notes?.trim() || null, levels: [...p.levels].sort((a, b) => a.level - b.level),
  };
  assertValidPlan(n);
  return n;
}

function assertValidPlan(p: { levels: { level: number; rate: number }[]; levelCount: number; basis: CommissionBasis; maxPayableLevels: number }) {
  const v = validatePlanLevels(p.levels, { levelCount: p.levelCount, basis: p.basis });
  const errors = [...v.errors];
  if (p.maxPayableLevels > p.levelCount) errors.push(`Maximum payable levels (${p.maxPayableLevels}) cannot exceed the number of levels (${p.levelCount})`);
  if (errors.length) throw badRequest(errors.join("; "), errors);
}

async function assertVenturesInOrg(q: Queryable, orgId: string, ventureIds: string[]) {
  if (ventureIds.length === 0) return;
  const rows = await q.query<{ id: string }>("select id from ventures where organization_id = $1 and id = any($2::uuid[])", [orgId, ventureIds]);
  if (rows.length !== ventureIds.length) throw badRequest("One or more selected ventures do not belong to this organization");
}

async function insertLevels(q: Queryable, orgId: string, planId: string, p: NormalizedPlan) {
  for (const l of p.levels) {
    await q.query(
      "insert into commission_plan_levels (organization_id, plan_id, level, label, rate_per_sq_yard, rate_percent, is_eligible) values ($1,$2,$3,$4,$5,$6,$7)",
      [orgId, planId, l.level, l.label, p.basis === "per_sq_yard" ? l.rate : 0, p.basis === "percentage" ? l.rate : null, l.eligible],
    );
  }
}

function planFromLoaded(row: Record<string, unknown>, p: CommissionPlanInput, notes: string | null): PlanInput {
  return {
    name: String(row.name), calculationMethod: p.method, paySellingEmployee: p.paySellingEmployee, ceoSeparateEntitlement: p.ceoSeparateEntitlement,
    maxPayableLevels: p.maxPayableLevels, levelCount: p.levelCount, basis: p.basis, propertyType: String(row.property_type ?? "any"),
    ventureIds: uuidArray(row.venture_ids), notes, levels: p.levels,
  };
}

/**
 * Creates a new DRAFT version.
 *  - with `input`: from the supplied definition (any scope / basis / level count);
 *  - with `opts.fromPlanId`: a copy of that version with the SAME scope ("Edit plan" on an
 *    approved version — approved versions themselves are never modified);
 *  - otherwise: a copy of the latest organization-wide plan (or the proposed defaults).
 */
export async function createPlanDraft(ctx: AuthContext, input?: PlanInput, opts: { fromPlanId?: string } = {}) {
  assertPermission(ctx, "commission.plan_manage");
  return withTx(async (q) => {
    let source: PlanInput | undefined = input;
    let derivedFrom: number | null = null;
    if (!source && opts.fromPlanId) {
      const { row, input: p } = await loadPlan(q, ctx.organizationId, opts.fromPlanId);
      derivedFrom = p.version;
      source = planFromLoaded(row, p, `Edited from v${p.version}${row.notes ? ` — ${String(row.notes)}` : ""}`.slice(0, 2000));
    }
    if (!source) {
      const [latest] = await q.query<{ id: string }>(
        "select id from commission_plans where organization_id = $1 and property_type = 'any' and cardinality(venture_ids) = 0 order by version desc limit 1",
        [ctx.organizationId],
      );
      if (latest) {
        const { row, input: p } = await loadPlan(q, ctx.organizationId, latest.id);
        derivedFrom = p.version;
        source = planFromLoaded(row, p, null);
      } else {
        source = {
          name: "Standard 8-level plan", calculationMethod: "differential", paySellingEmployee: true, ceoSeparateEntitlement: false,
          maxPayableLevels: 8, levelCount: 8, basis: "per_sq_yard", propertyType: "any", ventureIds: [],
          notes: "Proposed default rates — review before approval.",
          levels: DEFAULT_LEVELS.map((l) => ({ ...l, eligible: true })),
        };
      }
    }
    const p = normalizePlan(source);
    await assertVenturesInOrg(q, ctx.organizationId, p.ventureIds);
    const [{ v }] = await q.query<{ v: number }>("select coalesce(max(version),0)::int + 1 as v from commission_plans where organization_id = $1", [ctx.organizationId]);
    const [plan] = await q.query<{ id: string }>(
      `insert into commission_plans (organization_id, name, version, calculation_method, pay_selling_employee, ceo_separate_entitlement,
                                     max_payable_levels, level_count, basis, property_type, venture_ids, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12,$13) returning id`,
      [ctx.organizationId, p.name, v, p.calculationMethod, p.paySellingEmployee, p.ceoSeparateEntitlement, p.maxPayableLevels,
        p.levelCount, p.basis, p.propertyType, p.ventureIds, p.notes, ctx.user.id],
    );
    await insertLevels(q, ctx.organizationId, plan.id, p);
    await q.query("insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id, note) values ($1,$2,'created',$3,$4)",
      [ctx.organizationId, plan.id, ctx.user.id, derivedFrom ? `New version based on v${derivedFrom}` : null]);
    await writeAudit(q, ctx, {
      action: "commission_plan.created", entityType: "commission_plan", entityId: plan.id,
      summary: `Draft commission plan v${v}${derivedFrom ? ` (from v${derivedFrom})` : ""}`, after: p,
    });
    return { id: plan.id, version: v };
  });
}

/** "Edit plan": one click creates a new draft version prefilled from `planId`, with the same scope. */
export async function createVersionFromPlan(ctx: AuthContext, planId: string) {
  return createPlanDraft(ctx, undefined, { fromPlanId: planId });
}

export async function updatePlanDraft(ctx: AuthContext, planId: string, input: PlanInput) {
  assertPermission(ctx, "commission.plan_manage");
  const p = normalizePlan(input);
  return withTx(async (q) => {
    const [row] = await q.query<{ status: string }>("select status from commission_plans where organization_id = $1 and id = $2 for update", [ctx.organizationId, planId]);
    if (!row) throw notFound("Commission plan");
    if (row.status !== "draft") throw conflict("Only draft plans can be edited; create a new version instead");
    await assertVenturesInOrg(q, ctx.organizationId, p.ventureIds);
    await q.query(
      `update commission_plans set name=$3, calculation_method=$4, pay_selling_employee=$5, ceo_separate_entitlement=$6, max_payable_levels=$7, notes=$8,
              level_count=$9, basis=$10, property_type=$11, venture_ids=$12::uuid[]
        where organization_id = $1 and id = $2`,
      [ctx.organizationId, planId, p.name, p.calculationMethod, p.paySellingEmployee, p.ceoSeparateEntitlement, p.maxPayableLevels, p.notes,
        p.levelCount, p.basis, p.propertyType, p.ventureIds],
    );
    // The number of levels may change: replace the draft's level rows.
    await q.query("delete from commission_plan_levels where plan_id = $1", [planId]);
    await insertLevels(q, ctx.organizationId, planId, p);
    await q.query("insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id) values ($1,$2,'updated',$3)", [ctx.organizationId, planId, ctx.user.id]);
    await writeAudit(q, ctx, { action: "commission_plan.updated", entityType: "commission_plan", entityId: planId, after: p });
    return { ok: true };
  });
}

export async function submitPlan(ctx: AuthContext, planId: string, note?: string) {
  assertPermission(ctx, "commission.plan_manage");
  return withTx(async (q) => {
    const { row, input } = await loadPlan(q, ctx.organizationId, planId);
    if (row.status !== "draft") throw conflict("Only draft plans can be submitted");
    assertValidPlan(input);
    await q.query("update commission_plans set status = 'pending_approval', submitted_by = $2, submitted_at = now() where id = $1", [planId, ctx.user.id]);
    await q.query("insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id, note) values ($1,$2,'submitted',$3,$4)", [ctx.organizationId, planId, ctx.user.id, note ?? null]);
    await writeAudit(q, ctx, { action: "commission_plan.submitted", entityType: "commission_plan", entityId: planId });
    return { ok: true };
  });
}

async function requiresSecondApprover(q: Queryable, orgId: string): Promise<boolean> {
  const [o] = await q.query<{ v: boolean | null }>("select commission_requires_second_approver as v from organizations where id = $1", [orgId]);
  return o?.v ?? true;
}

/**
 * Approves and activates a plan from `effectiveFrom` (default now). The previously
 * open plan OF THE SAME SCOPE (property type + ventures) is closed at that instant;
 * plans of other scopes are untouched. Historical ledger entries are never rewritten
 * because every entry records the plan id & version it was calculated with.
 * Four-eyes: the submitter may approve their own plan only when the organization
 * has switched off `commission_requires_second_approver` (the DB enforces the same).
 */
export async function approvePlan(ctx: AuthContext, planId: string, opts: { effectiveFrom?: string | null; note?: string } = {}) {
  assertPermission(ctx, "commission.approve");
  return withTx(async (q) => {
    const [row] = await q.query<Record<string, unknown>>("select * from commission_plans where organization_id = $1 and id = $2 for update", [ctx.organizationId, planId]);
    if (!row) throw notFound("Commission plan");
    if (row.status !== "pending_approval") throw conflict("Only plans pending approval can be approved");
    const selfApproval = row.submitted_by === ctx.user.id;
    if (selfApproval && (await requiresSecondApprover(q, ctx.organizationId))) {
      throw forbidden("A plan must be approved by someone other than its submitter");
    }
    const effectiveFrom = opts.effectiveFrom ? new Date(opts.effectiveFrom) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) throw badRequest("Invalid effective date");
    if (effectiveFrom.getTime() < Date.now() - 60_000) throw badRequest("Effective date cannot be in the past (history is never rewritten)");
    const ventureIds = uuidArray(row.venture_ids);
    const [open] = await q.query<{ id: string; effective_from: Date; version: number }>(
      `select id, effective_from, version from commission_plans
        where organization_id = $1 and property_type = $2 and venture_ids = $3::uuid[]
          and status in ('active','superseded') and effective_to is null for update`,
      [ctx.organizationId, row.property_type, ventureIds],
    );
    if (open) {
      if (new Date(open.effective_from) >= effectiveFrom) throw badRequest("Effective date must be after the current plan's start");
      await q.query("update commission_plans set status = 'superseded', effective_to = $2 where id = $1", [open.id, effectiveFrom]);
      await q.query("insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id, note) values ($1,$2,'superseded',$3,$4)",
        [ctx.organizationId, open.id, ctx.user.id, `Superseded by v${row.version}`]);
    }
    try {
      await q.query("update commission_plans set status = 'active', approved_by = $2, approved_at = now(), effective_from = $3 where id = $1", [planId, ctx.user.id, effectiveFrom]);
    } catch (e) {
      if (isPgError(e, "P0001")) throw unprocessable((e as Error).message);
      if (isPgError(e, "23505")) throw conflict("Another approved plan for this scope is already open");
      throw e;
    }
    const note = selfApproval ? ["Self-approved (single-approver mode)", opts.note].filter(Boolean).join(" — ") : (opts.note ?? null);
    await q.query("insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id, note) values ($1,$2,'approved',$3,$4)", [ctx.organizationId, planId, ctx.user.id, note]);
    await writeAudit(q, ctx, {
      action: "commission_plan.approved", entityType: "commission_plan", entityId: planId,
      summary: `Plan v${row.version} effective ${effectiveFrom.toISOString()}${selfApproval ? " (self-approved, single-approver mode)" : ""}`,
      metadata: { selfApproval, supersededPlanId: open?.id ?? null, propertyType: row.property_type, ventureIds },
    });
    return { ok: true, effectiveFrom: effectiveFrom.toISOString(), supersededPlanId: open?.id ?? null };
  });
}

export async function rejectPlan(ctx: AuthContext, planId: string, note: string) {
  assertPermission(ctx, "commission.approve");
  return withTx(async (q) => {
    const [row] = await q.query<{ status: string }>("select status from commission_plans where organization_id = $1 and id = $2 for update", [ctx.organizationId, planId]);
    if (!row) throw notFound("Commission plan");
    if (row.status !== "pending_approval") throw conflict("Only plans pending approval can be rejected");
    await q.query("update commission_plans set status = 'rejected' where id = $1", [planId]);
    await q.query("insert into commission_plan_approvals (organization_id, plan_id, action, actor_user_id, note) values ($1,$2,'rejected',$3,$4)", [ctx.organizationId, planId, ctx.user.id, note]);
    await writeAudit(q, ctx, { action: "commission_plan.rejected", entityType: "commission_plan", entityId: planId, summary: note });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Organization commission settings
// ---------------------------------------------------------------------------
export interface CommissionSettings {
  requiresSecondApprover: boolean;
}

export async function getCommissionSettings(ctx: AuthContext): Promise<CommissionSettings> {
  assertPermission(ctx, "commission.plan_manage");
  const q = await db();
  return { requiresSecondApprover: await requiresSecondApprover(q, ctx.organizationId) };
}

export const commissionSettingsSchema = z.object({ requiresSecondApprover: z.boolean() });

/** Org administrators only: toggles the four-eyes requirement for commission plan approval. */
export async function updateCommissionSettings(ctx: AuthContext, input: CommissionSettings): Promise<CommissionSettings> {
  assertPermission(ctx, "org.manage");
  assertPermission(ctx, "commission.approve");
  const value = commissionSettingsSchema.parse(input).requiresSecondApprover;
  return withTx(async (q) => {
    const before = await requiresSecondApprover(q, ctx.organizationId);
    await q.query("update organizations set commission_requires_second_approver = $2 where id = $1", [ctx.organizationId, value]);
    await writeAudit(q, ctx, {
      action: "commission_settings.updated", entityType: "organization", entityId: ctx.organizationId,
      summary: value ? "Commission plans now require a second approver" : "Commission plans may be approved by their submitter (single-approver mode)",
      before: { requiresSecondApprover: before }, after: { requiresSecondApprover: value },
    });
    return { requiresSecondApprover: value };
  });
}

// ---------------------------------------------------------------------------
// Simulator (administrators, before activation)
// ---------------------------------------------------------------------------
export const simulateSchema = z.object({
  planId: z.string().uuid().optional().nullable(),
  plan: planInputSchema.optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  /** Required for ₹-per-sq-yd plans. */
  areaSqYards: z.coerce.number().positive().max(1_000_000).optional().nullable(),
  /** Sale value (net amount) — required for percentage plans. */
  saleValue: z.coerce.number().positive().max(100_000_000_000).optional().nullable(),
  // Hypothetical chain (levels only) when no real employee is chosen.
  hypotheticalLevels: z.array(z.number().int().min(1).max(MAX_LEVELS).nullable()).max(16).optional(),
});

export async function simulate(ctx: AuthContext, input: z.input<typeof simulateSchema>) {
  assertPermission(ctx, "commission.plan_manage");
  const parsed = simulateSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Invalid simulation", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const s = parsed.data;
  const q = await db();
  let plan: CommissionPlanInput;
  if (s.plan) {
    const p = normalizePlan(s.plan);
    plan = {
      id: "simulation", version: 0, method: p.calculationMethod, paySellingEmployee: p.paySellingEmployee, ceoSeparateEntitlement: p.ceoSeparateEntitlement,
      maxPayableLevels: p.maxPayableLevels, levelCount: p.levelCount, basis: p.basis, levels: p.levels,
    };
  } else if (s.planId) {
    plan = (await loadPlan(q, ctx.organizationId, s.planId)).input;
  } else throw badRequest("Provide a plan or planId");

  if (plan.basis === "percentage" && !s.saleValue) throw badRequest("Enter a sale value to simulate a percentage-based plan");
  if (plan.basis === "per_sq_yard" && !s.areaSqYards) throw badRequest("Enter an area to simulate a per-sq-yd plan");

  let chain: ChainMember[];
  if (s.employeeId) {
    const { getUplineChain } = await import("./employees");
    chain = await getUplineChain(q, ctx.organizationId, s.employeeId);
    if (chain.length === 0) throw notFound("Employee");
  } else {
    const defaultChain = Array.from({ length: plan.levelCount }, (_, i) => plan.levelCount - i);
    chain = (s.hypotheticalLevels ?? defaultChain).map((lvl, i) => ({
      employeeId: `sim-${i}`, employeeCode: `SIM-${i}`, fullName: i === 0 ? "Selling employee" : `Upline ${i}`,
      commissionLevel: lvl, active: true, commissionEligible: true,
    }));
  }
  const ceo = plan.ceoSeparateEntitlement ? await findCeo(q, ctx.organizationId, chain) : null;
  return calculateCommissions(plan, chain, { areaSqYards: s.areaSqYards ?? 0, baseAmount: s.saleValue ?? null }, ceo);
}

async function findCeo(q: Queryable, orgId: string, chain: ChainMember[]): Promise<ChainMember | null> {
  const inChain = chain.find((m) => m.commissionLevel === 1);
  if (inChain) return inChain;
  const [c] = await q.query<{ id: string; employee_code: string; full_name: string; employment_status: string; commission_eligible: boolean }>(
    "select id, employee_code, full_name, employment_status, commission_eligible from employees where organization_id = $1 and commission_level = 1 and employment_status = 'active' order by created_at limit 1",
    [orgId],
  );
  return c ? { employeeId: c.id, employeeCode: c.employee_code, fullName: c.full_name, commissionLevel: 1, active: true, commissionEligible: c.commission_eligible } : null;
}

// ---------------------------------------------------------------------------
// Ledger: calculation on confirmation, reversal, approval
// ---------------------------------------------------------------------------
export async function calculateCommissionsForBooking(q: Queryable, bookingId: string): Promise<{ created: number; skipped?: string }> {
  const [b] = await q.query<Record<string, unknown>>("select * from bookings where id = $1", [bookingId]);
  if (!b) throw notFound("Booking");
  const orgId = String(b.organization_id);
  const actor: AuditActor = { system: true, organizationId: orgId };
  const skip = async (reason: string) => {
    await writeAudit(q, actor, { action: "commission.skipped", entityType: "booking", entityId: bookingId, summary: reason });
    return { created: 0, skipped: reason };
  };
  if (!["confirmed", "completed"].includes(String(b.status))) return skip("Booking not confirmed");
  if (!b.credited_employee_id) return skip("No credited selling employee");
  const at = new Date((b.confirmed_at as string) ?? Date.now());
  const ventureId = String(b.venture_id);

  // Property type of the sale: the plots' own type (falling back to the venture's);
  // a multi-plot booking that mixes types uses the venture's type.
  const [typeRow] = await q.query<{ venture_type: string; plot_types: string[] | string }>(
    `select v.property_type as venture_type,
            array(select distinct coalesce(p.property_type, v.property_type)
                    from booking_plots bp join plots p on p.id = bp.plot_id where bp.booking_id = $1) as plot_types
       from ventures v where v.id = $2`,
    [bookingId, ventureId],
  );
  const plotTypes = uuidArray(typeRow?.plot_types);
  const propertyType = plotTypes.length === 1 ? plotTypes[0] : String(typeRow?.venture_type ?? "open_plot");

  // Approved plans effective at confirmation time whose scope covers this sale; most specific wins.
  const candidates = await q.query<{ id: string; property_type: string; venture_ids: unknown; effective_from: Date }>(
    `select id, property_type, venture_ids, effective_from from commission_plans
      where organization_id = $1 and status in ('active','superseded')
        and effective_from <= $2 and (effective_to is null or effective_to > $2)
        and (property_type = 'any' or property_type = $3)
        and (cardinality(venture_ids) = 0 or $4::uuid = any(venture_ids))`,
    [orgId, at, propertyType, ventureId],
  );
  const chosen = selectApplicablePlan(
    candidates.map((c) => ({ id: c.id, propertyType: c.property_type, ventureIds: uuidArray(c.venture_ids), effectiveFrom: c.effective_from })),
    { ventureId, propertyType },
  );
  if (!chosen) return skip(`No approved commission plan for this venture / property type (${propertyType}) effective at confirmation time`);
  const { input: plan } = await loadPlan(q, orgId, chosen.id);

  // Hierarchy as captured at booking time (attribution snapshot).
  const snap = b.attribution_snapshot as { chain?: { employee_id: string; employee_code: string; name: string; level: number | null; active: boolean; commission_eligible: boolean }[] } | null;
  const chain: ChainMember[] = (snap?.chain ?? []).map((m) => ({
    employeeId: m.employee_id, employeeCode: m.employee_code, fullName: m.name, commissionLevel: m.level, active: m.active, commissionEligible: m.commission_eligible,
  }));
  if (chain.length === 0) return skip("Attribution snapshot missing");
  const ceo = plan.ceoSeparateEntitlement ? await findCeo(q, orgId, chain) : null;
  const area = num(b.total_area_sq_yards);
  // Sale value for percentage plans: the booking's total net amount (all plots, after discounts).
  const saleValue = num(b.net_amount);
  const result = calculateCommissions(plan, chain, { areaSqYards: area, baseAmount: saleValue }, ceo);
  const pct = plan.basis === "percentage";

  let created = 0;
  for (const l of result.lines) {
    // The amount is computed by the database with the same rounding its check constraint uses.
    const rows = await q.query(
      `insert into commission_entries (organization_id, booking_id, plan_id, plan_version, employee_id, beneficiary_role, chain_depth,
                                       employee_level, basis, level_rate, payable_rate, level_rate_percent, payable_rate_percent, base_amount,
                                       area_sq_yards, amount, hierarchy_snapshot)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::text,$10,$11,$12::numeric,$13::numeric,$14::numeric,$15,
               case when $9::text = 'percentage' then round($14::numeric * $13::numeric / 100, 2) else round($11::numeric * $15::numeric, 2) end,
               $16::jsonb)
       on conflict (booking_id, employee_id, beneficiary_role) where status not in ('rejected','reversed') do nothing
       returning id`,
      [
        orgId, bookingId, plan.id, plan.version, l.employeeId, l.beneficiaryRole, l.chainDepth, l.employeeLevel, plan.basis,
        pct ? 0 : l.levelRate, pct ? 0 : l.payableRate, pct ? l.levelRate : null, pct ? l.payableRate : null, saleValue, area,
        // Privacy: only the beneficiary's own position and the value already paid below — never upline details.
        {
          plan_version: plan.version, method: plan.method, basis: plan.basis, level_count: plan.levelCount, property_type: propertyType,
          chain_depth: l.chainDepth, baseline_rate_below: l.baselineRate, seller_employee_code: chain[0].employeeCode,
        },
      ],
    );
    created += rows.length;
  }
  await writeAudit(q, actor, {
    action: "commission.calculated", entityType: "booking", entityId: bookingId,
    summary: `${created} commission entr${created === 1 ? "y" : "ies"} calculated with plan v${plan.version} (${plan.basis === "percentage" ? "% of sale value" : "per sq yd"}, ${propertyType})`,
    metadata: { decisions: result.decisions, total: result.totalAmount, planId: plan.id, basis: plan.basis, propertyType },
  });
  if (created > 0) {
    await enqueueOutboundEvent(q, {
      organizationId: orgId, eventType: "commission.calculated", aggregateType: "booking", aggregateId: bookingId,
      idempotencyKey: `commission.calculated:${bookingId}:${plan.version}:${String(b.credited_employee_id)}`,
      data: {
        booking_id: bookingId, booking_number: b.booking_number, plan_version: plan.version, basis: plan.basis, total_amount: result.totalAmount,
        entries: result.lines.map((l) => ({
          employee_code: l.employeeCode, role: l.beneficiaryRole, level: l.employeeLevel, amount: l.amount,
          ...(pct ? { rate_percent: l.payableRate, sale_value: saleValue } : { rate_per_sq_yard: l.payableRate, area_sq_yards: area }),
        })),
      },
    });
  }
  return { created };
}

export async function reverseOpenCommissionsForBooking(q: Queryable, ctx: AuthContext, bookingId: string, reason: string) {
  const reversed = await q.query<{ id: string }>(
    "update commission_entries set status = 'reversed', reversed_reason = $2 where booking_id = $1 and status in ('calculated','approved') returning id",
    [bookingId, reason],
  );
  const [locked] = await q.query<{ n: number }>("select count(*)::int as n from commission_entries where booking_id = $1 and status in ('settled','paid')", [bookingId]);
  if (reversed.length) {
    await writeAudit(q, ctx, { action: "commission.reversed", entityType: "booking", entityId: bookingId, summary: `${reversed.length} entries reversed: ${reason}` });
  }
  if (locked && locked.n > 0) {
    await writeAudit(q, ctx, {
      action: "commission.clawback_review_required", entityType: "booking", entityId: bookingId,
      summary: `${locked.n} settled/paid commission entries exist; finance review required (${reason})`,
    });
  }
}

/** Ledger visibility: own entries; descendants' entries; whole org only with commission.approve. Never an upline's. */
export async function listEntries(ctx: AuthContext, f: { scope?: "mine" | "team" | "all"; status?: string; settlementId?: string } = {}) {
  assertStaff(ctx);
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["ce.organization_id = $1"];
  const scope = f.scope ?? "mine";
  if (scope === "all") {
    if (!can(ctx, "commission.approve")) throw forbidden();
  } else if (scope === "team") {
    const ids = can(ctx, "commission.approve") && ctx.employee === null ? null : ctx.employee ? await networkOf(q, ctx) : [];
    if (ids !== null) {
      params.push(ids);
      where.push(`ce.employee_id = any($${params.length}::uuid[])`);
    }
    // Team = descendants only (own entries live under "mine"); never an upline.
    if (ctx.employee) {
      params.push(ctx.employee.id);
      where.push(`ce.employee_id <> $${params.length}`);
    }
  } else {
    params.push(ctx.employee?.id ?? null);
    where.push(`ce.employee_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`ce.status = $${params.length}`);
  }
  if (f.settlementId) {
    if (!can(ctx, "commission.approve")) throw forbidden();
    params.push(f.settlementId);
    where.push(`ce.settlement_id = $${params.length}`);
  }
  return q.query<Record<string, unknown>>(
    `select ce.id, ce.booking_id, b.booking_number, ce.employee_id, e.employee_code, e.full_name, ce.beneficiary_role, ce.chain_depth,
            ce.employee_level, ce.level_rate, ce.payable_rate, ce.area_sq_yards, ce.amount, ce.status, ce.plan_version, ce.settlement_id,
            ce.basis, ce.payable_rate_percent, ce.base_amount,
            s.reference as settlement_reference, ce.created_at, ce.approved_at, ce.paid_at, b.confirmed_at,
            array(select bp.plot_number from booking_plots bp where bp.booking_id = b.id order by bp.plot_number) as plot_numbers
       from commission_entries ce join bookings b on b.id = ce.booking_id join employees e on e.id = ce.employee_id
       left join commission_settlements s on s.id = ce.settlement_id
      where ${where.join(" and ")} order by ce.created_at desc limit 1000`,
    params,
  );
}

async function networkOf(q: Queryable, ctx: AuthContext): Promise<string[]> {
  if (!ctx.employee) return [];
  const { loadNetworkIds } = await import("@/lib/auth/context");
  return loadNetworkIds(q, ctx.organizationId, ctx.employee.id);
}

export async function commissionSummary(ctx: AuthContext) {
  assertStaff(ctx);
  const q = await db();
  if (!ctx.employee) return { pending: 0, approved: 0, settled: 0, paid: 0 };
  const rows = await q.query<{ status: string; total: string }>(
    "select status, coalesce(sum(amount),0) as total from commission_entries where organization_id = $1 and employee_id = $2 group by status",
    [ctx.organizationId, ctx.employee.id],
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, num(r.total)]));
  return { pending: by.calculated ?? 0, approved: by.approved ?? 0, settled: by.settled ?? 0, paid: by.paid ?? 0 };
}

export async function decideEntries(ctx: AuthContext, ids: string[], action: "approve" | "reject", reason?: string) {
  assertPermission(ctx, "commission.approve");
  if (ids.length === 0) throw badRequest("No entries selected");
  if (action === "reject" && (!reason || reason.trim().length < 5)) throw badRequest("A rejection reason is required");
  return withTx(async (q) => {
    const rows = await q.query<{ id: string; booking_id: string; employee_id: string; status: string; amount: string; booking_status: string; user_id: string | null; booking_number: string }>(
      `select ce.id, ce.booking_id, ce.employee_id, ce.status, ce.amount, b.status as booking_status, e.user_id, b.booking_number
         from commission_entries ce join bookings b on b.id = ce.booking_id join employees e on e.id = ce.employee_id
        where ce.organization_id = $1 and ce.id = any($2::uuid[]) for update of ce`,
      [ctx.organizationId, ids],
    );
    if (rows.length !== new Set(ids).size) throw notFound("Commission entry");
    for (const r of rows) {
      if (r.status !== "calculated") throw conflict(`Entry is ${r.status}`);
      if (ctx.employee && r.employee_id === ctx.employee.id) throw forbidden("You cannot approve your own commission");
      if (action === "approve") {
        // Eligibility re-check: booking still confirmed/completed and advance verified.
        if (!["confirmed", "completed"].includes(r.booking_status)) throw conflict(`Booking ${r.booking_number} is ${r.booking_status}`);
      }
    }
    await q.query(
      action === "approve"
        ? "update commission_entries set status = 'approved', approved_by = $2, approved_at = now() where id = any($1::uuid[])"
        : "update commission_entries set status = 'rejected', rejected_reason = $3, approved_by = $2 where id = any($1::uuid[])",
      action === "approve" ? [ids, ctx.user.id] : [ids, ctx.user.id, reason],
    );
    if (action === "approve") {
      const bookingIds = [...new Set(rows.map((r) => r.booking_id))];
      await q.query("update bookings set attribution_locked = true where id = any($1::uuid[])", [bookingIds]);
      for (const r of rows) {
        if (r.user_id) {
          await createNotification(q, {
            organizationId: ctx.organizationId, recipientUserId: r.user_id, type: "commission_update",
            title: "Commission approved", body: `Your commission of ₹${num(r.amount).toLocaleString("en-IN")} for booking ${r.booking_number} was approved.`,
            bookingId: r.booking_id, bookingNumber: r.booking_number, link: "/commissions", dedupeKey: `commission.approved:${r.id}`,
          });
        }
      }
      await enqueueOutboundEvent(q, {
        organizationId: ctx.organizationId, eventType: "commission.approved", aggregateType: "commission_batch", aggregateId: null,
        idempotencyKey: `commission.approved:${[...ids].sort().join(",")}`.slice(0, 500),
        data: { entry_ids: ids, booking_ids: bookingIds, total_amount: rows.reduce((s, r) => s + num(r.amount), 0) },
      });
    }
    await writeAudit(q, ctx, { action: `commission.${action}d`, entityType: "commission_entry", summary: `${rows.length} entries ${action}d`, metadata: { ids, reason } });
    return { count: rows.length };
  });
}

// ---------------------------------------------------------------------------
// Settlements (weekly / monthly) & finance
// ---------------------------------------------------------------------------
export function periodBounds(periodType: "weekly" | "monthly", start: string): { start: string; end: string } {
  const d = new Date(start + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw badRequest("Invalid period start");
  if (periodType === "weekly") {
    if (d.getUTCDay() !== 1) throw badRequest("Weekly periods start on a Monday");
    const end = new Date(d.getTime() + 6 * 86400000);
    return { start, end: end.toISOString().slice(0, 10) };
  }
  if (d.getUTCDate() !== 1) throw badRequest("Monthly periods start on the 1st");
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start, end: end.toISOString().slice(0, 10) };
}

export const settlementCreateSchema = z.object({
  periodType: z.enum(["weekly", "monthly"]),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createSettlement(ctx: AuthContext, input: z.infer<typeof settlementCreateSchema>) {
  assertPermission(ctx, "commission.settle");
  const { start, end } = periodBounds(input.periodType, input.periodStart);
  return withTx(async (q) => {
    const entries = await q.query<{ id: string; amount: string }>(
      `select ce.id, ce.amount from commission_entries ce join bookings b on b.id = ce.booking_id
        where ce.organization_id = $1 and ce.status = 'approved' and ce.settlement_id is null
          and b.status in ('confirmed','completed')
          and (b.confirmed_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
        for update of ce`,
      [ctx.organizationId, start, end],
    );
    if (entries.length === 0) throw unprocessable("No approved, unsettled commission entries in this period");
    const total = Math.round(entries.reduce((s, e) => s + num(e.amount), 0) * 100) / 100;
    const reference = `CS-${input.periodType === "weekly" ? "W" : "M"}-${start}-${randomUUID().slice(0, 4).toUpperCase()}`;
    let settlement: { id: string };
    try {
      [settlement] = await q.query<{ id: string }>(
        `insert into commission_settlements (organization_id, reference, period_type, period_start, period_end, total_amount, entry_count, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [ctx.organizationId, reference, input.periodType, start, end, total, entries.length, ctx.user.id],
      );
    } catch (e) {
      if (isPgError(e, "23505")) throw conflict("A settlement for this period already exists");
      throw e;
    }
    await q.query("update commission_entries set status = 'settled', settlement_id = $2 where id = any($1::uuid[])", [entries.map((e) => e.id), settlement.id]);
    await writeAudit(q, ctx, { action: "settlement.created", entityType: "commission_settlement", entityId: settlement.id, summary: `${reference}: ${entries.length} entries, ${total}` });
    return { id: settlement.id, reference, total, entryCount: entries.length };
  });
}

export async function listSettlements(ctx: AuthContext) {
  assertPermission(ctx, "commission.approve");
  const q = await db();
  return q.query<Record<string, unknown>>(
    `select s.*, to_char(s.period_start, 'YYYY-MM-DD') as period_start_text, to_char(s.period_end, 'YYYY-MM-DD') as period_end_text,
            cu.full_name as created_by_name, au.full_name as approved_by_name, pu.full_name as paid_confirmed_by_name,
            (select json_agg(json_build_object('id', r.id, 'status', r.status, 'source', r.source, 'reported_amount', r.reported_amount,
                     'external_reference', r.external_reference, 'received_at', r.received_at) order by r.received_at desc)
               from finance_reconciliations r where r.settlement_id = s.id) as reconciliations
       from commission_settlements s left join app_users cu on cu.id = s.created_by left join app_users au on au.id = s.approved_by
       left join app_users pu on pu.id = s.paid_confirmed_by
      where s.organization_id = $1 order by s.period_start desc, s.created_at desc`,
    [ctx.organizationId],
  );
}

type SettlementAction = "submit" | "approve" | "request_finance" | "cancel";

export async function settlementAction(ctx: AuthContext, id: string, action: SettlementAction, note?: string) {
  if (action === "approve") assertPermission(ctx, "commission.approve");
  else assertPermission(ctx, "commission.settle");
  return withTx(async (q) => {
    const [s] = await q.query<Record<string, unknown>>("select * from commission_settlements where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
    if (!s) throw notFound("Settlement");
    const st = String(s.status);
    if (action === "submit") {
      if (st !== "draft") throw conflict(`Settlement is ${st}`);
      await q.query("update commission_settlements set status = 'submitted', submitted_by = $2, submitted_at = now() where id = $1", [id, ctx.user.id]);
    } else if (action === "approve") {
      if (st !== "submitted") throw conflict(`Settlement is ${st}`);
      if (s.submitted_by === ctx.user.id || s.created_by === ctx.user.id) throw forbidden("Settlement must be approved by someone other than its creator/submitter");
      await q.query("update commission_settlements set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [id, ctx.user.id]);
    } else if (action === "request_finance") {
      if (st !== "approved") throw conflict(`Settlement is ${st}`);
      await q.query("update commission_settlements set status = 'finance_requested', finance_requested_at = now() where id = $1", [id]);
      const lines = await q.query<{ employee_code: string; full_name: string; total: string; entries: number }>(
        `select e.employee_code, e.full_name, sum(ce.amount) as total, count(*)::int as entries
           from commission_entries ce join employees e on e.id = ce.employee_id where ce.settlement_id = $1
          group by e.employee_code, e.full_name order by e.employee_code`,
        [id],
      );
      await enqueueOutboundEvent(q, {
        organizationId: ctx.organizationId, eventType: "commission.finance_requested", aggregateType: "commission_settlement", aggregateId: id,
        idempotencyKey: `commission.finance_requested:${id}`,
        data: {
          settlement_id: id, reference: s.reference, period_type: s.period_type, period_start: s.period_start, period_end: s.period_end,
          total_amount: num(s.total_amount), currency: "INR",
          payees: lines.map((l) => ({ employee_code: l.employee_code, name: l.full_name, amount: num(l.total), entries: l.entries })),
        },
      });
    } else if (action === "cancel") {
      if (!["draft", "submitted", "approved"].includes(st)) throw conflict(`Settlement is ${st}`);
      await q.query("update commission_entries set status = 'approved', settlement_id = null where settlement_id = $1 and status = 'settled'", [id]);
      await q.query("update commission_settlements set status = 'cancelled', cancelled_reason = $2 where id = $1", [id, note ?? "Cancelled"]);
    }
    await writeAudit(q, ctx, { action: `settlement.${action}`, entityType: "commission_settlement", entityId: id, summary: note });
    return { ok: true };
  });
}

/** Marks a settlement paid. Requires an authorized human confirmation — a delivered webhook is never enough. */
async function markSettlementPaid(q: Queryable, ctx: AuthContext, s: Record<string, unknown>, source: "authorized_confirmation" | "finance_reconciliation", reference: string) {
  await q.query(
    `update commission_settlements set status = 'paid', payment_confirmation_source = $2, payment_reference = $3, paid_confirmed_by = $4, paid_at = now()
      where id = $1`,
    [s.id, source, reference, ctx.user.id],
  );
  const paid = await q.query<{ id: string; user_id: string | null; amount: string }>(
    `update commission_entries ce set status = 'paid', paid_at = now() from employees e
      where ce.settlement_id = $1 and ce.status = 'settled' and e.id = ce.employee_id returning ce.id, e.user_id, ce.amount`,
    [s.id],
  );
  const byUser = new Map<string, number>();
  for (const p of paid) if (p.user_id) byUser.set(p.user_id, (byUser.get(p.user_id) ?? 0) + num(p.amount));
  for (const [userId, amount] of byUser) {
    await createNotification(q, {
      organizationId: ctx.organizationId, recipientUserId: userId, type: "commission_update", title: "Commission paid",
      body: `Commission of ₹${amount.toLocaleString("en-IN")} in settlement ${s.reference} was confirmed as paid.`,
      link: "/commissions", dedupeKey: `settlement.paid:${s.id}:${userId}`,
    });
  }
  await writeAudit(q, ctx, { action: "settlement.paid", entityType: "commission_settlement", entityId: String(s.id), summary: `Paid via ${source} (${reference})` });
  await enqueueOutboundEvent(q, {
    organizationId: ctx.organizationId, eventType: "commission.payment_confirmed", aggregateType: "commission_settlement", aggregateId: String(s.id),
    idempotencyKey: `commission.payment_confirmed:${s.id}`,
    data: { settlement_id: s.id, reference: s.reference, total_amount: num(s.total_amount), confirmation_source: source, payment_reference: reference },
  });
}

export async function confirmSettlementPayment(ctx: AuthContext, id: string, paymentReference: string) {
  assertPermission(ctx, "commission.settle");
  assertPermission(ctx, "commission.approve");
  if (!paymentReference || paymentReference.trim().length < 3) throw badRequest("Payment reference is required");
  return withTx(async (q) => {
    const [s] = await q.query<Record<string, unknown>>("select * from commission_settlements where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
    if (!s) throw notFound("Settlement");
    if (s.status !== "finance_requested" && s.status !== "approved") throw conflict(`Settlement is ${s.status}`);
    await markSettlementPaid(q, ctx, s, "authorized_confirmation", paymentReference.trim());
    return { ok: true };
  });
}

export async function recordReconciliation(
  q: Queryable,
  args: { organizationId: string; settlementId: string; source: "manual" | "uniklife_webhook"; externalReference: string | null; reportedAmount: number; details?: unknown; webhookEventId?: string | null },
) {
  const [s] = await q.query<{ total_amount: string; status: string }>("select total_amount, status from commission_settlements where organization_id = $1 and id = $2", [args.organizationId, args.settlementId]);
  if (!s) throw notFound("Settlement");
  const matched = Math.round(num(s.total_amount) * 100) === Math.round(args.reportedAmount * 100);
  const [r] = await q.query<{ id: string }>(
    `insert into finance_reconciliations (organization_id, settlement_id, source, external_reference, reported_amount, status, details, webhook_event_id)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) returning id`,
    [args.organizationId, args.settlementId, args.source, args.externalReference, args.reportedAmount, matched ? "matched" : "mismatch", args.details ?? {}, args.webhookEventId ?? null],
  );
  return { id: r.id, matched };
}

export async function addManualReconciliation(ctx: AuthContext, settlementId: string, input: { externalReference: string; reportedAmount: number }) {
  assertPermission(ctx, "commission.settle");
  return withTx(async (q) => {
    const r = await recordReconciliation(q, { organizationId: ctx.organizationId, settlementId, source: "manual", externalReference: input.externalReference, reportedAmount: input.reportedAmount });
    await writeAudit(q, ctx, { action: "reconciliation.recorded", entityType: "commission_settlement", entityId: settlementId, metadata: { ...input, matched: r.matched } });
    return r;
  });
}

/** Accepting a MATCHED reconciliation (by an authorized human) marks the settlement paid. */
export async function reviewReconciliation(ctx: AuthContext, reconciliationId: string, decision: "accept" | "reject", note?: string) {
  assertPermission(ctx, "commission.settle");
  assertPermission(ctx, "commission.approve");
  return withTx(async (q) => {
    const [r] = await q.query<Record<string, unknown>>("select * from finance_reconciliations where organization_id = $1 and id = $2 for update", [ctx.organizationId, reconciliationId]);
    if (!r) throw notFound("Reconciliation");
    if (!["matched", "mismatch", "received"].includes(String(r.status))) throw conflict(`Reconciliation is ${r.status}`);
    if (decision === "accept" && r.status !== "matched") throw unprocessable("Only a reconciliation whose amount matches the settlement total can be accepted");
    await q.query("update finance_reconciliations set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 where id = $1",
      [reconciliationId, decision === "accept" ? "accepted" : "rejected", ctx.user.id, note ?? null]);
    if (decision === "accept") {
      const [s] = await q.query<Record<string, unknown>>("select * from commission_settlements where id = $1 for update", [r.settlement_id]);
      if (s.status !== "finance_requested" && s.status !== "approved") throw conflict(`Settlement is ${s.status}`);
      await markSettlementPaid(q, ctx, s, "finance_reconciliation", String(r.external_reference ?? reconciliationId));
    }
    await writeAudit(q, ctx, { action: `reconciliation.${decision}ed`, entityType: "finance_reconciliation", entityId: reconciliationId, summary: note });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// XLSX reports
// ---------------------------------------------------------------------------
function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F5C" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** Shared ledger columns describing how an entry was calculated (₹/sq yd or % of sale value). */
const BASIS_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Basis", key: "basis_label", width: 16 },
  { header: "Rate / sq yd (INR)", key: "payable_rate", width: 16, style: { numFmt: "#,##0.00" } },
  { header: "Area (sq yd)", key: "area_sq_yards", width: 12 },
  { header: "Rate (% of sale value)", key: "payable_rate_percent", width: 18, style: { numFmt: "0.0000" } },
  { header: "Sale value (INR)", key: "base_amount", width: 18, style: { numFmt: "#,##0.00" } },
];

function basisCells(e: Record<string, unknown>) {
  const pct = e.basis === "percentage";
  return {
    basis_label: pct ? "% of sale value" : "Per sq yd",
    payable_rate: pct ? null : num(e.payable_rate),
    area_sq_yards: num(e.area_sq_yards),
    payable_rate_percent: pct ? num(e.payable_rate_percent) : null,
    base_amount: pct ? num(e.base_amount) : null,
  };
}

export async function settlementWorkbook(ctx: AuthContext, settlementId: string): Promise<{ buffer: Buffer; filename: string }> {
  assertPermission(ctx, "commission.approve");
  const q = await db();
  const [s] = await q.query<Record<string, unknown>>("select * from commission_settlements where organization_id = $1 and id = $2", [ctx.organizationId, settlementId]);
  if (!s) throw notFound("Settlement");
  const entries = await listEntries(ctx, { scope: "all", settlementId });
  const wb = new ExcelJS.Workbook();
  wb.creator = "UNIKLIFE 3D Venture";
  wb.created = new Date();
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ header: "Field", key: "k", width: 28 }, { header: "Value", key: "v", width: 40 }];
  styleHeader(sum);
  for (const [k, v] of [
    ["Organization", ctx.organizationName], ["Settlement reference", s.reference], ["Period", `${s.period_type} ${String(s.period_start).slice(0, 10)} → ${String(s.period_end).slice(0, 10)}`],
    ["Status", s.status], ["Entries", s.entry_count], ["Total amount (INR)", num(s.total_amount)],
    ["Payment confirmation", s.payment_confirmation_source ?? "not confirmed"], ["Payment reference", s.payment_reference ?? ""],
    ["Generated at", new Date().toISOString()],
  ] as [string, unknown][]) sum.addRow({ k, v });

  const by = wb.addWorksheet("By employee");
  by.columns = [
    { header: "Employee ID", key: "code", width: 14 }, { header: "Name", key: "name", width: 28 },
    { header: "Entries", key: "n", width: 10 }, { header: "Amount (INR)", key: "amt", width: 16, style: { numFmt: "#,##0.00" } },
  ];
  styleHeader(by);
  const agg = new Map<string, { name: string; n: number; amt: number }>();
  for (const e of entries) {
    const k = String(e.employee_code);
    const a = agg.get(k) ?? { name: String(e.full_name), n: 0, amt: 0 };
    a.n++;
    a.amt += num(e.amount);
    agg.set(k, a);
  }
  for (const [code, a] of agg) by.addRow({ code, name: a.name, n: a.n, amt: Math.round(a.amt * 100) / 100 });

  const det = wb.addWorksheet("Entries");
  det.columns = [
    { header: "Booking", key: "booking_number", width: 18 }, { header: "Plots", key: "plots", width: 18 },
    { header: "Employee ID", key: "employee_code", width: 14 }, { header: "Name", key: "full_name", width: 24 },
    { header: "Role", key: "beneficiary_role", width: 14 }, { header: "Level", key: "employee_level", width: 8 },
    ...BASIS_COLUMNS,
    { header: "Amount (INR)", key: "amount", width: 16, style: { numFmt: "#,##0.00" } }, { header: "Plan version", key: "plan_version", width: 12 },
    { header: "Status", key: "status", width: 12 },
  ];
  styleHeader(det);
  for (const e of entries) {
    det.addRow({ ...e, plots: (e.plot_numbers as string[]).join(", "), ...basisCells(e), amount: num(e.amount) });
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${s.reference}.xlsx` };
}

/** Personal commission statement — only the caller's own entries (or a descendant's for managers). */
export async function statementWorkbook(ctx: AuthContext, opts: { employeeId?: string; from?: string; to?: string }) {
  assertStaff(ctx);
  const q = await db();
  const employeeId = opts.employeeId ?? ctx.employee?.id;
  if (!employeeId) throw badRequest("No employee record linked to your account");
  if (employeeId !== ctx.employee?.id && !can(ctx, "commission.approve")) {
    const net = await networkOf(q, ctx);
    if (!net.includes(employeeId)) throw notFound("Employee");
  }
  if (!inNetwork(ctx, employeeId) && !can(ctx, "commission.approve") && employeeId !== ctx.employee?.id) throw notFound("Employee");
  const [emp] = await q.query<{ employee_code: string; full_name: string }>("select employee_code, full_name from employees where id = $1 and organization_id = $2", [employeeId, ctx.organizationId]);
  if (!emp) throw notFound("Employee");
  const rows = await q.query<Record<string, unknown>>(
    `select b.booking_number, ce.beneficiary_role, ce.employee_level, ce.payable_rate, ce.area_sq_yards, ce.amount, ce.status, ce.created_at, ce.paid_at,
            ce.basis, ce.payable_rate_percent, ce.base_amount, ce.plan_version,
            array(select bp.plot_number from booking_plots bp where bp.booking_id = b.id order by bp.plot_number) as plot_numbers
       from commission_entries ce join bookings b on b.id = ce.booking_id
      where ce.organization_id = $1 and ce.employee_id = $2
        and ($3::date is null or ce.created_at::date >= $3::date) and ($4::date is null or ce.created_at::date <= $4::date)
      order by ce.created_at`,
    [ctx.organizationId, employeeId, opts.from ?? null, opts.to ?? null],
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Statement");
  ws.columns = [
    { header: "Date", key: "date", width: 12 }, { header: "Booking", key: "booking_number", width: 18 }, { header: "Plots", key: "plots", width: 18 },
    { header: "Role", key: "beneficiary_role", width: 12 }, { header: "Level", key: "employee_level", width: 8 },
    ...BASIS_COLUMNS,
    { header: "Amount (INR)", key: "amount", width: 16, style: { numFmt: "#,##0.00" } },
    { header: "Plan version", key: "plan_version", width: 12 }, { header: "Status", key: "status", width: 12 },
  ];
  styleHeader(ws);
  for (const r of rows) {
    ws.addRow({
      ...r, date: new Date(r.created_at as string).toISOString().slice(0, 10), plots: (r.plot_numbers as string[]).join(", "),
      ...basisCells(r), amount: num(r.amount),
    });
  }
  ws.addRow({});
  ws.addRow({ booking_number: "Total", amount: Math.round(rows.reduce((s, r) => s + num(r.amount), 0) * 100) / 100 }).font = { bold: true };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `commission-statement-${emp.employee_code}.xlsx` };
}

export type { PlanLevel };
