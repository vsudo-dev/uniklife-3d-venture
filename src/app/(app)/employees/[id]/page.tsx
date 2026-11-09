import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { db, isUuid } from "@/lib/services/common";
import { getEmployee, getUplineChain, listDirectReports, listManagerOptions, listVentureOptions } from "@/lib/services/employees";
import { AppError } from "@/lib/errors";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { EmployeeForm } from "@/components/admin/employee-form";
import { date } from "@/lib/format";

export const metadata = { title: "Employee" };
export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("employee.view_all");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const emp = await getEmployee(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) return null;
    throw e;
  });
  if (!emp) notFound();
  const manage = can(ctx, "employee.manage");
  const [reports, chain, managers, ventures] = await Promise.all([
    listDirectReports(ctx, id),
    getUplineChain(await db(), ctx.organizationId, id),
    manage ? listManagerOptions(ctx, id) : Promise.resolve([]),
    manage ? listVentureOptions(ctx) : Promise.resolve([]),
  ]);
  const ventureName = new Map(ventures.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/employees" className="hover:underline">Employees</Link>}
        title={emp.full_name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><span className="font-mono font-bold text-text">{emp.employee_code}</span>{emp.designation && <span>· {emp.designation}</span>}<StatusBadge status={emp.employment_status} /></span>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {manage ? (
            <EmployeeForm
              employeeId={emp.id}
              employeeCode={emp.employee_code}
              managers={managers}
              ventures={ventures}
              initial={{
                fullName: emp.full_name, mobile: emp.mobile ?? "", email: emp.email ?? "", designation: emp.designation ?? "",
                commissionLevel: emp.commission_level ? String(emp.commission_level) : "", commissionEligible: emp.commission_eligible,
                reportingManagerId: emp.reporting_manager_id ?? "", employmentStatus: emp.employment_status as "active",
                joiningDate: emp.joining_date ?? "", ventureIds: emp.venture_ids, hrmReference: emp.hrm_reference ?? "",
              }}
            />
          ) : (
            <Card className="p-5 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div><dt className="text-muted">Mobile</dt><dd>{emp.mobile ?? "—"}</dd></div>
                <div><dt className="text-muted">Email</dt><dd>{emp.email ?? "—"}</dd></div>
                <div><dt className="text-muted">Level</dt><dd>{emp.commission_level ?? "—"}</dd></div>
                <div><dt className="text-muted">Joined</dt><dd>{date(emp.joining_date)}</dd></div>
              </dl>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Account & assignment" />
            <dl className="space-y-3 p-5 text-sm">
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Linked login</dt><dd className="mt-0.5">{emp.user_email ?? <span className="text-muted">Not linked — create a login from Staff &amp; access</span>}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Joining date</dt><dd className="mt-0.5">{date(emp.joining_date)}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">HRM reference</dt><dd className="mt-0.5">{emp.hrm_reference ?? "—"}</dd></div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Ventures</dt>
                <dd className="mt-1 flex flex-wrap gap-1">{emp.venture_ids.length ? emp.venture_ids.map((v) => <Badge key={v}>{ventureName.get(v) ?? "Venture"}</Badge>) : "—"}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Reporting line" subtitle="Upward chain used for team notifications and commissions." />
            <ol className="space-y-2 p-5 text-sm">
              {chain.map((m, i) => (
                <li key={m.employeeId} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold-soft text-[0.7rem] font-bold text-gold-strong">{i}</span>
                  {i === 0 ? <strong>{m.fullName}</strong> : <Link href={`/employees/${m.employeeId}`} className="hover:underline">{m.fullName}</Link>}
                  <span className="font-mono text-xs text-muted">{m.employeeCode}</span>
                  {m.commissionLevel && <Badge tone="gold">L{m.commissionLevel}</Badge>}
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title={`Direct reports (${reports.length})`} />
            {reports.length === 0 ? <EmptyState title="No direct reports" /> : (
              <ul className="divide-y divide-border">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/employees/${r.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-surface-2">
                      <span><strong>{r.full_name}</strong> <span className="font-mono text-xs text-muted">{r.employee_code}</span></span>
                      <StatusBadge status={r.employment_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
