import { authed, body, json } from "@/lib/api";
import { createDiscount, discountInputSchema, listDiscounts } from "@/lib/services/discounts";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json(await listDiscounts(ctx, { status: sp.get("status") ?? undefined, q: sp.get("q")?.slice(0, 60) ?? undefined }));
});

/** Creates a discount; the response includes the server policy decision (approval required + reasons). */
export const POST = authed(async (req, ctx) => {
  const input = await body(req, discountInputSchema);
  return json(await createDiscount(ctx, input), 201);
});
