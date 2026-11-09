/**
 * Configurable multi-level commission engine (pure — no I/O, safe for the browser).
 *
 * A plan defines N levels (1..12) and a BASIS:
 *  - per_sq_yard: each level has a ₹ rate per square yard; amount = rate × area.
 *  - percentage:  each level has a % of the sale value (booking net amount);
 *                 amount = sale value × % / 100.
 *
 * Distinguishes an employee's ORGANIZATIONAL RANK (commission_level 1..12, where
 * 1 = CEO) from their DEPTH in the upline chain of a particular sale (0 = seller,
 * 1 = direct manager, ...). Rates are looked up by rank; ranks above the plan's
 * level count are not on that plan's ladder. How many people are paid is limited
 * by the plan's max_payable_levels.
 *
 * Methods (applied to the basis value — ₹/sq yd or %):
 *  - differential: each payee earns (own level value − highest value already paid
 *    below them in this chain). The total never exceeds the top value paid.
 *  - full_rate: each payee earns their full level value.
 * In both methods each rank is paid at most once per booking, and nobody is paid
 * unless eligible (active, commission-eligible, level eligible in the plan, and
 * — for the seller — the plan pays selling employees).
 *
 * All money arithmetic is exact (integer paise / BigInt) so amounts match the
 * database's numeric rounding — round(x, 2), half away from zero.
 */

export type CommissionBasis = "per_sq_yard" | "percentage";
export type CalculationMethod = "differential" | "full_rate";

export const MIN_LEVELS = 1;
export const MAX_LEVELS = 12;

export const BASIS_LABEL: Record<CommissionBasis, string> = {
  per_sq_yard: "₹ per sq yd",
  percentage: "% of sale value",
};

/** Number of decimals allowed for a level value of each basis (mirrors the DB column scale). */
export const RATE_DECIMALS: Record<CommissionBasis, number> = { per_sq_yard: 2, percentage: 4 };

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh"];

/** Sensible default label for a level row: "Level 1 (CEO)", "Level 2 (First line)", … */
export function defaultLevelLabel(level: number): string {
  if (level === 1) return "Level 1 (CEO)";
  return `Level ${level} (${ORDINALS[level - 2] ?? `${level - 1}th`} line)`;
}

/** The original proposed eight-level ₹/sq yd rates. */
export const DEFAULT_LEVELS: { level: number; label: string; rate: number }[] = [
  { level: 1, label: "CEO", rate: 2000 },
  { level: 2, label: "First line", rate: 1800 },
  { level: 3, label: "Second line", rate: 1600 },
  { level: 4, label: "Third line", rate: 1400 },
  { level: 5, label: "Fourth line", rate: 1200 },
  { level: 6, label: "Fifth line", rate: 1000 },
  { level: 7, label: "Sixth line", rate: 800 },
  { level: 8, label: "Seventh line", rate: 400 },
];

export interface PlanPreset {
  id: string;
  label: string;
  basis: CommissionBasis;
  levels: { level: number; label: string; rate: number }[];
}

const presetLevels = (rates: number[]) => rates.map((rate, i) => ({ level: i + 1, label: defaultLevelLabel(i + 1), rate }));

export const PLAN_PRESETS: PlanPreset[] = [
  { id: "8-sqyd", label: "8-level per sq yd (2000…400)", basis: "per_sq_yard", levels: presetLevels(DEFAULT_LEVELS.map((l) => l.rate)) },
  { id: "6-sqyd", label: "6-level per sq yd (2000…500)", basis: "per_sq_yard", levels: presetLevels([2000, 1700, 1400, 1100, 800, 500]) },
  { id: "5-sqyd", label: "5-level per sq yd (2000…400)", basis: "per_sq_yard", levels: presetLevels([2000, 1600, 1200, 800, 400]) },
  { id: "5-pct", label: "5-level % of sale value (2%…0.5%)", basis: "percentage", levels: presetLevels([2, 1.5, 1, 0.75, 0.5]) },
];

export interface PlanLevel {
  level: number;
  label: string;
  /** ₹ per sq yd (per_sq_yard) or % of sale value (percentage). */
  rate: number;
  eligible: boolean;
}

export interface CommissionPlanInput {
  id: string;
  version: number;
  method: CalculationMethod;
  paySellingEmployee: boolean;
  ceoSeparateEntitlement: boolean;
  maxPayableLevels: number;
  levelCount: number;
  basis: CommissionBasis;
  levels: PlanLevel[];
}

export interface ChainMember {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  commissionLevel: number | null;
  active: boolean;
  commissionEligible: boolean;
}

/** What a sale is measured by: area (always known) and the sale value (required for percentage plans). */
export interface CommissionMeasure {
  areaSqYards: number;
  baseAmount?: number | null;
}

export interface CommissionLine {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  beneficiaryRole: "seller" | "upline" | "ceo_entitlement";
  chainDepth: number;
  employeeLevel: number;
  basis: CommissionBasis;
  levelRate: number; // ₹/sq yd or %
  baselineRate: number; // value already paid below (differential), 0 for full_rate
  payableRate: number; // ₹/sq yd or %
  areaSqYards: number;
  baseAmount: number | null; // sale value used for percentage plans
  amount: number;
}

export interface ChainDecision {
  employeeId: string;
  employeeCode: string;
  chainDepth: number;
  employeeLevel: number | null;
  paid: boolean;
  reason: string;
}

export interface CommissionResult {
  basis: CommissionBasis;
  areaSqYards: number;
  baseAmount: number | null;
  lines: CommissionLine[];
  decisions: ChainDecision[];
  totalAmount: number;
}

export interface PlanValidation {
  ok: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Exact arithmetic helpers
// ---------------------------------------------------------------------------
const pow10 = (d: number) => 10 ** d;
/** Fixed-point integer units of a value with `d` decimals. */
const units = (x: number, d: number): bigint => BigInt(Math.round(x * pow10(d)));
/** round(num / den) half away from zero, for non-negative inputs. */
const divRound = (num: bigint, den: bigint): bigint => (num * 2n + den) / (2n * den);

/**
 * Exact commission amount (₹, 2 decimals), identical to the database checks:
 *  - per_sq_yard: round(payable_rate × area, 2)
 *  - percentage:  round(base_amount × payable_rate_percent / 100, 2)
 */
export function commissionAmount(basis: CommissionBasis, payableRate: number, areaSqYards: number, baseAmount: number | null | undefined): number {
  if (payableRate <= 0) return 0;
  if (basis === "percentage") {
    const base = units(baseAmount ?? 0, 2); // paise
    const pct = units(payableRate, 4);
    // rupees = (base/100) × (pct/10^4) / 100  →  paise = base × pct / 10^6
    return Number(divRound(base * pct, 1_000_000n)) / 100;
  }
  const rate = units(payableRate, 2);
  const area = units(areaSqYards, 2);
  // paise = (rate/100 × area/100) × 100 = rate × area / 100
  return Number(divRound(rate * area, 100n)) / 100;
}

const sumMoney = (xs: number[]) => Number(xs.reduce((s, x) => s + units(x, 2), 0n)) / 100;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const fmtRate = (basis: CommissionBasis, r: number) => (basis === "percentage" ? `${r}%` : String(r));

/**
 * Plan-level validation: exactly levels 1..levelCount, non-negative values with
 * the basis' precision (≤ 100 for percentages), strictly descending (L1 > L2 > …).
 */
export function validatePlanLevels(
  levels: { level: number; rate: number }[],
  opts: { levelCount?: number; basis?: CommissionBasis } = {},
): PlanValidation {
  const levelCount = opts.levelCount ?? 8;
  const basis = opts.basis ?? "per_sq_yard";
  const errors: string[] = [];
  const word = basis === "percentage" ? "percentage" : "rate";
  if (!Number.isInteger(levelCount) || levelCount < MIN_LEVELS || levelCount > MAX_LEVELS) {
    errors.push(`Number of levels must be between ${MIN_LEVELS} and ${MAX_LEVELS}`);
  }
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  const nums = sorted.map((l) => l.level);
  if (sorted.length !== levelCount || nums.some((n, i) => n !== i + 1)) {
    errors.push(levelCount === 1 ? "Plan must define exactly level 1" : `Plan must define exactly levels 1 to ${levelCount}`);
  }
  const dec = RATE_DECIMALS[basis];
  for (const l of sorted) {
    if (!Number.isFinite(l.rate) || l.rate < 0) errors.push(`Level ${l.level} ${word} must be a non-negative number`);
    else if (basis === "percentage" && l.rate > 100) errors.push(`Level ${l.level} percentage cannot exceed 100%`);
    else if (Math.abs(Math.round(l.rate * pow10(dec)) - l.rate * pow10(dec)) > 1e-6) errors.push(`Level ${l.level} ${word} may have at most ${dec} decimals`);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (!(sorted[i].rate < sorted[i - 1].rate)) {
      errors.push(
        `Level ${sorted[i].level} ${word} (${fmtRate(basis, sorted[i].rate)}) must be lower than level ${sorted[i - 1].level} ${word} (${fmtRate(basis, sorted[i - 1].rate)})`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Resizes a level list to `count` rows (editor helper): keeps existing rows,
 * appends new rows with default labels and a descending suggested value.
 */
export function resizeLevels<T extends { level: number; label: string; rate: number; eligible: boolean }>(
  levels: T[],
  count: number,
  basis: CommissionBasis,
): PlanLevel[] {
  const n = Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, Math.trunc(count)));
  const sorted = [...levels].sort((a, b) => a.level - b.level).slice(0, n).map((l, i) => ({ level: i + 1, label: l.label, rate: l.rate, eligible: l.eligible }));
  const dec = RATE_DECIMALS[basis];
  while (sorted.length < n) {
    const level = sorted.length + 1;
    const prev = sorted[sorted.length - 1]?.rate;
    const start = basis === "percentage" ? 2 : 2000;
    const suggestion = prev === undefined || !Number.isFinite(prev) ? start : Math.round((prev / 2) * pow10(dec)) / pow10(dec);
    sorted.push({ level, label: defaultLevelLabel(level), rate: suggestion, eligible: true });
  }
  return sorted;
}

/**
 * A strictly descending starting point for `count` levels of a basis
 * (₹2,000 → ₹400 per sq yd, or 2% → 0.5% of sale value), for the editor.
 */
export function suggestedLevels(basis: CommissionBasis, count: number): PlanLevel[] {
  const n = Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, Math.trunc(count)));
  const preset = PLAN_PRESETS.find((p) => p.basis === basis && p.levels.length === n);
  if (preset) return preset.levels.map((l) => ({ ...l, eligible: true }));
  const [top, bottom, step] = basis === "percentage" ? [2, 0.5, 0.01] : [2000, 400, 10];
  return Array.from({ length: n }, (_, i) => {
    const raw = n === 1 ? top : top - ((top - bottom) * i) / (n - 1);
    const rate = Math.round(Math.round(raw / step) * step * 100) / 100;
    return { level: i + 1, label: defaultLevelLabel(i + 1), rate, eligible: true };
  });
}

// ---------------------------------------------------------------------------
// Plan scope selection (which approved plan applies to a sale)
// ---------------------------------------------------------------------------
export interface PlanScopeCandidate {
  id: string;
  propertyType: string; // 'any' or a property type
  ventureIds: string[]; // empty = all ventures
  effectiveFrom: Date | string;
}

/**
 * 0 = not applicable. Otherwise higher is more specific:
 * 4 venture-specific + matching property type > 3 venture-specific 'any'
 * > 2 org-wide matching property type > 1 org-wide 'any'.
 */
export function scopeSpecificity(c: Pick<PlanScopeCandidate, "propertyType" | "ventureIds">, target: { ventureId: string; propertyType: string }): number {
  const ventureSpecific = c.ventureIds.length > 0;
  if (ventureSpecific && !c.ventureIds.includes(target.ventureId)) return 0;
  if (c.propertyType !== "any" && c.propertyType !== target.propertyType) return 0;
  const typed = c.propertyType !== "any";
  return (ventureSpecific ? 2 : 0) + (typed ? 2 : 1);
}

/** Picks the most specific applicable plan (ties: fewer ventures, then the latest effective date). */
export function selectApplicablePlan<T extends PlanScopeCandidate>(candidates: T[], target: { ventureId: string; propertyType: string }): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scopeSpecificity(c, target);
    if (s === 0) continue;
    if (
      !best ||
      s > bestScore ||
      (s === bestScore &&
        (c.ventureIds.length < best.ventureIds.length ||
          (c.ventureIds.length === best.ventureIds.length && new Date(c.effectiveFrom).getTime() > new Date(best.effectiveFrom).getTime())))
    ) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** Stable key identifying a plan scope (venture ids are stored sorted). */
export function scopeKey(propertyType: string, ventureIds: string[]): string {
  return `${propertyType}|${[...ventureIds].sort().join(",")}`;
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------
/**
 * @param chain   seller first, then reporting managers upward (depth = index).
 * @param measure area in sq yd (number) or { areaSqYards, baseAmount } — the sale value is required for percentage plans.
 * @param ceo     the organization's Level-1 employee, used for a separate CEO entitlement.
 */
export function calculateCommissions(
  plan: CommissionPlanInput,
  chain: ChainMember[],
  measure: number | CommissionMeasure,
  ceo: ChainMember | null = null,
): CommissionResult {
  const m: CommissionMeasure = typeof measure === "number" ? { areaSqYards: measure, baseAmount: null } : measure;
  const basis: CommissionBasis = plan.basis ?? "per_sq_yard";
  const levelCount = plan.levelCount ?? plan.levels.length;
  const areaSqYards = m.areaSqYards;
  const baseAmount = m.baseAmount ?? null;
  if (basis === "percentage" && (baseAmount === null || !Number.isFinite(baseAmount) || baseAmount < 0)) {
    throw new Error("A sale value is required to calculate a percentage-based commission");
  }
  const dec = RATE_DECIMALS[basis];
  const toNum = (u: bigint) => Number(u) / pow10(dec);
  const levelMap = new Map(plan.levels.map((l) => [l.level, l]));
  const lines: CommissionLine[] = [];
  const decisions: ChainDecision[] = [];
  const paidLevels = new Set<number>();
  let baseline = 0n;
  let payees = 0;
  const ceoSeparate = plan.ceoSeparateEntitlement;

  chain.forEach((mem, depth) => {
    const decide = (paid: boolean, reason: string) =>
      decisions.push({ employeeId: mem.employeeId, employeeCode: mem.employeeCode, chainDepth: depth, employeeLevel: mem.commissionLevel, paid, reason });

    if (mem.commissionLevel === null) return decide(false, "Not on the commission ladder");
    if (mem.commissionLevel > levelCount) return decide(false, `Level ${mem.commissionLevel} is not on this plan's ${levelCount}-level ladder`);
    const pl = levelMap.get(mem.commissionLevel);
    if (!pl) return decide(false, "Level not configured in plan");
    if (ceoSeparate && mem.commissionLevel === 1) return decide(false, "CEO paid as separate entitlement");
    if (depth === 0 && !plan.paySellingEmployee) return decide(false, "Plan does not pay the selling employee");
    if (!mem.active) return decide(false, "Employee not active");
    if (!mem.commissionEligible) return decide(false, "Employee not commission-eligible");
    if (!pl.eligible) return decide(false, `Level ${pl.level} not eligible in this plan`);
    if (paidLevels.has(pl.level)) return decide(false, `Level ${pl.level} already paid in this chain`);
    if (payees >= plan.maxPayableLevels) return decide(false, `Plan pays at most ${plan.maxPayableLevels} levels`);

    const rateU = units(pl.rate, dec);
    const payU = plan.method === "differential" ? (rateU > baseline ? rateU - baseline : 0n) : rateU;
    if (payU <= 0n) return decide(false, plan.method === "differential" ? "No differential above rates already paid below" : "Level rate is zero");
    const payable = toNum(payU);

    lines.push({
      employeeId: mem.employeeId,
      employeeCode: mem.employeeCode,
      fullName: mem.fullName,
      beneficiaryRole: depth === 0 ? "seller" : "upline",
      chainDepth: depth,
      employeeLevel: pl.level,
      basis,
      levelRate: toNum(rateU),
      baselineRate: plan.method === "differential" ? toNum(baseline) : 0,
      payableRate: payable,
      areaSqYards,
      baseAmount,
      amount: commissionAmount(basis, payable, areaSqYards, baseAmount),
    });
    paidLevels.add(pl.level);
    payees++;
    if (plan.method === "differential" && rateU > baseline) baseline = rateU;
    decide(true, "Paid");
  });

  if (ceoSeparate && ceo && ceo.commissionLevel === 1) {
    const pl = levelMap.get(1);
    if (pl && pl.eligible && ceo.active && ceo.commissionEligible && pl.rate > 0) {
      const idx = chain.findIndex((c) => c.employeeId === ceo.employeeId);
      const rate = toNum(units(pl.rate, dec));
      lines.push({
        employeeId: ceo.employeeId,
        employeeCode: ceo.employeeCode,
        fullName: ceo.fullName,
        beneficiaryRole: "ceo_entitlement",
        chainDepth: idx >= 0 ? idx : chain.length,
        employeeLevel: 1,
        basis,
        levelRate: rate,
        baselineRate: 0,
        payableRate: rate,
        areaSqYards,
        baseAmount,
        amount: commissionAmount(basis, rate, areaSqYards, baseAmount),
      });
    }
  }

  return { basis, areaSqYards, baseAmount, lines, decisions, totalAmount: sumMoney(lines.map((l) => l.amount)) };
}
