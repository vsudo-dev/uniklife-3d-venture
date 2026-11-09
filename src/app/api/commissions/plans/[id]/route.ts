import { authed, body, json } from "@/lib/api";
import { getPlan, planInputSchema, updatePlanDraft } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Commission plan");
  return json(await getPlan(ctx, id));
});

export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Commission plan");
  return json(await updatePlanDraft(ctx, id, await body(req, planInputSchema)));
});
