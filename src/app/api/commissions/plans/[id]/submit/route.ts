import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { submitPlan } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({ note: z.string().trim().max(2000).optional() });

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Commission plan");
  const { note } = await body(req, schema);
  return json(await submitPlan(ctx, id, note));
});
