import { authed, body, json, rateLimit } from "@/lib/api";
import { validateDiscounts, validateSchema } from "@/lib/services/discounts";

/** POST /api/discounts/validate — server-side discount validation & price preview. */
export const POST = authed(async (req, ctx) => {
  rateLimit(`discount-validate:${ctx.user.id}`, 40, 60_000); // limits code guessing
  return json(await validateDiscounts(ctx, await body(req, validateSchema)));
});
