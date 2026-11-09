import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/services/common";

export const metadata = { title: "New booking" };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("booking.create");
  const sp = await searchParams;
  const plotIds = (sp.plots ?? "").split(",").filter(isUuid).slice(0, 10);
  return (
    <>
      <PageHeader eyebrow="Bookings" title="New booking" subtitle="Single or multi-plot booking with server-side pricing, discount validation and verified payment." />
      {plotIds.length === 0 ? (
        <Card>
          <EmptyState title="Select plots first" action={<LinkButton href="/ventures" variant="gold">Open a venture</LinkButton>}>
            Open a venture in the 3D viewer, add one or more available plots to your selection and choose “Proceed to booking”.
          </EmptyState>
        </Card>
      ) : (
        <BookingWizard
          plotIds={plotIds}
          isCustomer={false}
          canCreditOthers={can(ctx, "employee.view_all") || (ctx.networkEmployeeIds?.length ?? 0) > 1}
          me={{ employeeCode: ctx.employee?.code ?? null, employeeName: ctx.employee?.fullName ?? null, customerName: null }}
        />
      )}
    </>
  );
}
