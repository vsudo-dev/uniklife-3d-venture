import { describe, expect, it } from "vitest";
import { evaluateDiscountPolicy, type DiscountDefinitionInput } from "@/lib/pricing/discount-policy";

const ORG = { maxDiscountPercent: 20, approvalThresholdPercent: 5, allowStacking: false };
const def = (over: Partial<DiscountDefinitionInput> = {}): DiscountDefinitionInput => ({
  valueType: "percentage", category: "general", value: 5, maxDiscountAmount: null, requiresApproval: false, stackable: false, ...over,
});

describe("evaluateDiscountPolicy", () => {
  it("rejects a percentage above the organization maximum", () => {
    const r = evaluateDiscountPolicy(def({ value: 25 }), ORG, "org_admin");
    expect(r.errors.join(" ")).toMatch(/organization limit of 20%/);
  });

  it("rejects percentages above 100% and non-positive values", () => {
    expect(evaluateDiscountPolicy(def({ value: 120 }), { ...ORG, maxDiscountPercent: 100 }, "org_admin").errors.join(" ")).toMatch(/100%/);
    expect(evaluateDiscountPolicy(def({ value: 0 }), ORG, "org_admin").errors.length).toBeGreaterThan(0);
    expect(evaluateDiscountPolicy(def({ maxDiscountAmount: 0 }), ORG, "org_admin").errors.join(" ")).toMatch(/Maximum discount amount/);
  });

  it("requires approval above the threshold, even for org admins", () => {
    const r = evaluateDiscountPolicy(def({ value: 7.5 }), ORG, "org_admin");
    expect(r.errors).toEqual([]);
    expect(r.requiresApproval).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/5% approval threshold/);
  });

  it("sales managers always require approval", () => {
    const pct = evaluateDiscountPolicy(def({ value: 2 }), ORG, "sales_manager");
    expect(pct.requiresApproval).toBe(true);
    expect(pct.reasons.join(" ")).toMatch(/cannot self-approve/);
    const fixed = evaluateDiscountPolicy(def({ valueType: "fixed_amount", value: 10_000 }), ORG, "sales_manager");
    expect(fixed.requiresApproval).toBe(true);
    expect(fixed.reasons.join(" ")).toMatch(/Fixed-amount/);
  });

  it("org admins within the threshold are auto-active", () => {
    const at = evaluateDiscountPolicy(def({ value: 5 }), ORG, "org_admin");
    expect(at.errors).toEqual([]);
    expect(at.requiresApproval).toBe(false);
    const fixed = evaluateDiscountPolicy(def({ valueType: "fixed_amount", value: 50_000 }), ORG, "org_admin");
    expect(fixed.requiresApproval).toBe(false);
    expect(evaluateDiscountPolicy(def({ value: 3 }), ORG, "platform_admin").requiresApproval).toBe(false);
  });

  it("honours an explicit approval requirement", () => {
    const r = evaluateDiscountPolicy(def({ value: 1, requiresApproval: true }), ORG, "org_admin");
    expect(r.requiresApproval).toBe(true);
    expect(r.reasons).toContain("Approval explicitly required");
  });

  it("warns that stackable has no effect while stacking is disabled", () => {
    const r = evaluateDiscountPolicy(def({ stackable: true }), ORG, "org_admin");
    expect(r.errors).toEqual([]);
    expect(r.reasons.join(" ")).toMatch(/Stacking is disabled/);
    expect(evaluateDiscountPolicy(def({ stackable: true }), { ...ORG, allowStacking: true }, "org_admin").reasons).toEqual([]);
  });
});
