import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { decideDiscount } from "@/lib/services/discounts";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "pause", "reactivate", "archive"]),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Approve / reject (discount.approve, four-eyes) or pause / reactivate / archive (discount.create). */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Discount");
  const { action, note } = await body(req, decisionSchema);
  return json(await decideDiscount(ctx, id, action, note || undefined));
});
