import { authed, body, json, rateLimit } from "@/lib/api";
import { holdSchema, listActiveHolds, placeHold } from "@/lib/services/bookings";

/** POST /api/bookings/hold — temporary multi-plot hold (idempotent, concurrency-safe). */
export const POST = authed(async (req, ctx) => {
  rateLimit(`hold:${ctx.user.id}`, 30, 60_000);
  const input = await body(req, holdSchema);
  const result = await placeHold(ctx, input);
  return json(result, result.replayed ? 200 : 201);
});

export const GET = authed(async (_req, ctx) => json(await listActiveHolds(ctx)));
