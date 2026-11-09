import { describe, expect, it } from "vitest";
import {
  calculateCommissions, commissionAmount, DEFAULT_LEVELS, defaultLevelLabel, PLAN_PRESETS, resizeLevels, scopeSpecificity, selectApplicablePlan,
  suggestedLevels, validatePlanLevels,
  type ChainMember, type CommissionBasis, type CommissionPlanInput,
} from "@/lib/commissions/engine";

const RATES = [2000, 1800, 1600, 1400, 1200, 1000, 800, 400];

function plan(over: Partial<CommissionPlanInput> = {}): CommissionPlanInput {
  return {
    id: "p1", version: 1, method: "differential", paySellingEmployee: true, ceoSeparateEntitlement: false, maxPayableLevels: 8,
    levelCount: 8, basis: "per_sq_yard",
    levels: DEFAULT_LEVELS.map((l) => ({ ...l, eligible: true })),
    ...over,
  };
}

/** A plan with the given descending values (levels 1..N). */
function planOf(rates: number[], basis: CommissionBasis = "per_sq_yard", over: Partial<CommissionPlanInput> = {}): CommissionPlanInput {
  return plan({
    levelCount: rates.length, maxPayableLevels: rates.length, basis,
    levels: rates.map((rate, i) => ({ level: i + 1, label: defaultLevelLabel(i + 1), rate, eligible: true })),
    ...over,
  });
}

function member(level: number | null, over: Partial<ChainMember> = {}): ChainMember {
  return { employeeId: `e${level}`, employeeCode: `EMP-L${level}`, fullName: `Level ${level}`, commissionLevel: level, active: true, commissionEligible: true, ...over };
}

/** Seller at L{n} with a complete upline to the CEO (L1). */
const chainOf = (n: number): ChainMember[] => Array.from({ length: n }, (_, i) => member(n - i));
const fullChain = () => chainOf(8);

const byLevel = (r: ReturnType<typeof calculateCommissions>) => Object.fromEntries(r.lines.map((l) => [l.employeeLevel, l.payableRate]));

describe("default plan & presets", () => {
  it("uses the proposed default rates for all eight levels", () => {
    expect(DEFAULT_LEVELS.map((l) => l.rate)).toEqual(RATES);
    expect(DEFAULT_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(DEFAULT_LEVELS[7].label).toBe("Seventh line");
    expect(validatePlanLevels(DEFAULT_LEVELS).ok).toBe(true);
    expect(validatePlanLevels(DEFAULT_LEVELS, { levelCount: 8, basis: "per_sq_yard" }).ok).toBe(true);
  });

  it("ships valid 8/6/5-level per-sq-yd and 5-level percentage presets", () => {
    expect(PLAN_PRESETS.map((p) => [p.levels.length, p.basis])).toEqual([[8, "per_sq_yard"], [6, "per_sq_yard"], [5, "per_sq_yard"], [5, "percentage"]]);
    for (const p of PLAN_PRESETS) expect(validatePlanLevels(p.levels, { levelCount: p.levels.length, basis: p.basis })).toEqual({ ok: true, errors: [] });
    expect(PLAN_PRESETS[0].levels.map((l) => l.rate)).toEqual(RATES);
    expect(PLAN_PRESETS[3].levels.map((l) => l.rate)).toEqual([2, 1.5, 1, 0.75, 0.5]);
  });

  it("default labels and suggested series are valid for every level count and basis", () => {
    expect(defaultLevelLabel(1)).toBe("Level 1 (CEO)");
    expect(defaultLevelLabel(2)).toBe("Level 2 (First line)");
    expect(defaultLevelLabel(12)).toBe("Level 12 (Eleventh line)");
    for (const basis of ["per_sq_yard", "percentage"] as const) {
      for (let n = 1; n <= 12; n++) {
        const s = suggestedLevels(basis, n);
        expect(s).toHaveLength(n);
        expect(validatePlanLevels(s, { levelCount: n, basis }).ok).toBe(true);
      }
    }
  });

  it("resizeLevels keeps existing rows and appends descending rows", () => {
    const five = resizeLevels(DEFAULT_LEVELS.map((l) => ({ ...l, eligible: true })), 5, "per_sq_yard");
    expect(five.map((l) => l.rate)).toEqual([2000, 1800, 1600, 1400, 1200]);
    const twelve = resizeLevels(five, 12, "per_sq_yard");
    expect(twelve).toHaveLength(12);
    expect(twelve[5].label).toBe("Level 6 (Fifth line)");
    expect(validatePlanLevels(twelve, { levelCount: 12 }).ok).toBe(true);
    const pct = resizeLevels(suggestedLevels("percentage", 3), 12, "percentage");
    expect(validatePlanLevels(pct, { levelCount: 12, basis: "percentage" }).ok).toBe(true);
  });
});

describe("differential method (8 levels, per sq yd)", () => {
  it("pays every level of a full chain; total per sq yd equals the top rate (2000)", () => {
    const r = calculateCommissions(plan(), fullChain(), 1);
    expect(r.lines).toHaveLength(8);
    expect(byLevel(r)).toEqual({ 8: 400, 7: 400, 6: 200, 5: 200, 4: 200, 3: 200, 2: 200, 1: 200 });
    expect(r.totalAmount).toBe(2000);
    expect(r.basis).toBe("per_sq_yard");
    expect(r.lines[0].beneficiaryRole).toBe("seller");
    expect(r.lines.slice(1).every((l) => l.beneficiaryRole === "upline")).toBe(true);
    expect(r.decisions.every((d) => d.paid)).toBe(true);
  });

  it("scales by area and records the baseline already paid below", () => {
    const r = calculateCommissions(plan(), fullChain(), 150.5);
    expect(r.totalAmount).toBe(2000 * 150.5);
    const l7 = r.lines.find((l) => l.employeeLevel === 7)!;
    expect(l7.baselineRate).toBe(400);
    expect(l7.levelRate).toBe(800);
    expect(l7.amount).toBe(400 * 150.5);
  });

  it("a manager with a LOWER level than the downline gets nothing", () => {
    // Seller L5 (1200) reporting to an L6 manager (1000), then L4.
    const r = calculateCommissions(plan(), [member(5), member(6), member(4)], 10);
    const mgr = r.decisions.find((d) => d.employeeLevel === 6)!;
    expect(mgr.paid).toBe(false);
    expect(mgr.reason).toMatch(/No differential/);
    expect(byLevel(r)).toEqual({ 5: 1200, 4: 200 });
    expect(r.totalAmount).toBe(14000);
  });

  it("skips an inactive employee; the next upline absorbs the differential", () => {
    const chain = fullChain();
    chain[1] = member(7, { active: false });
    const r = calculateCommissions(plan(), chain, 1);
    expect(r.decisions[1]).toMatchObject({ paid: false, reason: "Employee not active" });
    expect(byLevel(r)[6]).toBe(600);
    expect(r.totalAmount).toBe(2000);
  });

  it("skips a commission-ineligible employee", () => {
    const chain = fullChain();
    chain[2] = member(6, { commissionEligible: false });
    const r = calculateCommissions(plan(), chain, 1);
    expect(r.decisions[2]).toMatchObject({ paid: false, reason: "Employee not commission-eligible" });
    expect(byLevel(r)[5]).toBe(400);
  });

  it("skips a level marked ineligible in the plan", () => {
    const p = plan({ levels: DEFAULT_LEVELS.map((l) => ({ ...l, eligible: l.level !== 7 })) });
    const r = calculateCommissions(p, fullChain(), 1);
    expect(r.decisions[1]).toMatchObject({ paid: false, reason: "Level 7 not eligible in this plan" });
    expect(byLevel(r)[6]).toBe(600);
    expect(r.totalAmount).toBe(2000);
  });

  it("does not pay the selling employee when the plan says so", () => {
    const r = calculateCommissions(plan({ paySellingEmployee: false }), fullChain(), 1);
    expect(r.decisions[0]).toMatchObject({ paid: false, reason: "Plan does not pay the selling employee" });
    expect(r.lines.find((l) => l.beneficiaryRole === "seller")).toBeUndefined();
    expect(byLevel(r)[7]).toBe(800);
    expect(r.totalAmount).toBe(2000);
  });

  it("caps the number of payees at max_payable_levels", () => {
    const r = calculateCommissions(plan({ maxPayableLevels: 3 }), fullChain(), 1);
    expect(r.lines.map((l) => l.employeeLevel)).toEqual([8, 7, 6]);
    expect(r.totalAmount).toBe(1000);
    expect(r.decisions[3]).toMatchObject({ paid: false, reason: "Plan pays at most 3 levels" });
  });

  it("pays each rank at most once per booking", () => {
    const r = calculateCommissions(plan(), [member(8), member(8, { employeeId: "e8b", employeeCode: "EMP-L8B" }), member(7)], 1);
    expect(r.decisions[1]).toMatchObject({ paid: false, reason: "Level 8 already paid in this chain" });
    expect(r.totalAmount).toBe(800);
  });

  it("skips members not on the ladder", () => {
    const r = calculateCommissions(plan(), [member(8), member(null), member(7)], 1);
    expect(r.decisions[1]).toMatchObject({ paid: false, reason: "Not on the commission ladder" });
    expect(r.totalAmount).toBe(800);
  });

  it("pays the CEO as a separate full-rate entitlement when configured", () => {
    const chain = fullChain();
    const ceo = chain[7];
    const r = calculateCommissions(plan({ ceoSeparateEntitlement: true }), chain, 1, ceo);
    expect(r.decisions[7]).toMatchObject({ paid: false, reason: "CEO paid as separate entitlement" });
    const ent = r.lines.find((l) => l.beneficiaryRole === "ceo_entitlement")!;
    expect(ent).toMatchObject({ employeeLevel: 1, payableRate: 2000, baselineRate: 0, chainDepth: 7 });
    expect(r.totalAmount).toBe(3800);
  });

  it("pays the CEO entitlement even when the CEO is not in the seller's chain", () => {
    const ceo = member(1, { employeeId: "ceo" });
    const r = calculateCommissions(plan({ ceoSeparateEntitlement: true }), [member(8), member(7)], 2, ceo);
    const ent = r.lines.find((l) => l.beneficiaryRole === "ceo_entitlement")!;
    expect(ent.chainDepth).toBe(2);
    expect(ent.amount).toBe(4000);
    expect(r.totalAmount).toBe(800 * 2 + 4000);
  });

  it("does not pay a CEO entitlement to an inactive CEO", () => {
    const ceo = member(1, { active: false });
    const r = calculateCommissions(plan({ ceoSeparateEntitlement: true }), [member(8)], 1, ceo);
    expect(r.lines.find((l) => l.beneficiaryRole === "ceo_entitlement")).toBeUndefined();
  });
});

describe("full_rate method", () => {
  it("pays every level its full rate (sum of all eight rates)", () => {
    const r = calculateCommissions(plan({ method: "full_rate" }), fullChain(), 1);
    expect(byLevel(r)).toEqual({ 8: 400, 7: 800, 6: 1000, 5: 1200, 4: 1400, 3: 1600, 2: 1800, 1: 2000 });
    expect(r.totalAmount).toBe(RATES.reduce((s, x) => s + x, 0));
    expect(r.lines.every((l) => l.baselineRate === 0)).toBe(true);
  });

  it("pays a lower-level manager their full rate", () => {
    const r = calculateCommissions(plan({ method: "full_rate" }), [member(5), member(6)], 1);
    expect(byLevel(r)).toEqual({ 5: 1200, 6: 1000 });
  });

  it("respects max_payable_levels, ineligibility and pay_selling_employee", () => {
    const p = plan({ method: "full_rate", maxPayableLevels: 2, paySellingEmployee: false, levels: DEFAULT_LEVELS.map((l) => ({ ...l, eligible: l.level !== 6 })) });
    const r = calculateCommissions(p, fullChain(), 1);
    expect(r.lines.map((l) => l.employeeLevel)).toEqual([7, 5]);
    expect(r.totalAmount).toBe(2000);
  });
});

describe("configurable level counts", () => {
  it("5-level per sq yd: full L5→L1 chain totals the top rate", () => {
    const r = calculateCommissions(planOf([2000, 1600, 1200, 800, 400]), chainOf(5), 100);
    expect(byLevel(r)).toEqual({ 5: 400, 4: 400, 3: 400, 2: 400, 1: 400 });
    expect(r.totalAmount).toBe(200_000);
  });

  it("ranks beyond the plan's level count are not on its ladder (and earn nothing)", () => {
    const r = calculateCommissions(planOf([2000, 1600, 1200, 800, 400]), fullChain(), 1);
    expect(r.decisions.slice(0, 3).map((d) => d.paid)).toEqual([false, false, false]);
    expect(r.decisions[0].reason).toBe("Level 8 is not on this plan's 5-level ladder");
    expect(r.decisions[2].reason).toBe("Level 6 is not on this plan's 5-level ladder");
    // L5 is the first payee (an upline, from zero) at its full rate.
    expect(r.lines[0]).toMatchObject({ employeeLevel: 5, beneficiaryRole: "upline", payableRate: 400, chainDepth: 3 });
    expect(r.lines).toHaveLength(5);
    expect(r.totalAmount).toBe(2000);
  });

  it("a stray level row above level_count is ignored", () => {
    const p = planOf([2000, 1600, 1200, 800, 400]);
    p.levels.push({ level: 6, label: "stray", rate: 100, eligible: true });
    const r = calculateCommissions(p, [member(6), member(5)], 1);
    expect(r.decisions[0]).toMatchObject({ paid: false });
    expect(r.totalAmount).toBe(400);
  });

  it("6-level per sq yd: differential and full rate", () => {
    const rates = [2000, 1700, 1400, 1100, 800, 500];
    const d = calculateCommissions(planOf(rates), chainOf(6), 1);
    expect(byLevel(d)).toEqual({ 6: 500, 5: 300, 4: 300, 3: 300, 2: 300, 1: 300 });
    expect(d.totalAmount).toBe(2000);
    const f = calculateCommissions(planOf(rates, "per_sq_yard", { method: "full_rate" }), chainOf(6), 1);
    expect(f.totalAmount).toBe(7500);
  });

  it("12-level plan pays a 12-deep chain", () => {
    const rates = Array.from({ length: 12 }, (_, i) => 2400 - 200 * i); // 2400 … 200
    expect(validatePlanLevels(rates.map((rate, i) => ({ level: i + 1, rate })), { levelCount: 12 }).ok).toBe(true);
    const d = calculateCommissions(planOf(rates), chainOf(12), 2);
    expect(d.lines).toHaveLength(12);
    expect(d.lines.every((l) => l.payableRate === 200)).toBe(true);
    expect(d.totalAmount).toBe(4800);
    const f = calculateCommissions(planOf(rates, "per_sq_yard", { method: "full_rate" }), chainOf(12), 1);
    expect(f.totalAmount).toBe(15600);
    const capped = calculateCommissions(planOf(rates, "per_sq_yard", { maxPayableLevels: 4 }), chainOf(12), 1);
    expect(capped.lines.map((l) => l.employeeLevel)).toEqual([12, 11, 10, 9]);
  });
});

describe("percentage of sale value", () => {
  const PCT = [2, 1.5, 1, 0.75, 0.5];

  it("differential: total equals the top percentage of the sale value", () => {
    const r = calculateCommissions(planOf(PCT, "percentage"), chainOf(5), { areaSqYards: 240, baseAmount: 5_000_000 });
    expect(r.basis).toBe("percentage");
    expect(byLevel(r)).toEqual({ 5: 0.5, 4: 0.25, 3: 0.25, 2: 0.5, 1: 0.5 });
    expect(r.lines.map((l) => l.amount)).toEqual([25_000, 12_500, 12_500, 25_000, 25_000]);
    expect(r.totalAmount).toBe(100_000); // 2% of ₹50,00,000
    const l4 = r.lines.find((l) => l.employeeLevel === 4)!;
    expect(l4).toMatchObject({ levelRate: 0.75, baselineRate: 0.5, payableRate: 0.25, baseAmount: 5_000_000, basis: "percentage" });
  });

  it("full rate: each payee earns their full percentage", () => {
    const r = calculateCommissions(planOf(PCT, "percentage", { method: "full_rate" }), chainOf(5), { areaSqYards: 1, baseAmount: 5_000_000 });
    expect(r.totalAmount).toBe(287_500); // 5.75%
  });

  it("an 8-level ladder under a 5-level % plan pays only L5..L1", () => {
    const r = calculateCommissions(planOf(PCT, "percentage"), fullChain(), { areaSqYards: 1, baseAmount: 1_000_000 });
    expect(r.lines.map((l) => l.employeeLevel)).toEqual([5, 4, 3, 2, 1]);
    expect(r.totalAmount).toBe(20_000);
  });

  it("differential never pays a lower-ranked manager", () => {
    const r = calculateCommissions(planOf(PCT, "percentage"), [member(4), member(5), member(3)], { areaSqYards: 1, baseAmount: 100_000 });
    expect(byLevel(r)).toEqual({ 4: 0.75, 3: 0.25 });
    expect(r.decisions[1].reason).toMatch(/No differential/);
  });

  it("rounds like the database: round(base × pct / 100, 2), half away from zero", () => {
    expect(commissionAmount("percentage", 0.75, 0, 1_234_567.89)).toBe(9259.26);
    expect(commissionAmount("percentage", 0.3333, 0, 1_234_567.89)).toBe(4114.81);
    expect(commissionAmount("percentage", 0.5, 0, 1)).toBe(0.01);
    expect(commissionAmount("per_sq_yard", 0.05, 0.1, null)).toBe(0.01);
    expect(commissionAmount("per_sq_yard", 1234.56, 267.89, null)).toBe(330726.28);
    const r = calculateCommissions(planOf([1.25, 0.6666], "percentage"), chainOf(2), { areaSqYards: 1, baseAmount: 9_876_543.21 });
    // L2 0.6666% of 98,76,543.21 = 65,837.037… → 65,837.04; L1 differential 0.5834% = 57,619.753… → 57,619.75
    expect(r.lines.map((l) => l.amount)).toEqual([65837.04, 57619.75]);
    expect(r.lines[1].payableRate).toBe(0.5834);
  });

  it("requires a sale value", () => {
    expect(() => calculateCommissions(planOf(PCT, "percentage"), chainOf(5), 100)).toThrow(/sale value/);
  });

  it("CEO separate entitlement uses the L1 percentage", () => {
    const ceo = member(1, { employeeId: "ceo" });
    const r = calculateCommissions(planOf(PCT, "percentage", { ceoSeparateEntitlement: true }), [member(5), member(4)], { areaSqYards: 1, baseAmount: 1_000_000 }, ceo);
    const ent = r.lines.find((l) => l.beneficiaryRole === "ceo_entitlement")!;
    expect(ent).toMatchObject({ payableRate: 2, amount: 20_000 });
  });
});

describe("validatePlanLevels", () => {
  const lv = (rates: number[]) => rates.map((rate, i) => ({ level: i + 1, rate }));

  it("accepts strictly descending rates", () => {
    expect(validatePlanLevels(lv(RATES))).toEqual({ ok: true, errors: [] });
    expect(validatePlanLevels(lv([9, 8, 7, 6, 5, 4, 3, 0.29])).ok).toBe(true);
  });

  it("rejects equal adjacent rates", () => {
    const v = validatePlanLevels(lv([2000, 1800, 1600, 1400, 1200, 1000, 400, 400]));
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/Level 8 rate \(400\) must be lower than level 7/);
  });

  it("rejects ascending rates", () => {
    const v = validatePlanLevels(lv([400, 800, 1000, 1200, 1400, 1600, 1800, 2000]));
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(7);
  });

  it("requires exactly levels 1..8 by default", () => {
    expect(validatePlanLevels(lv(RATES.slice(0, 7))).errors).toContain("Plan must define exactly levels 1 to 8");
    expect(validatePlanLevels([...lv(RATES), { level: 9, rate: 100 }]).ok).toBe(false);
    expect(validatePlanLevels(lv(RATES).map((l) => (l.level === 8 ? { ...l, level: 7 } : l))).ok).toBe(false);
  });

  it("validates N levels (1..12) against levelCount", () => {
    expect(validatePlanLevels(lv([2000, 1600, 1200, 800, 400]), { levelCount: 5 }).ok).toBe(true);
    expect(validatePlanLevels(lv([2000, 1600, 1200, 800, 400]), { levelCount: 6 }).errors).toContain("Plan must define exactly levels 1 to 6");
    expect(validatePlanLevels(lv([2000, 1600, 1200, 800, 400, 300]), { levelCount: 5 }).ok).toBe(false);
    expect(validatePlanLevels(lv([500]), { levelCount: 1 }).ok).toBe(true);
    expect(validatePlanLevels(lv([]), { levelCount: 0 }).errors.join()).toMatch(/between 1 and 12/);
    const thirteen = lv(Array.from({ length: 13 }, (_, i) => 1300 - i * 100));
    expect(validatePlanLevels(thirteen, { levelCount: 13 }).errors.join()).toMatch(/between 1 and 12/);
  });

  it("validates percentages: ≤ 100, 4 decimals, strictly descending", () => {
    expect(validatePlanLevels(lv([2, 1.5, 1, 0.75, 0.5]), { levelCount: 5, basis: "percentage" }).ok).toBe(true);
    expect(validatePlanLevels(lv([2.1234, 1.0001]), { levelCount: 2, basis: "percentage" }).ok).toBe(true);
    expect(validatePlanLevels(lv([2.12345, 1]), { levelCount: 2, basis: "percentage" }).errors.join()).toMatch(/at most 4 decimals/);
    expect(validatePlanLevels(lv([101, 1]), { levelCount: 2, basis: "percentage" }).errors.join()).toMatch(/cannot exceed 100%/);
    const eq = validatePlanLevels(lv([2, 1, 1]), { levelCount: 3, basis: "percentage" });
    expect(eq.errors.join()).toMatch(/Level 3 percentage \(1%\) must be lower than level 2 percentage \(1%\)/);
    // A per-sq-yd plan does not allow 4 decimals.
    expect(validatePlanLevels(lv([2.1234, 1]), { levelCount: 2, basis: "per_sq_yard" }).errors.join()).toMatch(/at most 2 decimals/);
  });

  it("rejects negative and over-precise rates", () => {
    expect(validatePlanLevels(lv([2000, 1800, 1600, 1400, 1200, 1000, 800, -1])).errors.join()).toMatch(/non-negative/);
    expect(validatePlanLevels(lv([2000, 1800, 1600, 1400, 1200, 1000, 800, 400.123])).errors.join()).toMatch(/2 decimals/);
  });
});

describe("plan scope selection", () => {
  const V1 = "11111111-1111-4111-8111-111111111111";
  const V2 = "22222222-2222-4222-8222-222222222222";
  const c = (id: string, propertyType: string, ventureIds: string[], effectiveFrom = "2026-01-01T00:00:00Z") => ({ id, propertyType, ventureIds, effectiveFrom });
  const all = [c("org-any", "any", []), c("org-villa", "villa_plot", []), c("v1-any", "any", [V1]), c("v1-villa", "villa_plot", [V1])];

  it("ranks venture+type > venture > type > organization-wide", () => {
    expect(selectApplicablePlan(all, { ventureId: V1, propertyType: "villa_plot" })?.id).toBe("v1-villa");
    expect(selectApplicablePlan(all, { ventureId: V1, propertyType: "open_plot" })?.id).toBe("v1-any");
    expect(selectApplicablePlan(all, { ventureId: V2, propertyType: "villa_plot" })?.id).toBe("org-villa");
    expect(selectApplicablePlan(all, { ventureId: V2, propertyType: "open_plot" })?.id).toBe("org-any");
    expect(selectApplicablePlan(all.slice(1, 2), { ventureId: V2, propertyType: "apartment" })).toBeNull();
    expect(scopeSpecificity(c("x", "villa_plot", [V2]), { ventureId: V1, propertyType: "villa_plot" })).toBe(0);
  });

  it("breaks ties by narrower venture list, then latest effective date", () => {
    const tie = [c("wide", "any", [V1, V2]), c("narrow", "any", [V1])];
    expect(selectApplicablePlan(tie, { ventureId: V1, propertyType: "open_plot" })?.id).toBe("narrow");
    const dated = [c("old", "any", [], "2026-01-01T00:00:00Z"), c("new", "any", [], "2026-02-01T00:00:00Z")];
    expect(selectApplicablePlan(dated, { ventureId: V1, propertyType: "open_plot" })?.id).toBe("new");
  });
});
