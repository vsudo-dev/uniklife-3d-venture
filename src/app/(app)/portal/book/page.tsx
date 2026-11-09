import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { Card, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/services/common";

export const metadata = { title: "Book plots" };

export default async function PortalBookPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("customer");
  const sp = await searchParams;
  const plotIds = (sp.plots ?? "").split(",").filter(isUuid).slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/portal" className="hover:underline">My portal</Link>}
        title="Book your plots"
        subtitle="Prices and discounts are calculated live on the server. Your plots are held while you complete the booking."
      />
      {!ctx.customerId ? (
        <Notice tone="warning" title="Profile incomplete">Your customer profile is not set up yet. Please contact the sales team to complete it before booking.</Notice>
      ) : plotIds.length === 0 ? (
        <Card>
          <EmptyState title="Select plots first" action={<LinkButton href="/ventures" variant="gold">Explore ventures in 3D</LinkButton>}>
            Open a venture, tap one or more available plots to add them to your selection, then choose “Proceed to booking”.
          </EmptyState>
        </Card>
      ) : (
        <BookingWizard plotIds={plotIds} isCustomer canCreditOthers={false} me={{ employeeCode: null, employeeName: null, customerName: ctx.user.fullName }} />
      )}
    </>
  );
}
