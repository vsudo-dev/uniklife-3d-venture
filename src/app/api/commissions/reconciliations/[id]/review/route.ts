import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { reviewReconciliation } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({ decision: z.enum(["accept", "reject"]), note: z.string().trim().max(1000).optional() });

/** Accepting a MATCHED reconciliation (authorized human) marks the settlement paid; mismatches can only be rejected. */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Reconciliation");
  const { decision, note } = await body(req, schema);
  return json(await reviewReconciliation(ctx, id, decision, note));
});
