import { authed, body, json, rateLimit } from "@/lib/api";
import { bookingRequestSchema, listBookings, requestBooking } from "@/lib/services/bookings";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json(await listBookings(ctx, { status: sp.get("status") ?? undefined, ventureId: sp.get("venture") ?? undefined, q: sp.get("q") ?? undefined }));
});

/** POST /api/bookings — booking request from an active hold (server-side pricing & discount validation). */
export const POST = authed(async (req, ctx) => {
  rateLimit(`booking:${ctx.user.id}`, 20, 60_000);
  const input = await body(req, bookingRequestSchema);
  const result = await requestBooking(ctx, input);
  return json(result, result.replayed ? 200 : 201);
});
