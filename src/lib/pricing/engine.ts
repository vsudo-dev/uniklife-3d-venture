/**
 * Server-side pricing & discount engine (pure — no I/O). Supports single- and
 * multi-plot bookings.
 *
 * All arithmetic is done in integer paise (1/100 of the currency unit) to avoid
 * floating-point drift. Discount amounts are allocated to individual plots so
 * that per-plot lines always sum exactly to the booking totals.
 */

export type DiscountStatus = "draft" | "pending_approval" | "active" | "paused" | "rejected" | "archived";
export type DiscountValueType = "fixed_amount" | "percentage";
export type DiscountCategory = "general" | "coupon" | "venture" | "plot" | "promotional" | "campaign" | "customer";

export interface DiscountRecord {
  id: string;
  name: string;
  code: string | null;
  valueType: DiscountValueType;
  category: DiscountCategory;
  value: number;
  maxDiscountAmount: number | null;
  startsAt: Date;
  expiresAt: Date | null;
  applicableVentureIds: string[];
  applicablePlotIds: string[];
  customerId: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  stackable: boolean;
  requiresApproval: boolean;
  status: DiscountStatus;
  approvedAt: Date | null;
}

export interface DiscountUsage {
  total: number; // reserved + confirmed redemptions (excluding the booking being priced)
  byCustomer: number;
}

export interface PricingPlot {
  id: string;
  plotNumber: string;
  areaSqYards: number;
  pricePerSqYard: number;
}

export interface PricingInput {
  ventureId: string;
  plots: PricingPlot[];
  customerId: string | null;
  now: Date;
  /** Time-validity of discounts is checked at this instant (defaults to `now`). */
  validityAt?: Date;
  currency: string;
  bookingAmountPercent: number;
  allowStacking: boolean;
  /** Organization ceiling on the total discount, as % of the base amount. */
  maxDiscountPercent: number;
  /** Requested discounts, in the order applied. `ref` is the code or id supplied. */
  requested: { ref: string; discount: DiscountRecord | null }[];
  usage: Map<string, DiscountUsage>;
}

export interface DiscountLine {
  ref: string;
  discountId: string | null;
  name: string | null;
  code: string | null;
  valueType: DiscountValueType | null;
  value: number | null;
  ok: boolean;
  reason?: string;
  amount: number;
}

export interface PlotPricingLine {
  plotId: string;
  plotNumber: string;
  areaSqYards: number;
  pricePerSqYard: number;
  baseAmount: number;
  discountAmount: number;
  netAmount: number;
}

export interface PricingSnapshot {
  version: 2;
  computedAt: string;
  currency: string;
  ventureId: string;
  plots: PlotPricingLine[];
  totalAreaSqYards: number;
  baseAmount: number;
  discounts: { discountId: string; code: string | null; name: string; valueType: DiscountValueType; value: number; amount: number }[];
  discountTotal: number;
  cappedByOrganizationLimit: boolean;
  netAmount: number;
  bookingAmountPercent: number;
  bookingAmount: number;
}

export interface PricingResult {
  ok: boolean; // every requested discount is valid
  lines: DiscountLine[];
  snapshot: PricingSnapshot;
}

export const toPaise = (amount: number) => Math.round(amount * 100);
export const fromPaise = (paise: number) => Math.round(paise) / 100;

/** Base price of one plot in paise. */
export function plotBasePaise(p: PricingPlot): number {
  return Math.round(toPaise(p.pricePerSqYard) * p.areaSqYards);
}

/** Splits `total` across weights proportionally; remainder goes to the last bucket. Sum is exact. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  let remaining = total;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return remaining;
    const part = Math.floor((total * w) / sum);
    remaining -= part;
    return part;
  });
}

/** Checks a single discount's eligibility, independent of other discounts. */
export function checkDiscountEligibility(
  d: DiscountRecord,
  ctx: { ventureId: string; plotIds: string[]; customerId: string | null; now: Date; usage?: DiscountUsage },
): string | null {
  switch (d.status) {
    case "active":
      break;
    case "pending_approval":
      return "Discount is awaiting approval";
    case "paused":
      return "Discount is paused";
    case "rejected":
      return "Discount was rejected";
    case "archived":
      return "Discount is no longer available";
    default:
      return "Discount is not active";
  }
  if (d.requiresApproval && !d.approvedAt) return "Discount is awaiting approval";
  if (ctx.now < d.startsAt) return "Discount is not yet valid";
  if (d.expiresAt && ctx.now >= d.expiresAt) return "Discount has expired";
  if (d.applicableVentureIds.length > 0 && !d.applicableVentureIds.includes(ctx.ventureId)) {
    return "Discount does not apply to this venture";
  }
  if (d.applicablePlotIds.length > 0 && !ctx.plotIds.some((id) => d.applicablePlotIds.includes(id))) {
    return "Discount does not apply to the selected plot(s)";
  }
  if (d.customerId && d.customerId !== ctx.customerId) return "Discount is not available for this customer";
  const usage = ctx.usage ?? { total: 0, byCustomer: 0 };
  if (d.usageLimitTotal !== null && usage.total >= d.usageLimitTotal) return "Discount usage limit has been reached";
  if (d.usageLimitPerCustomer !== null && ctx.customerId && usage.byCustomer >= d.usageLimitPerCustomer) {
    return "This customer has already used this discount the maximum number of times";
  }
  return null;
}

/** Discount for one discount across the booking's plots, as per-plot paise allocations. */
export function discountAllocation(d: DiscountRecord, plots: PricingPlot[]): number[] {
  const bases = plots.map(plotBasePaise);
  const eligible = plots.map((p) => d.applicablePlotIds.length === 0 || d.applicablePlotIds.includes(p.id));
  const eligibleBases = bases.map((b, i) => (eligible[i] ? b : 0));
  const eligibleTotal = eligibleBases.reduce((s, b) => s + b, 0);

  let alloc: number[];
  if (d.valueType === "percentage") {
    alloc = eligibleBases.map((b) => Math.round((b * d.value) / 100));
  } else {
    alloc = allocate(Math.min(toPaise(d.value), eligibleTotal), eligibleBases);
  }
  const total = alloc.reduce((s, a) => s + a, 0);
  if (d.maxDiscountAmount !== null && total > toPaise(d.maxDiscountAmount)) {
    alloc = allocate(toPaise(d.maxDiscountAmount), alloc);
  }
  return alloc;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const { plots, now } = input;
  if (plots.length === 0) throw new Error("calculatePricing requires at least one plot");
  const validityAt = input.validityAt ?? now;
  const bases = plots.map(plotBasePaise);
  const basePaise = bases.reduce((s, b) => s + b, 0);
  const plotIds = plots.map((p) => p.id);

  const lines: DiscountLine[] = [];
  const accepted: { d: DiscountRecord; alloc: number[] }[] = [];
  const seen = new Set<string>();

  for (const { ref, discount: d } of input.requested) {
    if (!d) {
      lines.push({ ref, discountId: null, name: null, code: null, valueType: null, value: null, ok: false, reason: "Discount code is invalid", amount: 0 });
      continue;
    }
    const line: DiscountLine = { ref, discountId: d.id, name: d.name, code: d.code, valueType: d.valueType, value: d.value, ok: false, amount: 0 };
    lines.push(line);
    if (seen.has(d.id)) {
      line.reason = "Discount already applied";
      continue;
    }
    seen.add(d.id);

    const reason = checkDiscountEligibility(d, {
      ventureId: input.ventureId,
      plotIds,
      customerId: input.customerId,
      now: validityAt,
      usage: input.usage.get(d.id),
    });
    if (reason) {
      line.reason = reason;
      continue;
    }
    if (accepted.length > 0) {
      if (!input.allowStacking) {
        line.reason = "Discount stacking is disabled — only one discount can be applied";
        continue;
      }
      if (!d.stackable || !accepted.every((a) => a.d.stackable)) {
        line.reason = "This discount cannot be combined with other discounts";
        continue;
      }
    }
    const alloc = discountAllocation(d, plots);
    accepted.push({ d, alloc });
    line.ok = true;
  }

  // Per-plot totals; a plot's discount never exceeds its base.
  let perPlot = plots.map((_, i) => Math.min(bases[i], accepted.reduce((s, a) => s + a.alloc[i], 0)));
  let discountPaise = perPlot.reduce((s, x) => s + x, 0);

  const capPaise = Math.round((basePaise * input.maxDiscountPercent) / 100);
  let capped = false;
  if (discountPaise > capPaise) {
    capped = true;
    perPlot = allocate(capPaise, perPlot);
    discountPaise = capPaise;
  }

  // Attribute the final per-booking discount back to each accepted discount line.
  const rawTotals = accepted.map((a) => a.alloc.reduce((s, x) => s + x, 0));
  const finalPerDiscount = allocate(discountPaise, rawTotals);
  accepted.forEach((a, i) => {
    const line = lines.find((l) => l.discountId === a.d.id && l.ok);
    if (line) line.amount = fromPaise(finalPerDiscount[i]);
  });

  const netPaise = basePaise - discountPaise;
  const bookingPaise = Math.min(netPaise, Math.round((netPaise * input.bookingAmountPercent) / 100));
  const totalArea = Math.round(plots.reduce((s, p) => s + p.areaSqYards, 0) * 100) / 100;

  const snapshot: PricingSnapshot = {
    version: 2,
    computedAt: now.toISOString(),
    currency: input.currency,
    ventureId: input.ventureId,
    plots: plots.map((p, i) => ({
      plotId: p.id,
      plotNumber: p.plotNumber,
      areaSqYards: p.areaSqYards,
      pricePerSqYard: p.pricePerSqYard,
      baseAmount: fromPaise(bases[i]),
      discountAmount: fromPaise(perPlot[i]),
      netAmount: fromPaise(bases[i] - perPlot[i]),
    })),
    totalAreaSqYards: totalArea,
    baseAmount: fromPaise(basePaise),
    discounts: accepted.map((a, i) => ({
      discountId: a.d.id,
      code: a.d.code,
      name: a.d.name,
      valueType: a.d.valueType,
      value: a.d.value,
      amount: fromPaise(finalPerDiscount[i]),
    })),
    discountTotal: fromPaise(discountPaise),
    cappedByOrganizationLimit: capped,
    netAmount: fromPaise(netPaise),
    bookingAmountPercent: input.bookingAmountPercent,
    bookingAmount: fromPaise(bookingPaise),
  };

  return { ok: lines.every((l) => l.ok), lines, snapshot };
}
