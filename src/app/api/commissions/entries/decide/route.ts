import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { decideEntries } from "@/lib/services/commissions";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional(),
});

/** Approve or reject calculated ledger entries (commission.approve; never your own). */
export const POST = authed(async (req, ctx) => {
  const { ids, action, reason } = await body(req, schema);
  return json(await decideEntries(ctx, ids, action, reason));
});
