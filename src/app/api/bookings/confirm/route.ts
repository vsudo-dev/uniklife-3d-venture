import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { confirmBookingByStaff } from "@/lib/services/bookings";

/**
 * POST /api/bookings/confirm — staff confirmation, permitted ONLY when server-verified
 * payments (gateway webhook or staff-verified offline payment) cover the advance.
 * A customer-facing "payment successful" screen can never confirm a booking.
 */
export const POST = authed(async (req, ctx) => {
  const { bookingId } = await body(req, z.object({ bookingId: z.string().uuid() }));
  return json(await confirmBookingByStaff(ctx, bookingId));
});
