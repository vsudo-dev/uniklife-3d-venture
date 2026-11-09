import Link from "next/link";
import { notFound as nfPage } from "next/navigation";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { getBooking } from "@/lib/services/bookings";
import { isUuid } from "@/lib/services/common";
import { num } from "@/lib/db/types";
import { PageHeader, Notice } from "@/components/ui";
import { BookingDetail } from "@/components/booking/booking-detail";
import { BookingActions } from "@/components/booking/booking-actions";

export const metadata = { title: "Booking" };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageContext("staff");
  if (!isUuid(id)) nfPage();
  const data = await getBooking(ctx, id).catch(() => null);
  if (!data) nfPage();
  const b = data.booking;
  const outstandingAdvance = Math.max(0, num(b.booking_amount) - data.verifiedAmount);
  return (
    <>
      <PageHeader eyebrow={<Link href="/bookings" className="hover:underline">Bookings</Link>} title={`Booking ${String(b.booking_number)}`} />
      {sp.created && <div className="mb-4"><Notice tone="success" title="Booking created">The plots are reserved pending the advance payment. Collect it below — the booking confirms automatically once the payment is verified.</Notice></div>}
      {sp.paid && <div className="mb-4"><Notice tone="info" title="Payment processed">The status below is read from the server — a checkout success screen alone never confirms a booking.</Notice></div>}
      <BookingDetail
        data={data}
        isCustomer={false}
        actions={
          <BookingActions
            bookingId={id}
            status={String(b.status)}
            outstandingAdvance={outstandingAdvance}
            outstanding={data.outstanding}
            attributionLocked={Boolean(b.attribution_locked)}
            can={{
              pay: can(ctx, "booking.create"),
              cancel: can(ctx, "booking.manage") || (b.status === "payment_pending" && data.verifiedAmount === 0 && b.requested_by === ctx.user.id),
              complete: can(ctx, "booking.manage"),
              confirm: can(ctx, "booking.confirm"),
              recordPayment: can(ctx, "payment.record"),
              attribution: can(ctx, "attribution.manage"),
            }}
          />
        }
      />
    </>
  );
}
