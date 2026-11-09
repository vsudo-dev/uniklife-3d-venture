import { authed } from "@/lib/api";
import { getBooking } from "@/lib/services/bookings";
import { buildAcknowledgementPdf } from "@/lib/pdf/acknowledgement";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Booking");
  const data = await getBooking(ctx, id);
  const pdf = await buildAcknowledgementPdf({ orgName: ctx.organizationName, ...data });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="booking-${String(data.booking.booking_number)}.pdf"`,
      "Cache-Control": "no-store, private",
    },
  });
});
