import type { Role } from "@/lib/auth/permissions";
import { canSelfApproveDiscount } from "@/lib/auth/permissions";
import type { DiscountCategory, DiscountValueType } from "./engine";

export interface DiscountDefinitionInput {
  valueType: DiscountValueType;
  category: DiscountCategory;
  value: number;
  maxDiscountAmount: number | null;
  requiresApproval: boolean;
  stackable: boolean;
}

export interface OrgDiscountSettings {
  maxDiscountPercent: number;
  approvalThresholdPercent: number;
  allowStacking: boolean;
}

export interface DiscountPolicyDecision {
  errors: string[];
  /** Whether a second person holding discount.approve must approve before activation. */
  requiresApproval: boolean;
  reasons: string[];
}

/**
 * Validates a discount definition against organization limits and decides whether
 * it needs approval. Called on create and update, on the server.
 */
export function evaluateDiscountPolicy(input: DiscountDefinitionInput, org: OrgDiscountSettings, role: Role): DiscountPolicyDecision {
  const errors: string[] = [];
  const reasons: string[] = [];

  if (!(input.value > 0)) errors.push("Discount value must be greater than zero");
  if (input.valueType === "percentage") {
    if (input.value > 100) errors.push("Percentage discount cannot exceed 100%");
    if (input.value > org.maxDiscountPercent) {
      errors.push(`Percentage discount exceeds the organization limit of ${org.maxDiscountPercent}%`);
    }
  }
  if (input.maxDiscountAmount !== null && !(input.maxDiscountAmount > 0)) {
    errors.push("Maximum discount amount must be greater than zero");
  }
  if (input.stackable && !org.allowStacking) {
    reasons.push("Stacking is disabled for this organization; the discount will not combine with others until it is enabled");
  }

  let requiresApproval = input.requiresApproval;
  if (input.requiresApproval) reasons.push("Approval explicitly required");
  if (input.valueType === "percentage" && input.value > org.approvalThresholdPercent) {
    requiresApproval = true;
    reasons.push(`Value above the ${org.approvalThresholdPercent}% approval threshold`);
  }
  if (input.valueType === "fixed_amount" && !canSelfApproveDiscount(role)) {
    requiresApproval = true;
    reasons.push("Fixed-amount discounts created by this role require approval");
  }
  if (!canSelfApproveDiscount(role)) {
    requiresApproval = true;
    if (!reasons.includes("Created by a role that cannot self-approve")) reasons.push("Created by a role that cannot self-approve");
  }

  return { errors, requiresApproval, reasons };
}
