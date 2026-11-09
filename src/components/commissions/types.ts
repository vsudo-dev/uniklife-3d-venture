import { PROPERTY_TYPES } from "@/lib/viewer-settings";
import type { CommissionBasis } from "@/lib/commissions/engine";

export interface PlanLevelDraft {
  level: number;
  label: string;
  rate: number;
  eligible: boolean;
}

/** Mirrors planInputSchema in the commissions service. */
export interface PlanDraft {
  name: string;
  calculationMethod: "differential" | "full_rate";
  paySellingEmployee: boolean;
  ceoSeparateEntitlement: boolean;
  maxPayableLevels: number;
  levelCount: number;
  basis: CommissionBasis;
  propertyType: string; // 'any' or a property type
  ventureIds: string[]; // empty = all ventures
  notes: string | null;
  levels: PlanLevelDraft[];
}

export interface PlanSummary {
  id: string;
  version: number;
  name: string;
  status: string;
  basis: CommissionBasis;
  levelCount: number;
  scopeLabel: string;
}

export interface VentureOption {
  id: string;
  name: string;
  propertyType: string;
}

export const PROPERTY_TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: "any", label: "Any property type" },
  ...PROPERTY_TYPES.map((p) => ({ id: p.id as string, label: p.label as string })),
];

export const propertyTypeLabel = (id: string) => PROPERTY_TYPE_OPTIONS.find((p) => p.id === id)?.label ?? id;

export function scopeLabel(propertyType: string, ventureNames: string[]): string {
  const where = ventureNames.length === 0 ? "All ventures" : ventureNames.join(", ");
  return `${where} · ${propertyTypeLabel(propertyType)}`;
}

const inrFmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Formats a level value in its basis: ₹2,000 (per sq yd) or 1.5% (of sale value). */
export function fmtRate(basis: CommissionBasis, n: number): string {
  if (!Number.isFinite(n)) return "—";
  return basis === "percentage" ? `${Number(n.toFixed(4)).toLocaleString("en-IN", { maximumFractionDigits: 4 })}%` : inrFmt(n);
}

export const fmtInr = inrFmt;

export const METHOD_HELP: Record<PlanDraft["calculationMethod"], { title: string; body: string }> = {
  differential: {
    title: "Differential (recommended)",
    body:
      "Each payee earns their own level value (₹ per sq yd or % of sale value) minus the highest value already paid below them in the same sale. The total never exceeds the highest level value reached in the chain. A manager whose level value is not above what was already paid below earns nothing on that sale.",
  },
  full_rate: {
    title: "Full rate",
    body:
      "Every eligible person in the chain earns their full level value. The total cost is the sum of all paid levels (₹10,200 per sq yd for a complete eight-level chain with the proposed defaults).",
  },
};
