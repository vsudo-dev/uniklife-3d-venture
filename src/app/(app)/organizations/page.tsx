import { requirePageContext } from "@/lib/auth/server";
import { listOrganizations } from "@/lib/services/organizations";
import { PageHeader, Stat } from "@/components/ui";
import { OrganizationsManager, type OrgItem } from "@/components/admin/organizations-manager";

export const metadata = { title: "Organizations" };
export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const ctx = await requirePageContext("platform.manage");
  const orgs = await listOrganizations(ctx);
  const serial: OrgItem[] = orgs.map((o) => ({ ...o, created_at: new Date(o.created_at).toISOString() }));
  return (
    <>
      <PageHeader eyebrow="Platform administration" title="Organizations" subtitle={`You are currently working in ${ctx.organizationName}. Switching changes the organization for your session.`} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Organizations" value={orgs.length} accent="gold" />
        <Stat label="Active" value={orgs.filter((o) => o.status === "active").length} />
        <Stat label="Suspended" value={orgs.filter((o) => o.status === "suspended").length} />
        <Stat label="Total bookings" value={orgs.reduce((s, o) => s + o.booking_count, 0)} />
      </div>
      <OrganizationsManager orgs={serial} activeOrgId={ctx.organizationId} />
    </>
  );
}
