export type Category = "general" | "coupon" | "venture" | "plot" | "promotional" | "campaign" | "customer";

export interface DiscountFormValues {
  name: string;
  code: string;
  valueType: "fixed_amount" | "percentage";
  category: Category;
  value: string;
  maxDiscountAmount: string;
  startsAt: string; // datetime-local
  expiresAt: string; // datetime-local
  applicableVentureIds: string[];
  applicablePlotIds: string[];
  customerId: string | null;
  customerLabel: string | null;
  campaignName: string;
  usageLimitTotal: string;
  usageLimitPerCustomer: string;
  stackable: boolean;
  requiresApproval: boolean;
}

export const EMPTY_DISCOUNT: DiscountFormValues = {
  name: "", code: "", valueType: "percentage", category: "general", value: "", maxDiscountAmount: "", startsAt: "", expiresAt: "",
  applicableVentureIds: [], applicablePlotIds: [], customerId: null, customerLabel: null, campaignName: "", usageLimitTotal: "",
  usageLimitPerCustomer: "", stackable: false, requiresApproval: false,
};

/** ISO/Date → value for <input type="datetime-local"> in India time (IST, UTC+5:30). */
export function toLocalInput(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16);
}

/** Maps a discounts row (snake_case) to form values. */
export function discountRowToForm(d: Record<string, unknown>): DiscountFormValues {
  const n = (x: unknown) => (x === null || x === undefined ? "" : String(Number(x)));
  return {
    name: String(d.name ?? ""),
    code: (d.code as string) ?? "",
    valueType: d.value_type as DiscountFormValues["valueType"],
    category: d.category as Category,
    value: n(d.value),
    maxDiscountAmount: n(d.max_discount_amount),
    startsAt: toLocalInput(d.starts_at),
    expiresAt: toLocalInput(d.expires_at),
    applicableVentureIds: (d.applicable_venture_ids as string[]) ?? [],
    applicablePlotIds: (d.applicable_plot_ids as string[]) ?? [],
    customerId: (d.customer_id as string) ?? null,
    customerLabel: (d.customer_name as string) ?? null,
    campaignName: (d.campaign_name as string) ?? "",
    usageLimitTotal: n(d.usage_limit_total),
    usageLimitPerCustomer: n(d.usage_limit_per_customer),
    stackable: Boolean(d.stackable),
    requiresApproval: Boolean(d.requires_approval),
  };
}
