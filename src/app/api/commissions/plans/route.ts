import { authed, json } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { isUuid } from "@/lib/services/common";
import { createPlanDraft, listPlans, type PlanInput } from "@/lib/services/commissions";

export const GET = authed(async (_req, ctx) => json(await listPlans(ctx)));

/**
 * Creates a new draft version.
 *  - `{ fromPlanId }`: "Edit plan" — a copy of that version with the same scope;
 *  - a full plan definition (has `levels`): a new plan / scope;
 *  - empty body: a copy of the latest organization-wide plan (or the proposed defaults).
 * The definition is validated by the service.
 */
export const POST = authed(async (req, ctx) => {
  const raw: unknown = await req.json().catch(() => ({}));
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof obj.fromPlanId === "string") {
    if (!isUuid(obj.fromPlanId)) throw badRequest("Invalid plan id");
    return json(await createPlanDraft(ctx, undefined, { fromPlanId: obj.fromPlanId }), 201);
  }
  const input = "levels" in obj ? (obj as unknown as PlanInput) : undefined;
  return json(await createPlanDraft(ctx, input), 201);
});
