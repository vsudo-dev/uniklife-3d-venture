import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { visitFormOptions } from "@/lib/services/site-visits";
import { isUuid } from "@/lib/services/common";
import { PageHeader } from "@/components/ui";
import { VisitForm } from "@/components/site-visits/visit-form";

export const metadata = { title: "Schedule site visit" };

/** ?venture=&plots=a,b (from the 3D viewer) &enquiry=&name=&phone= (from an enquiry). */
export default async function NewSiteVisitPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageContext("staff");
  const ctx = await requirePageContext("site_visit.manage");
  const sp = await searchParams;
  const { ventures } = await visitFormOptions(ctx);
  const plotIds = (sp.plots ?? "").split(",").filter(isUuid).slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/site-visits" className="hover:underline">Site visits</Link>}
        title="Schedule a site visit"
        subtitle="Book a visit for a prospect. The assigned employee is notified and reminded before the visit."
      />
      <VisitForm
        isCustomer={false}
        ventures={ventures}
        prefill={{
          ventureId: isUuid(sp.venture) ? sp.venture : null,
          plotIds,
          enquiryId: isUuid(sp.enquiry) ? sp.enquiry : null,
          name: sp.name?.slice(0, 120) ?? null,
          phone: sp.phone?.slice(0, 20) ?? null,
        }}
        me={{ employeeId: ctx.employee?.id ?? null, employeeLabel: ctx.employee ? `${ctx.employee.code} · ${ctx.employee.fullName}` : null }}
        successHref="/site-visits"
      />
    </>
  );
}
