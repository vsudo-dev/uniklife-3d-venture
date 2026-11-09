import { authed, body, json } from "@/lib/api";
import { discountInputSchema, previewDiscountPolicy } from "@/lib/services/discounts";

/** Dry-run of the discount policy (org max %, approval threshold, role authority). Nothing is saved. */
export const POST = authed(async (req, ctx) => json(await previewDiscountPolicy(ctx, await body(req, discountInputSchema))));
