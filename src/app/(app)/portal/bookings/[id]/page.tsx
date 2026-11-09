import Link from "next/link";
import { notFound as nfPage } from "next/navigation";
import { BadgePercent } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { getBooking } from "@/lib/services/bookings";
import { isUuid } from "@/lib/services/common";
import { num } from "@/lib/db/types";
import { Card, Notice, PageHeader } from "@/components/ui";
import { BookingDetail } from "@/components/booking/booking-detail";
import { PortalBookingActions } from "@/components/portal/portal-booking-actions";
import { inr } from "@/lib/format";

export const metadata = { title: "My booking" };

export default async function PortalBookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageContext("customer");
  if (!isUuid(id)) nfPage();
  // Payment status is always read from the server here — never from a checkout redirect.
  const data = await getBooking(ctx, id).catch(() => null);
  if (!data) nfPage();
  const b = data.booking;
  const advanceDue = Math.max(0, Math.round((num(b.booking_amount) - data.verifiedAmount) * 100) / 100);
  const pending = b.status === "payment_pending";
  const windowOpen = pending && new Date(b.payment_due_at as string).getTime() > Date.now();
  const snap = (b.confirmed_pricing_snapshot ?? b.pricing_snapshot) as { discounts?: { name: string; code: string | null; amount: number }[]; cappedByOrganizationLimit?: boolean } | null;
  const discounts = snap?.discounts ?? [];

  return (
    <>
      <PageHeader eyebrow={<Link href="/portal" className="hover:underline">My portal</Link>} title={`Booking ${String(b.booking_number)}`} subtitle={String(b.venture_name)} />
      {sp.paid && (
        <div className="mb-4">
          <Notice tone={b.status === "confirmed" || b.status === "completed" ? "success" : "info"} title={b.status === "confirmed" || b.status === "completed" ? "Booking confirmed" : "Payment processed"}>
            {b.status === "confirmed" || b.status === "completed"
              ? "Your advance payment was verified by the server and your booking is confirmed."
              : "We have not yet verified a payment for this booking. The status below is read live from the server — if you completed a payment, it may take a moment to verify."}
          </Notice>
        </div>
      )}
      <BookingDetail
        data={data}
        isCustomer
        actions={
          <>
            <PortalBookingActions bookingId={id} canPay={windowOpen && advanceDue > 0} canCancel={pending && data.verifiedAmount === 0} advanceDue={advanceDue} />
            <Card className="p-5">
              <h3 className="flex items-center gap-2 font-bold"><BadgePercent size={18} className="text-gold" />Discounts</h3>
              {discounts.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No discount was applied to this booking. Eligible offers and coupon codes can be applied when you create a booking.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {discounts.map((d) => (
                    <li key={d.name} className="flex justify-between gap-2"><span>{d.name}{d.code ? ` (${d.code})` : ""}</span><strong className="text-success">-{inr(d.amount)}</strong></li>
                  ))}
                </ul>
              )}
              {snap?.cappedByOrganizationLimit && <p className="mt-2 text-xs text-warning">The total discount was capped at the developer&apos;s permitted limit.</p>}
              {discounts.length > 0 && pending && (
                <p className="mt-2 text-xs text-muted">Your discount is locked to the time you placed the booking and is re-checked when your payment is verified. If it can no longer be honoured, our team will contact you before confirming.</p>
              )}
            </Card>
          </>
        }
      />
    </>
  );
}
