import { authed, body, json } from "@/lib/api";
import { applyTrackingAction, getVisitTracking, trackingActionSchema } from "@/lib/services/site-visits";

/** Trip timeline + summary (assigned employee, their upline managers, org admins / venture managers). */
export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getVisitTracking(ctx, id)));

/**
 * Stage action: { action: start | arrive | start_visit | complete | leave | return | cancel,
 *   consent?, lat?, lng?, accuracy?, recordedAt?, outcome?, reason? }
 * `start` requires consent: true. Managers correcting someone else's trip must send a reason.
 */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => json(await applyTrackingAction(ctx, id, await body(req, trackingActionSchema))));
