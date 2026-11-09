import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { cancelBooking } from "@/lib/services/bookings";

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  const { reason } = await body(req, z.object({ reason: z.string().trim().min(5).max(500) }));
  return json(await cancelBooking(ctx, id, reason));
});
