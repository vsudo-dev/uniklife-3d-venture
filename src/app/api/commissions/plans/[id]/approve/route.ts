import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { approvePlan } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({
  effectiveFrom: z.string().datetime({ offset: true }).optional().nullable(),
  note: z.string().trim().max(2000).optional(),
});

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Commission plan");
  return json(await approvePlan(ctx, id, await body(req, schema)));
});
