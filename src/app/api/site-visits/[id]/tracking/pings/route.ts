import { authed, body, json, rateLimit } from "@/lib/api";
import { recordPing, trackingPingSchema } from "@/lib/services/site-visits";

/**
 * Batched GPS fixes for an active trip: { points: [{ lat, lng, accuracy, recordedAt }] } (max 50).
 * The service drops fixes closer than 15 s apart; this guard caps request volume per user.
 */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  rateLimit(`site-visit-pings:${ctx.user.id}`, 20, 60_000);
  const { points } = await body(req, trackingPingSchema);
  return json(await recordPing(ctx, id, points));
});
