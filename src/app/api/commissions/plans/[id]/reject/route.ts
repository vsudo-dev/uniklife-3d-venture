import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { rejectPlan } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({ note: z.string().trim().min(5, "A rejection reason is required").max(2000) });

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Commission plan");
  const { note } = await body(req, schema);
  return json(await rejectPlan(ctx, id, note));
});
