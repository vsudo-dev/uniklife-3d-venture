import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { createTestDb, ctxFor, demoVenture, key, plotIds } from "../support/db";
import { placeHold, requestBooking } from "@/lib/services/bookings";
import { initiatePayment, simulateMockGateway } from "@/lib/services/payments";
import {
  addManualReconciliation, approvePlan, commissionSummary, createPlanDraft, createSettlement, decideEntries, getPlan, listEntries,
  listPlans, listSettlements, recordReconciliation, rejectPlan, reviewReconciliation, settlementAction, settlementWorkbook, simulate,
  statementWorkbook, submitPlan, updatePlanDraft, type PlanInput,
  createVersionFromPlan, getCommissionSettings, updateCommissionSettings,
} from "@/lib/services/commissions";
import { getMyNetwork } from "@/lib/services/employees";
import { DEFAULT_LEVELS } from "@/lib/commissions/engine";

let db: Database;
let ventureId: string;
let ceo: AuthContext, platform: AuthContext, anil: AuthContext, vikram: AuthContext, lakshmi: AuthContext, priya: AuthContext, deepa: AuthContext;
const emp: Record<string, string> = {};

/** Creates and confirms a booking credited to `seller` (hold → request → mock gateway success). */
async function confirmedBooking(seller: AuthContext, plots: string[]): Promise<string> {
  const ids = await plotIds(db, ventureId, plots);
  const hold = await placeHold(seller, { plotIds: ids, customer: { fullName: "Commission Buyer", phone: "+919812300000" }, idempotencyKey: key("hold") });
  const { bookingId } = await requestBooking(seller, { holdGroupId: hold.holdGroupId, discountRefs: [], idempotencyKey: key("bk") });
  const t = await initiatePayment(seller, bookingId, key("pay"));
  await simulateMockGateway(seller, t.transactionId, "success");
  const [b] = await db.query<{ status: string }>("select status from bookings where id = $1", [bookingId]);
  expect(b.status).toBe("confirmed");
  return bookingId;
}

const entriesOf = (bookingId: string) =>
  db.query<{ id: string; employee_id: string; plan_version: number; payable_rate: string; amount: string; status: string; employee_level: number }>(
    "select id, employee_id, plan_version, payable_rate, amount, status, employee_level from commission_entries where booking_id = $1 order by employee_level desc",
    [bookingId],
  );

/** First day of the current month in India (settlements group by IST confirmation date). */
const istMonthStart = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7) + "-01";

let bookingV1: string;

beforeAll(async () => {
  db = await createTestDb();
  ventureId = (await demoVenture(db)).id;
  [ceo, platform, anil, vikram, lakshmi, priya, deepa] = await Promise.all(
    ["ceo", "platform", "anil", "vikram", "lakshmi", "priya", "deepa"].map((n) => ctxFor(db, n === "platform" ? "platform@uniklife.local" : `${n}@demo.local`)),
  );
  for (const c of [ceo, anil, vikram, lakshmi, priya, deepa]) emp[c.user.email.split("@")[0]] = c.employee!.id;
  bookingV1 = await confirmedBooking(anil, ["30"]);
});

describe("commission calculation on confirmation", () => {
  it("creates one entry per level for Anil's full chain under plan v1 (differential)", async () => {
    const rows = await entriesOf(bookingV1);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.plan_version === 1 && r.status === "calculated")).toBe(true);
    expect(rows.map((r) => Number(r.payable_rate))).toEqual([400, 400, 200, 200, 200, 200, 200, 200]);
  });
});

describe("seeded plans", () => {
  it("has an org-wide 8-level per-sq-yd plan and a villa-plot 5-level percentage plan", async () => {
    const plans = await listPlans(ceo);
    const p1 = plans.find((p) => Number(p.version) === 1)!;
    const p2 = plans.find((p) => Number(p.version) === 2)!;
    expect(p1).toMatchObject({ status: "active", level_count: 8, basis: "per_sq_yard", property_type: "any", venture_ids: [] });
    expect(p2).toMatchObject({ status: "active", level_count: 5, basis: "percentage", property_type: "villa_plot", venture_ids: [] });
    expect((p2.levels as { rate: string }[]).map((l) => Number(l.rate))).toEqual([2, 1.5, 1, 0.75, 0.5]);
  });
});

describe("plan versioning", () => {
  let v2: string;
  let v2Version: number;
  const v2Input = (): PlanInput => ({
    name: "Standard 8-level plan v2", calculationMethod: "differential", paySellingEmployee: true, ceoSeparateEntitlement: false, maxPayableLevels: 8, notes: "L8 raised",
    levelCount: 8, basis: "per_sq_yard", propertyType: "any", ventureIds: [],
    levels: DEFAULT_LEVELS.map((l) => ({ ...l, eligible: true, rate: l.level === 8 ? 500 : l.rate })),
  });

  it("creates a draft copied from the latest organization-wide version", async () => {
    const r = await createPlanDraft(ceo);
    expect(r.version).toBe(3);
    v2 = r.id;
    v2Version = r.version;
    const p = await getPlan(ceo, v2);
    expect(p.plan.status).toBe("draft");
    expect(p).toMatchObject({ levelCount: 8, basis: "per_sq_yard" });
    expect(p.plan).toMatchObject({ property_type: "any", venture_ids: [] });
    expect(p.levels.map((l) => l.rate)).toEqual([2000, 1800, 1600, 1400, 1200, 1000, 800, 400]);
  });

  it("rejects non-descending rates on save", async () => {
    const bad = v2Input();
    bad.levels[7].rate = 800;
    await expect(updatePlanDraft(ceo, v2, bad)).rejects.toMatchObject({ status: 400 });
  });

  it("only plan managers can see or edit plans", async () => {
    await expect(listPlans(lakshmi)).rejects.toMatchObject({ status: 403 });
    await expect(simulate(anil, { planId: v2, areaSqYards: 100 })).rejects.toMatchObject({ status: 403 });
  });

  it("simulates the draft before activation", async () => {
    await updatePlanDraft(ceo, v2, v2Input());
    const r = await simulate(ceo, { planId: v2, employeeId: emp.anil, areaSqYards: 100 });
    expect(r.lines).toHaveLength(8);
    expect(r.lines[0]).toMatchObject({ employeeCode: "EMP-00125", payableRate: 500 });
    expect(r.totalAmount).toBe(200_000);
  });

  it("submitter cannot approve their own submission; platform admin approves; only the same-scope v1 is superseded", async () => {
    await submitPlan(ceo, v2, "Raise seventh line");
    await expect(approvePlan(ceo, v2)).rejects.toMatchObject({ status: 403 });
    await expect(approvePlan(platform, v2, { effectiveFrom: new Date(Date.now() - 86400_000).toISOString() })).rejects.toMatchObject({ status: 400 });
    const res = await approvePlan(platform, v2, { note: "OK" });
    expect(res.ok).toBe(true);

    const plans = await listPlans(ceo);
    const p1 = plans.find((p) => Number(p.version) === 1)!;
    const villa = plans.find((p) => Number(p.version) === 2)!;
    const p2 = plans.find((p) => Number(p.version) === v2Version)!;
    expect(res.supersededPlanId).toBe(p1.id);
    expect(p1.status).toBe("superseded");
    expect(p1.effective_to).toBeTruthy();
    expect(new Date(p1.effective_to as string).toISOString()).toBe(res.effectiveFrom);
    expect(p2.status).toBe("active");
    expect(p2.effective_to).toBeNull();
    // A different scope (villa plots) is untouched.
    expect(villa.status).toBe("active");
    expect(villa.effective_to).toBeNull();
    const history = (await getPlan(ceo, v2)).approvals.map((a) => a.action);
    expect(history).toEqual(expect.arrayContaining(["created", "updated", "submitted", "approved"]));
  });

  it("approved plans are immutable (service and database)", async () => {
    await expect(updatePlanDraft(ceo, v2, v2Input())).rejects.toMatchObject({ status: 409 });
    const p1 = (await listPlans(ceo)).find((p) => Number(p.version) === 1)!;
    await expect(db.query("update commission_plan_levels set rate_per_sq_yard = 450 where plan_id = $1 and level = 8", [p1.id])).rejects.toThrow(/cannot be modified/);
    await expect(db.query("update commission_plans set calculation_method = 'full_rate' where id = $1", [v2])).rejects.toThrow(/immutable/);
  });

  it("v1 ledger entries are untouched; new confirmations use v2", async () => {
    const old = await entriesOf(bookingV1);
    expect(old.every((r) => r.plan_version === 1)).toBe(true);
    expect(Number(old[0].payable_rate)).toBe(400);
    const b2 = await confirmedBooking(anil, ["31"]);
    const fresh = await entriesOf(b2);
    expect(fresh.every((r) => r.plan_version === v2Version)).toBe(true);
    expect(Number(fresh[0].payable_rate)).toBe(500);
  });

  it("a pending plan can be rejected with a reason", async () => {
    const v3 = await createPlanDraft(ceo);
    await submitPlan(ceo, v3.id);
    await rejectPlan(platform, v3.id, "Not this quarter");
    const p = await getPlan(ceo, v3.id);
    expect(p.plan.status).toBe("rejected");
    await expect(submitPlan(ceo, v3.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("ledger privacy", () => {
  it("Anil sees only his own entries and never an upline's", async () => {
    const mine = await listEntries(anil, { scope: "mine" });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.employee_id === emp.anil)).toBe(true);
    const team = await listEntries(anil, { scope: "team" });
    expect(team).toHaveLength(0);
    expect(team.some((e) => e.employee_id === emp.vikram)).toBe(false);
    await expect(listEntries(anil, { scope: "all" })).rejects.toMatchObject({ status: 403 });
    await expect(statementWorkbook(anil, { employeeId: emp.vikram })).rejects.toMatchObject({ status: 404 });
    const s = await commissionSummary(anil);
    expect(s.pending).toBe(mine.filter((e) => e.status === "calculated").reduce((t, e) => t + Number(e.amount), 0));
  });

  it("Lakshmi sees her descendants' entries but not Priya's (upline)", async () => {
    const team = await listEntries(lakshmi, { scope: "team" });
    const ids = new Set(team.map((e) => e.employee_id));
    expect(ids.has(emp.anil)).toBe(true);
    expect(ids.has(emp.vikram)).toBe(true);
    expect(ids.has(emp.priya)).toBe(false);
    expect(ids.has(emp.ceo)).toBe(false);
    expect(ids.has(emp.lakshmi)).toBe(false); // own entries are under "mine"
    const statement = await statementWorkbook(lakshmi, { employeeId: emp.anil });
    expect(statement.buffer.length).toBeGreaterThan(100);
    await expect(statementWorkbook(lakshmi, { employeeId: emp.priya })).rejects.toMatchObject({ status: 404 });
  });

  it("a parallel team member cannot see Anil's entries", async () => {
    const team = await listEntries(deepa, { scope: "team" });
    expect(team.some((e) => e.employee_id === emp.anil)).toBe(false);
  });

  it("network screen shows only self and descendants", async () => {
    const net = await getMyNetwork(lakshmi);
    const ids = net.members.map((m) => m.id);
    expect(ids).toContain(emp.anil);
    expect(ids).toContain(emp.deepa);
    expect(ids).not.toContain(emp.priya);
    const sub = await getMyNetwork(lakshmi, emp.vikram);
    expect(sub.members.map((m) => m.id).sort()).toEqual([emp.vikram, emp.anil].sort());
    await expect(getMyNetwork(anil, emp.vikram)).rejects.toMatchObject({ status: 404 });
    await expect(getMyNetwork(deepa, emp.anil)).rejects.toMatchObject({ status: 404 });
  });
});

describe("approvals & settlements", () => {
  let settlementId: string;
  let total: number;

  it("approvers cannot approve their own commission; others can; rejection needs a reason", async () => {
    const pending = await listEntries(ceo, { scope: "all", status: "calculated" });
    const own = pending.find((e) => e.employee_id === emp.ceo)!;
    await expect(decideEntries(ceo, [String(own.id)], "approve")).rejects.toMatchObject({ status: 403 });
    await expect(decideEntries(lakshmi, [String(own.id)], "approve")).rejects.toMatchObject({ status: 403 });
    await expect(decideEntries(platform, [String(own.id)], "reject", "no")).rejects.toMatchObject({ status: 400 });
    const r = await decideEntries(platform, pending.map((e) => String(e.id)), "approve");
    expect(r.count).toBe(pending.length);
    expect((await listEntries(ceo, { scope: "all", status: "calculated" }))).toHaveLength(0);
  });

  it("weekly settlements must start on a Monday, monthly on the 1st", async () => {
    await expect(createSettlement(ceo, { periodType: "weekly", periodStart: "2026-10-13" })).rejects.toMatchObject({ status: 400 });
    await expect(createSettlement(ceo, { periodType: "monthly", periodStart: "2026-10-02" })).rejects.toMatchObject({ status: 400 });
    await expect(createSettlement(lakshmi, { periodType: "monthly", periodStart: istMonthStart() })).rejects.toMatchObject({ status: 403 });
  });

  it("creates a monthly settlement; cancelling returns entries to approved", async () => {
    const s = await createSettlement(ceo, { periodType: "monthly", periodStart: istMonthStart() });
    expect(s.entryCount).toBe(16);
    await expect(createSettlement(ceo, { periodType: "monthly", periodStart: istMonthStart() })).rejects.toMatchObject({ status: 422 });
    await settlementAction(ceo, s.id, "cancel", "Rebuild");
    const back = await db.query<{ n: number }>("select count(*)::int as n from commission_entries where status = 'approved' and settlement_id is null");
    expect(back[0].n).toBe(16);
    const again = await createSettlement(ceo, { periodType: "monthly", periodStart: istMonthStart() });
    settlementId = again.id;
    total = again.total;
    expect(total).toBeGreaterThan(0);
  });

  it("requires a different approver and moves through the pipeline", async () => {
    await settlementAction(ceo, settlementId, "submit");
    await expect(settlementAction(ceo, settlementId, "approve")).rejects.toMatchObject({ status: 403 });
    await expect(settlementAction(ceo, settlementId, "request_finance")).rejects.toMatchObject({ status: 409 });
    await settlementAction(platform, settlementId, "approve");
    await settlementAction(ceo, settlementId, "request_finance");
    const [s] = (await listSettlements(ceo)).filter((x) => x.id === settlementId);
    expect(s.status).toBe("finance_requested");
    const wb = await settlementWorkbook(ceo, settlementId);
    expect(wb.filename).toMatch(/^CS-M-.*\.xlsx$/);
    expect(wb.buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("a mismatched reconciliation cannot be accepted", async () => {
    const r = await addManualReconciliation(ceo, settlementId, { externalReference: "UTR-MISMATCH", reportedAmount: total - 1 });
    expect(r.matched).toBe(false);
    await expect(reviewReconciliation(platform, r.id, "accept")).rejects.toMatchObject({ status: 422 });
    await reviewReconciliation(platform, r.id, "reject", "Amount differs");
    const [s] = await db.query<{ status: string }>("select status from commission_settlements where id = $1", [settlementId]);
    expect(s.status).toBe("finance_requested");
  });

  it("a delivered (matched) webhook never marks the settlement paid by itself", async () => {
    const r = await db.transaction((q) =>
      recordReconciliation(q, { organizationId: ceo.organizationId, settlementId, source: "uniklife_webhook", externalReference: "UNIK-PAY-1", reportedAmount: total }),
    );
    expect(r.matched).toBe(true);
    const [s] = await db.query<{ status: string }>("select status from commission_settlements where id = $1", [settlementId]);
    expect(s.status).toBe("finance_requested");
    const paid = await db.query<{ n: number }>("select count(*)::int as n from commission_entries where settlement_id = $1 and status = 'paid'", [settlementId]);
    expect(paid[0].n).toBe(0);
    // The database also refuses a "paid" status without a human confirmation.
    await expect(db.query("update commission_settlements set status = 'paid' where id = $1", [settlementId])).rejects.toThrow();

    // An authorized human accepts the matched reconciliation → paid.
    await expect(reviewReconciliation(lakshmi, r.id, "accept")).rejects.toMatchObject({ status: 403 });
    await reviewReconciliation(platform, r.id, "accept", "Matches bank statement");
    const [after] = await db.query<{ status: string; payment_confirmation_source: string; paid_confirmed_by: string }>(
      "select status, payment_confirmation_source, paid_confirmed_by from commission_settlements where id = $1", [settlementId],
    );
    expect(after).toMatchObject({ status: "paid", payment_confirmation_source: "finance_reconciliation", paid_confirmed_by: platform.user.id });
    const entries = await db.query<{ status: string }>("select status from commission_entries where settlement_id = $1", [settlementId]);
    expect(entries.every((e) => e.status === "paid")).toBe(true);
    const s2 = await commissionSummary(anil);
    expect(s2.paid).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Flexible plans: level counts, bases, scopes, approval modes
// ---------------------------------------------------------------------------
describe("flexible commission plans", () => {
  type Entry = {
    id: string; plan_id: string; plan_version: number; employee_level: number; basis: string; level_rate: string; payable_rate: string;
    level_rate_percent: string | null; payable_rate_percent: string | null; base_amount: string | null; area_sq_yards: string; amount: string;
  };
  const fullEntries = (bookingId: string) =>
    db.query<Entry>(
      `select id, plan_id, plan_version, employee_level, basis, level_rate, payable_rate, level_rate_percent, payable_rate_percent, base_amount, area_sq_yards, amount
         from commission_entries where booking_id = $1 order by employee_level desc`,
      [bookingId],
    );
  const setPlotType = (nums: string[], type: string | null) =>
    db.query("update plots set property_type = $3 where venture_id = $1 and plot_number = any($2::text[])", [ventureId, nums, type]);
  const netOf = async (bookingId: string) => Number((await db.query<{ n: string }>("select net_amount as n from bookings where id = $1", [bookingId]))[0].n);
  const planByVersion = async (v: number) => (await listPlans(ceo)).find((p) => Number(p.version) === v)!;

  let villaPlanId: string;
  let orgOpenPlanId: string;
  let venturePlanId: string;

  const pctInput = (over: Partial<PlanInput> = {}): PlanInput => ({
    name: "Apartments — 3 levels %", calculationMethod: "differential", paySellingEmployee: true, ceoSeparateEntitlement: false,
    maxPayableLevels: 3, levelCount: 3, basis: "percentage", propertyType: "apartment", ventureIds: [], notes: null,
    levels: [1.5, 1, 0.5].map((rate, i) => ({ level: i + 1, label: `L${i + 1}`, rate, eligible: true })),
    ...over,
  });

  beforeAll(async () => {
    villaPlanId = String((await planByVersion(2)).id);
    const open = (await listPlans(ceo)).find((p) => p.status === "active" && p.property_type === "any" && (p.venture_ids as string[]).length === 0)!;
    orgOpenPlanId = String(open.id);
  });

  it("a villa_plot booking uses the % plan; amounts = round(net × pct / 100, 2) and satisfy the DB check", async () => {
    await setPlotType(["50"], "villa_plot");
    const bookingId = await confirmedBooking(anil, ["50"]);
    const net = await netOf(bookingId);
    const rows = await fullEntries(bookingId);
    // 5-level plan: Anil (L8), Vikram (L7), Sneha (L6) are not on its ladder.
    expect(rows.map((r) => r.employee_level)).toEqual([5, 4, 3, 2, 1]);
    expect(rows.every((r) => r.plan_id === villaPlanId && r.basis === "percentage")).toBe(true);
    expect(rows.map((r) => Number(r.payable_rate_percent))).toEqual([0.5, 0.25, 0.25, 0.5, 0.5]);
    expect(rows.map((r) => Number(r.level_rate_percent))).toEqual([0.5, 0.75, 1, 1.5, 2]);
    expect(rows.every((r) => Number(r.payable_rate) === 0 && Number(r.level_rate) === 0)).toBe(true);
    expect(rows.every((r) => Number(r.base_amount) === net)).toBe(true);
    for (const r of rows) expect(Number(r.amount)).toBe(Math.round(net * Number(r.payable_rate_percent)) / 100);
    const total = rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100;
    expect(total).toBeCloseTo(net * 0.02, 1);
    const [ok] = await db.query<{ ok: boolean }>(
      "select bool_and(amount = round(base_amount * payable_rate_percent / 100, 2)) as ok from commission_entries where booking_id = $1", [bookingId],
    );
    expect(ok.ok).toBe(true);
    // The database refuses a percentage entry whose amount does not match.
    await expect(db.query(
      `insert into commission_entries (organization_id, booking_id, plan_id, plan_version, employee_id, beneficiary_role, chain_depth, employee_level,
                                       basis, level_rate, payable_rate, level_rate_percent, payable_rate_percent, base_amount, area_sq_yards, amount, hierarchy_snapshot)
       select organization_id, booking_id, plan_id, plan_version, employee_id, 'ceo_entitlement', chain_depth, employee_level,
              basis, level_rate, payable_rate, level_rate_percent, payable_rate_percent, base_amount, area_sq_yards, amount + 1, hierarchy_snapshot
         from commission_entries where id = $1`,
      [rows[0].id],
    )).rejects.toThrow(/commission_entries_amount_check|check constraint/);
  });

  it("an open_plot booking uses the per-sq-yd plan", async () => {
    const bookingId = await confirmedBooking(anil, ["51"]);
    const rows = await fullEntries(bookingId);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.plan_id === orgOpenPlanId && r.basis === "per_sq_yard" && r.payable_rate_percent === null)).toBe(true);
    for (const r of rows) expect(Number(r.amount)).toBe(Math.round(Number(r.payable_rate) * Number(r.area_sq_yards) * 100) / 100);
  });

  it("a multi-plot booking mixing property types uses the venture's type; a % plan uses the total net amount", async () => {
    await setPlotType(["52"], "villa_plot");
    const mixed = await confirmedBooking(anil, ["52", "53"]);
    expect((await fullEntries(mixed)).every((r) => r.plan_id === orgOpenPlanId)).toBe(true);

    await setPlotType(["54", "55"], "villa_plot");
    const both = await confirmedBooking(anil, ["54", "55"]);
    const rows = await fullEntries(both);
    const net = await netOf(both);
    const [sum] = await db.query<{ n: string }>("select sum(net_amount) as n from booking_plots where booking_id = $1", [both]);
    expect(Number(sum.n)).toBe(net);
    expect(rows.every((r) => r.plan_id === villaPlanId && Number(r.base_amount) === net)).toBe(true);
  });

  it("validates plan definitions in the service", async () => {
    await expect(createPlanDraft(ceo, pctInput({ ventureIds: ["00000000-0000-4000-8000-000000000000"] }))).rejects.toMatchObject({ status: 400 });
    await expect(createPlanDraft(ceo, pctInput({ maxPayableLevels: 4 }))).rejects.toMatchObject({ status: 400 });
    await expect(createPlanDraft(ceo, pctInput({ levels: [1, 1, 0.5].map((rate, i) => ({ level: i + 1, label: `L${i + 1}`, rate, eligible: true })) }))).rejects.toMatchObject({ status: 400 });
    await expect(createPlanDraft(ceo, pctInput({ levelCount: 4 }))).rejects.toMatchObject({ status: 400 });
    await expect(createPlanDraft(ceo, pctInput({ levels: [150, 1, 0.5].map((rate, i) => ({ level: i + 1, label: `L${i + 1}`, rate, eligible: true })) }))).rejects.toMatchObject({ status: 400 });
  });

  it("simulates percentage plans with a sale value", async () => {
    const r = await simulate(ceo, { planId: villaPlanId, saleValue: 5_000_000 });
    expect(r.basis).toBe("percentage");
    expect(r.lines).toHaveLength(5);
    expect(r.totalAmount).toBe(100_000);
    const real = await simulate(ceo, { planId: villaPlanId, saleValue: 1_000_000, employeeId: emp.anil });
    expect(real.lines.map((l) => l.employeeLevel)).toEqual([5, 4, 3, 2, 1]);
    expect(real.decisions[0].reason).toMatch(/not on this plan's 5-level ladder/);
    await expect(simulate(ceo, { planId: villaPlanId, areaSqYards: 100 })).rejects.toMatchObject({ status: 400 });
    const draft = await simulate(ceo, { plan: pctInput(), saleValue: 1_000_000, hypotheticalLevels: [3, 2, 1] });
    expect(draft.totalAmount).toBe(15_000);
  });

  it("a venture-specific plan beats the organization-wide plan; activation closes only its own scope", async () => {
    const d = await createPlanDraft(ceo, {
      name: "Sunrise — 6 levels per sq yd", calculationMethod: "differential", paySellingEmployee: true, ceoSeparateEntitlement: false,
      maxPayableLevels: 6, levelCount: 6, basis: "per_sq_yard", propertyType: "any", ventureIds: [ventureId], notes: null,
      levels: [2000, 1700, 1400, 1100, 800, 500].map((rate, i) => ({ level: i + 1, label: `Level ${i + 1}`, rate, eligible: true })),
    });
    venturePlanId = d.id;
    await submitPlan(ceo, d.id);
    const res = await approvePlan(platform, d.id);
    expect(res.supersededPlanId).toBeNull();
    const plans = await listPlans(ceo);
    expect(plans.find((p) => p.id === orgOpenPlanId)).toMatchObject({ status: "active", effective_to: null });
    expect(plans.find((p) => p.id === villaPlanId)).toMatchObject({ status: "active", effective_to: null });
    expect(plans.find((p) => p.id === venturePlanId)).toMatchObject({ status: "active", venture_ids: [ventureId] });

    const bookingId = await confirmedBooking(anil, ["56"]);
    const rows = await fullEntries(bookingId);
    expect(rows.map((r) => r.employee_level)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(rows.every((r) => r.plan_id === venturePlanId)).toBe(true);
    expect(rows.map((r) => Number(r.payable_rate))).toEqual([500, 300, 300, 300, 300, 300]);
  });

  it("'Edit plan' creates a one-click draft with the same scope; approving it supersedes only that scope", async () => {
    const v = await createVersionFromPlan(ceo, venturePlanId);
    const p = await getPlan(ceo, v.id);
    expect(p.plan).toMatchObject({ status: "draft", property_type: "any", venture_ids: [ventureId], level_count: 6, basis: "per_sq_yard" });
    expect(p.levels.map((l) => l.rate)).toEqual([2000, 1700, 1400, 1100, 800, 500]);
    // Change the structure: 5 levels, percentage of sale value.
    await updatePlanDraft(ceo, v.id, {
      name: "Sunrise — 5 levels %", calculationMethod: "differential", paySellingEmployee: true, ceoSeparateEntitlement: false,
      maxPayableLevels: 5, levelCount: 5, basis: "percentage", propertyType: "any", ventureIds: [ventureId], notes: "Switch to % of sale value",
      levels: [2, 1.5, 1, 0.75, 0.5].map((rate, i) => ({ level: i + 1, label: `Level ${i + 1}`, rate, eligible: true })),
    });
    const edited = await getPlan(ceo, v.id);
    expect(edited).toMatchObject({ levelCount: 5, basis: "percentage" });
    expect(edited.levels.map((l) => l.rate)).toEqual([2, 1.5, 1, 0.75, 0.5]);
    await submitPlan(ceo, v.id);
    const res = await approvePlan(platform, v.id);
    expect(res.supersededPlanId).toBe(venturePlanId);
    const plans = await listPlans(ceo);
    expect(plans.find((x) => x.id === venturePlanId)).toMatchObject({ status: "superseded" });
    expect(plans.find((x) => x.id === orgOpenPlanId)).toMatchObject({ status: "active", effective_to: null });
    expect(plans.find((x) => x.id === villaPlanId)).toMatchObject({ status: "active", effective_to: null });
    // The superseded plan's levels are frozen.
    await expect(db.query("update commission_plan_levels set rate_per_sq_yard = 1 where plan_id = $1 and level = 6", [venturePlanId])).rejects.toThrow(/cannot be modified/);
  });

  it("single-approver mode lets an org admin approve their own plan (recorded); four-eyes when switched back on", async () => {
    expect(await getCommissionSettings(ceo)).toEqual({ requiresSecondApprover: true });
    await expect(updateCommissionSettings(lakshmi, { requiresSecondApprover: false })).rejects.toMatchObject({ status: 403 });
    await updateCommissionSettings(ceo, { requiresSecondApprover: false });
    expect(await getCommissionSettings(ceo)).toEqual({ requiresSecondApprover: false });

    const a = await createPlanDraft(ceo, pctInput());
    await submitPlan(ceo, a.id);
    await approvePlan(ceo, a.id, { note: "Own plan" });
    const approved = await getPlan(ceo, a.id);
    expect(approved.plan.status).toBe("active");
    const approval = approved.approvals.find((x) => x.action === "approved")!;
    expect(approval.actor_user_id).toBe(ceo.user.id);
    expect(String(approval.note)).toMatch(/Self-approved/);

    await updateCommissionSettings(ceo, { requiresSecondApprover: true });
    const b = await createVersionFromPlan(ceo, a.id);
    await submitPlan(ceo, b.id);
    await expect(approvePlan(ceo, b.id)).rejects.toMatchObject({ status: 403 });
    // The database enforces the same rule.
    await expect(db.query("update commission_plans set status = 'active', approved_by = submitted_by, approved_at = now(), effective_from = now() where id = $1", [b.id]))
      .rejects.toThrow(/someone other than its submitter/);
    const ok = await approvePlan(platform, b.id);
    expect(ok.supersededPlanId).toBe(a.id);

    const audits = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where action = 'commission_settings.updated' and organization_id = $1", [ceo.organizationId]);
    expect(audits[0].n).toBe(2);
  });

  it("statement and settlement workbooks include percentage entries", async () => {
    const statement = await statementWorkbook(ceo, { employeeId: emp.priya });
    expect(statement.buffer.subarray(0, 2).toString()).toBe("PK");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(statement.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Statement")!;
    const header = (ws.getRow(1).values as unknown[]).map(String);
    expect(header).toEqual(expect.arrayContaining(["Basis", "Rate (% of sale value)", "Sale value (INR)", "Rate / sq yd (INR)"]));
    const basisCol = header.indexOf("Basis");
    const values: string[] = [];
    ws.eachRow((row, i) => { if (i > 1) values.push(String(row.getCell(basisCol).value ?? "")); });
    expect(values).toEqual(expect.arrayContaining(["% of sale value", "Per sq yd"]));
  });
});
