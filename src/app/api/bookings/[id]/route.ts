import { authed, json } from "@/lib/api";
import { getBooking } from "@/lib/services/bookings";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Booking");
  return json(await getBooking(ctx, id));
});
