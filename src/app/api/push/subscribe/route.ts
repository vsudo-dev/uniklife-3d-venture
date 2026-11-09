import { authed, body, json, rateLimit } from "@/lib/api";
import { subscribePush, subscriptionSchema } from "@/lib/push";

/** POST — store this browser's push subscription for the current user + organization (https endpoints only). */
export const POST = authed(async (req, ctx) => {
  rateLimit(`push-sub:${ctx.user.id}`, 20, 60 * 60_000);
  return json(await subscribePush(ctx, await body(req, subscriptionSchema)), 201);
});
