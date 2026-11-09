import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { myVisitorDefaults, visitFormOptions } from "@/lib/services/site-visits";
import { isUuid } from "@/lib/services/common";
import { Notice, PageHeader } from "@/components/ui";
import { VisitForm } from "@/components/site-visits/visit-form";

export const metadata = { title: "Request a site visit" };

export default async function PortalSiteVisitPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("customer");
  const sp = await searchParams;
  const [{ ventures }, me] = await Promise.all([visitFormOptions(ctx), myVisitorDefaults(ctx)]);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/portal" className="hover:underline">My portal</Link>}
        title="Request a site visit"
        subtitle="Tell us when you'd like to see the venture. Our sales team will confirm the time with you."
      />
      {!ctx.customerId ? (
        <Notice tone="warning" title="Profile incomplete">Your customer profile is not set up yet. Please contact the sales team.</Notice>
      ) : (
        <VisitForm
          isCustomer
          ventures={ventures}
          prefill={{ ventureId: isUuid(sp.venture) ? sp.venture : null, plotIds: (sp.plots ?? "").split(",").filter(isUuid).slice(0, 10) }}
          me={{ employeeId: null, employeeLabel: null, name: me.name, phone: me.phone }}
          successHref="/portal?visit=requested"
        />
      )}
    </>
  );
}
