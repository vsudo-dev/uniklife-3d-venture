import { describe, expect, it } from "vitest";
import {
  allocate,
  calculatePricing,
  checkDiscountEligibility,
  plotBasePaise,
  type DiscountRecord,
  type DiscountUsage,
  type PricingInput,
  type PricingPlot,
} from "@/lib/pricing/engine";

const VENTURE = "venture-1";
const NOW = new Date("2026-06-15T10:00:00Z");
const DAY = 86_400_000;

const P1: PricingPlot = { id: "p1", plotNumber: "17", areaSqYards: 200, pricePerSqYard: 18000 }; // ₹36,00,000
const P2: PricingPlot = { id: "p2", plotNumber: "18", areaSqYards: 150.5, pricePerSqYard: 19500 }; // ₹29,34,750
const P3: PricingPlot = { id: "p3", plotNumber: "19", areaSqYards: 167.33, pricePerSqYard: 18333.33 };

let seq = 0;
function discount(over: Partial<DiscountRecord> = {}): DiscountRecord {
  seq++;
  return {
    id: `d${seq}`, name: `Discount ${seq}`, code: null, valueType: "percentage", category: "general", value: 5, maxDiscountAmount: null,
    startsAt: new Date(NOW.getTime() - 10 * DAY), expiresAt: new Date(NOW.getTime() + 10 * DAY), applicableVentureIds: [], applicablePlotIds: [],
    customerId: null, usageLimitTotal: null, usageLimitPerCustomer: null, stackable: false, requiresApproval: false, status: "active",
    approvedAt: new Date(NOW.getTime() - 10 * DAY), ...over,
  };
}

function price(plots: PricingPlot[], discounts: DiscountRecord[] = [], over: Partial<PricingInput> = {}) {
  return calculatePricing({
    ventureId: VENTURE, plots, customerId: "c1", now: NOW, currency: "INR", bookingAmountPercent: 10, allowStacking: false,
    maxDiscountPercent: 20, requested: discounts.map((d) => ({ ref: d.code ?? d.id, discount: d })), usage: new Map(), ...over,
  });
}

const paise = (n: number) => Math.round(n * 100);
const sumPaise = (xs: number[]) => xs.reduce((s, x) => s + paise(x), 0);

describe("allocate", () => {
  it("splits proportionally and always sums exactly", () => {
    const parts = allocate(1_000_001, [3, 3, 3]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(1_000_001);
    expect(parts.every(Number.isInteger)).toBe(true);
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
  });
});

describe("base pricing (paise)", () => {
  it("prices a single plot", () => {
    const r = price([P1]);
    expect(r.ok).toBe(true);
    expect(r.snapshot.baseAmount).toBe(3_600_000);
    expect(r.snapshot.discountTotal).toBe(0);
    expect(r.snapshot.netAmount).toBe(3_600_000);
    expect(r.snapshot.bookingAmount).toBe(360_000);
    expect(r.snapshot.totalAreaSqYards).toBe(200);
  });

  it("prices multiple plots with per-plot lines that sum exactly", () => {
    const r = price([P1, P2, P3]);
    const s = r.snapshot;
    expect(s.plots).toHaveLength(3);
    expect(s.plots[1].baseAmount).toBe(2_934_750);
    expect(paise(s.plots[2].baseAmount)).toBe(plotBasePaise(P3));
    expect(sumPaise(s.plots.map((p) => p.baseAmount))).toBe(paise(s.baseAmount));
    expect(s.totalAreaSqYards).toBe(517.83);
  });
});

describe("discount allocation across plots", () => {
  it("percentage discounts apply to each plot's base", () => {
    const r = price([P1, P2], [discount({ value: 5 })]);
    expect(r.ok).toBe(true);
    expect(r.snapshot.plots[0].discountAmount).toBe(180_000);
    expect(r.snapshot.plots[1].discountAmount).toBe(146_737.5);
    expect(r.snapshot.discountTotal).toBe(326_737.5);
    expect(r.snapshot.netAmount).toBe(6_534_750 - 326_737.5);
  });

  it("fixed amounts are allocated proportionally and sum exactly", () => {
    const r = price([P1, P2, P3], [discount({ valueType: "fixed_amount", value: 100_000.01 })]);
    const s = r.snapshot;
    expect(s.discountTotal).toBe(100_000.01);
    expect(sumPaise(s.plots.map((p) => p.discountAmount))).toBe(10_000_001);
    // Proportional: the largest plot gets the largest share.
    const bases = [P1, P2, P3].map(plotBasePaise);
    const expectedFirst = Math.floor((10_000_001 * bases[0]) / bases.reduce((a, b) => a + b, 0));
    expect(paise(s.plots[0].discountAmount)).toBe(expectedFirst);
  });

  it("plot-specific discounts only reduce eligible plots", () => {
    const r = price([P1, P2], [discount({ category: "plot", applicablePlotIds: ["p2"], value: 10 })]);
    expect(r.ok).toBe(true);
    expect(r.snapshot.plots[0].discountAmount).toBe(0);
    expect(r.snapshot.plots[1].discountAmount).toBe(293_475);
    expect(r.snapshot.discountTotal).toBe(293_475);
  });

  it("fixed plot-specific discount never exceeds the eligible plots' base", () => {
    const small: PricingPlot = { id: "p9", plotNumber: "9", areaSqYards: 1, pricePerSqYard: 1000 };
    const r = price([P1, small], [discount({ valueType: "fixed_amount", value: 5000, category: "plot", applicablePlotIds: ["p9"] })], { maxDiscountPercent: 100 });
    expect(r.snapshot.plots[1].discountAmount).toBe(1000);
    expect(r.snapshot.plots[0].discountAmount).toBe(0);
  });

  it("applies the discount's maximum cap", () => {
    const r = price([P1, P2], [discount({ value: 10, maxDiscountAmount: 50_000 })]);
    expect(r.snapshot.discountTotal).toBe(50_000);
    expect(sumPaise(r.snapshot.plots.map((p) => p.discountAmount))).toBe(5_000_000);
    expect(r.snapshot.cappedByOrganizationLimit).toBe(false);
  });

  it("caps at the organization limit with an exact per-plot sum", () => {
    const r = price([P1, P2, P3], [discount({ valueType: "fixed_amount", value: 5_000_000 })], { maxDiscountPercent: 7 });
    const s = r.snapshot;
    const cap = Math.round((paise(s.baseAmount) * 7) / 100);
    expect(s.cappedByOrganizationLimit).toBe(true);
    expect(paise(s.discountTotal)).toBe(cap);
    expect(sumPaise(s.plots.map((p) => p.discountAmount))).toBe(cap);
    expect(sumPaise(s.plots.map((p) => p.netAmount))).toBe(paise(s.netAmount));
    expect(paise(s.discounts[0].amount)).toBe(cap);
  });
});

describe("stacking", () => {
  it("is disabled by default: a second discount is rejected", () => {
    const a = discount({ value: 2, stackable: true });
    const b = discount({ value: 1, stackable: true });
    const r = price([P1], [a, b]);
    expect(r.ok).toBe(false);
    expect(r.lines[0].ok).toBe(true);
    expect(r.lines[1].ok).toBe(false);
    expect(r.lines[1].reason).toMatch(/stacking is disabled/i);
    expect(r.snapshot.discounts).toHaveLength(1);
    expect(r.snapshot.discountTotal).toBe(72_000);
  });

  it("when enabled, requires every discount to be stackable", () => {
    const stackA = discount({ value: 2, stackable: true });
    const plain = discount({ value: 1, stackable: false });
    const r1 = price([P1], [stackA, plain], { allowStacking: true });
    expect(r1.lines[1].ok).toBe(false);
    expect(r1.lines[1].reason).toMatch(/cannot be combined/i);

    const plainFirst = discount({ value: 1, stackable: false });
    const stackB = discount({ value: 2, stackable: true });
    const r2 = price([P1], [plainFirst, stackB], { allowStacking: true });
    expect(r2.lines[1].ok).toBe(false);

    const s1 = discount({ value: 2, stackable: true });
    const s2 = discount({ valueType: "fixed_amount", value: 10_000, stackable: true });
    const r3 = price([P1], [s1, s2], { allowStacking: true });
    expect(r3.ok).toBe(true);
    expect(r3.snapshot.discountTotal).toBe(82_000);
    expect(r3.snapshot.discounts.map((d) => d.amount)).toEqual([72_000, 10_000]);
  });

  it("rejects the same discount twice", () => {
    const a = discount({ value: 2, stackable: true });
    const r = calculatePricing({
      ventureId: VENTURE, plots: [P1], customerId: "c1", now: NOW, currency: "INR", bookingAmountPercent: 10, allowStacking: true,
      maxDiscountPercent: 20, requested: [{ ref: "x", discount: a }, { ref: "y", discount: a }], usage: new Map(),
    });
    expect(r.lines[1].reason).toMatch(/already applied/i);
  });
});

describe("eligibility", () => {
  const ctx = (over: { usage?: DiscountUsage; customerId?: string | null; plotIds?: string[]; ventureId?: string; now?: Date } = {}) => ({
    ventureId: over.ventureId ?? VENTURE, plotIds: over.plotIds ?? ["p1"], customerId: over.customerId === undefined ? "c1" : over.customerId,
    now: over.now ?? NOW, usage: over.usage,
  });

  it("accepts an active, in-window discount", () => {
    expect(checkDiscountEligibility(discount(), ctx())).toBeNull();
  });
  it("rejects expired and not-yet-valid discounts", () => {
    expect(checkDiscountEligibility(discount({ expiresAt: new Date(NOW.getTime() - 1) }), ctx())).toMatch(/expired/i);
    expect(checkDiscountEligibility(discount({ startsAt: new Date(NOW.getTime() + DAY) }), ctx())).toMatch(/not yet valid/i);
  });
  it("rejects paused, pending, rejected and archived discounts", () => {
    expect(checkDiscountEligibility(discount({ status: "paused" }), ctx())).toMatch(/paused/i);
    expect(checkDiscountEligibility(discount({ status: "pending_approval" }), ctx())).toMatch(/awaiting approval/i);
    expect(checkDiscountEligibility(discount({ status: "rejected" }), ctx())).toMatch(/rejected/i);
    expect(checkDiscountEligibility(discount({ status: "archived" }), ctx())).toMatch(/no longer available/i);
    expect(checkDiscountEligibility(discount({ requiresApproval: true, approvedAt: null }), ctx())).toMatch(/awaiting approval/i);
  });
  it("enforces total and per-customer usage limits", () => {
    expect(checkDiscountEligibility(discount({ usageLimitTotal: 3 }), ctx({ usage: { total: 3, byCustomer: 0 } }))).toMatch(/usage limit/i);
    expect(checkDiscountEligibility(discount({ usageLimitTotal: 3 }), ctx({ usage: { total: 2, byCustomer: 0 } }))).toBeNull();
    expect(checkDiscountEligibility(discount({ usageLimitPerCustomer: 1 }), ctx({ usage: { total: 5, byCustomer: 1 } }))).toMatch(/maximum number of times/i);
  });
  it("enforces customer- and venture-specific discounts", () => {
    expect(checkDiscountEligibility(discount({ category: "customer", customerId: "c2" }), ctx())).toMatch(/not available for this customer/i);
    expect(checkDiscountEligibility(discount({ category: "customer", customerId: "c1" }), ctx())).toBeNull();
    expect(checkDiscountEligibility(discount({ category: "venture", applicableVentureIds: ["other"] }), ctx())).toMatch(/venture/i);
    expect(checkDiscountEligibility(discount({ category: "plot", applicablePlotIds: ["p5"] }), ctx())).toMatch(/selected plot/i);
  });
  it("reports unknown codes in the pricing result", () => {
    const r = calculatePricing({
      ventureId: VENTURE, plots: [P1], customerId: null, now: NOW, currency: "INR", bookingAmountPercent: 10, allowStacking: false,
      maxDiscountPercent: 20, requested: [{ ref: "NOPE", discount: null }], usage: new Map(),
    });
    expect(r.ok).toBe(false);
    expect(r.lines[0].reason).toMatch(/invalid/i);
    expect(r.snapshot.discountTotal).toBe(0);
  });
  it("usage passed through calculatePricing blocks an exhausted discount", () => {
    const d = discount({ usageLimitTotal: 1 });
    const r = price([P1], [d], { usage: new Map([[d.id, { total: 1, byCustomer: 0 }]]) });
    expect(r.ok).toBe(false);
    expect(r.lines[0].reason).toMatch(/usage limit/i);
  });
});

describe("booking amount", () => {
  it("rounds the advance percentage to whole paise", () => {
    const r = price([P3], [discount({ value: 3.33 })], { bookingAmountPercent: 12.5 });
    const net = paise(r.snapshot.netAmount);
    expect(paise(r.snapshot.bookingAmount)).toBe(Math.round((net * 12.5) / 100));
    expect(Number.isInteger(paise(r.snapshot.bookingAmount))).toBe(true);
  });
  it("never exceeds the net amount", () => {
    const r = price([P1], [], { bookingAmountPercent: 100 });
    expect(r.snapshot.bookingAmount).toBe(r.snapshot.netAmount);
  });
});

describe("validityAt (revalidation at confirmation)", () => {
  it("checks time-validity at the request time, not now", () => {
    const d = discount({ expiresAt: new Date(NOW.getTime() - DAY) }); // expired by "now"
    const atRequest = new Date(NOW.getTime() - 2 * DAY);
    const r = price([P1], [d], { validityAt: atRequest });
    expect(r.ok).toBe(true);
    expect(r.snapshot.discountTotal).toBe(180_000);
    expect(r.snapshot.computedAt).toBe(NOW.toISOString());
    expect(price([P1], [d]).ok).toBe(false);
  });
  it("still re-checks status at confirmation (paused after request)", () => {
    const d = discount({ status: "paused" });
    const r = price([P1], [d], { validityAt: new Date(NOW.getTime() - DAY) });
    expect(r.ok).toBe(false);
    expect(r.lines[0].reason).toMatch(/paused/i);
  });
});
