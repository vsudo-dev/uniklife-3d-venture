import Link from "next/link";
import { Link2, Plus, Upload } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { employeeDirectoryStats, listEmployees, listVentureOptions } from "@/lib/services/employees";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { date } from "@/lib/format";

export const metadata = { title: "Employees" };
export const dynamic = "force-dynamic";

const STATUSES = ["", "active", "on_leave", "resigned", "terminated"];

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("employee.view_all");
  const sp = await searchParams;
  const basePath = sp.staffWorkspace === "true" ? "/staff" : "/employees";
  const q = (sp.q ?? "").slice(0, 80);
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : "";
  const [employees, stats, ventures] = await Promise.all([
    listEmployees(ctx, { q: q || undefined, status: status || undefined }),
    employeeDirectoryStats(ctx),
    can(ctx, "employee.manage") ? listVentureOptions(ctx) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const ventureName = new Map(ventures.map((v) => [v.id, v.name]));
  const manage = can(ctx, "employee.manage");

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Employee directory"
        subtitle="Every employee has a permanent, unique employee ID used for sales attribution and the commission ladder."
        actions={
          manage ? (
            <>
              <LinkButton href="/employees/import" variant="outline"><Upload size={16} aria-hidden /> Import CSV</LinkButton>
              <LinkButton href="/employees/new" variant="gold"><Plus size={16} aria-hidden /> Add employee</LinkButton>
            </>
          ) : undefined
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Employees" value={stats.total} accent="gold" />
        <Stat label="Active" value={stats.active} />
        <Stat label="Linked to a login" value={stats.linked} />
        <Stat label="Top level (no manager)" value={stats.unassigned_manager} />
      </div>

      <form className="mb-4 flex flex-wrap gap-2" action={basePath}>
        {basePath === "/staff" && <input type="hidden" name="section" value="directory" />}
        <input name="q" defaultValue={q} placeholder="Search name, employee ID or mobile" className="input max-w-xs" aria-label="Search employees" />
        <select name="status" defaultValue={status} className="input max-w-[200px]" aria-label="Filter by status">
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "All statuses"}</option>)}
        </select>
        <button className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-contrast hover:bg-primary-strong">Filter</button>
        {(q || status) && <Link href={basePath} className="self-center text-sm font-semibold text-primary">Clear</Link>}
      </form>

      <Card className="overflow-hidden">
        {employees.length === 0 ? (
          <EmptyState title="No employees match">Try a different search or status filter.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[1100px]">
              <thead>
                <tr>
                  <th>Employee ID</th><th>Name</th><th>Mobile</th><th>Email</th><th>Designation</th><th>Level</th>
                  <th>Reporting manager</th><th>Ventures</th><th>Status</th><th>Joined</th><th>Login</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/employees/${e.id}`} className="font-mono text-xs font-bold text-primary hover:underline">{e.employee_code}</Link></td>
                    <td className="font-semibold"><Link href={`/employees/${e.id}`} className="hover:underline">{e.full_name}</Link></td>
                    <td className="whitespace-nowrap">{e.mobile ?? "—"}</td>
                    <td className="max-w-[200px] truncate">{e.email ?? "—"}</td>
                    <td>{e.designation ?? "—"}</td>
                    <td>{e.commission_level ? <Badge tone="gold">L{e.commission_level}</Badge> : "—"}</td>
                    <td>
                      {e.manager_code ? (
                        <span className="whitespace-nowrap">{e.manager_name} <span className="font-mono text-xs text-muted">{e.manager_code}</span></span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="max-w-[220px]">
                      {e.venture_ids.length === 0 ? <span className="text-muted">—</span> : (
                        <div className="flex flex-wrap gap-1">{e.venture_ids.map((v) => <Badge key={v}>{ventureName.get(v) ?? "Venture"}</Badge>)}</div>
                      )}
                    </td>
                    <td><StatusBadge status={e.employment_status} /></td>
                    <td className="whitespace-nowrap">{date(e.joining_date)}</td>
                    <td>{e.user_email ? <span className="inline-flex items-center gap-1 text-xs" title={e.user_email}><Link2 size={12} aria-hidden /> {e.user_email}</span> : <span className="text-xs text-muted">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
