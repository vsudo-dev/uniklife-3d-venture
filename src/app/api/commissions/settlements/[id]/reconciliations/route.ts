import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { addManualReconciliation } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({
  externalReference: z.string().trim().min(3, "Reference is required").max(200),
  reportedAmount: z.coerce.number().min(0).max(1e13),
});

/** Records a manual finance reconciliation (matched/mismatch is computed server-side). */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Settlement");
  return json(await addManualReconciliation(ctx, id, await body(req, schema)), 201);
});
