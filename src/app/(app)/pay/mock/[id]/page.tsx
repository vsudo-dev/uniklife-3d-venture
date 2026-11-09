import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/server";
import { getTransactionForCheckout } from "@/lib/services/payments";
import { isUuid } from "@/lib/services/common";
import { MockCheckout } from "./mock-checkout";

export const metadata = { title: "Simulated checkout" };

export default async function MockPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext();
  if (!isUuid(id)) notFound();
  const t = await getTransactionForCheckout(ctx, id).catch(() => null);
  if (!t) notFound();
  const returnTo = ctx.role === "customer" ? `/portal/bookings/${t.booking_id}?paid=1` : `/bookings/${t.booking_id}?paid=1`;
  return (
    <MockCheckout
      transactionId={id}
      amount={Number(t.amount)}
      bookingNumber={String(t.booking_number)}
      status={String(t.status)}
      reference={String(t.provider_reference)}
      returnTo={returnTo}
    />
  );
}
