import { authed, body, json } from "@/lib/api";
import { discountInputSchema, getDiscount, updateDiscount } from "@/lib/services/discounts";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Discount");
  return json(await getDiscount(ctx, id));
});

export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Discount");
  const input = await body(req, discountInputSchema);
  return json(await updateDiscount(ctx, id, input));
});
