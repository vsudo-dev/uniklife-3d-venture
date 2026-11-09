import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { settlementAction } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({
  action: z.enum(["submit", "approve", "request_finance", "cancel"]),
  note: z.string().trim().max(1000).optional(),
});

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Settlement");
  const { action, note } = await body(req, schema);
  return json(await settlementAction(ctx, id, action, note));
});
