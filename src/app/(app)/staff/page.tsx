import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { ORG_ROLES, PERMISSIONS, permissionsFor, ROLE_LABELS } from "@/lib/auth/permissions";
import { listEmployees, type EmployeeRow } from "@/lib/services/employees";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { StaffAccessPanel } from "@/components/admin/staff-access-panel";
import EmployeesPage from "../employees/page";
import CommissionPlansPage from "../commissions/plans/page";
import { listAgents } from "@/lib/services/agents";
import { AgentDirectory } from "@/components/admin/agent-directory";
import { PeopleIncentives } from "@/components/commissions/people-incentives";

export const metadata = { title: "Staff & Access" };
export const dynamic = "force-dynamic";
const sections = [["directory", "Employee Directory"], ["agents", "Agent Directory"], ["access", "Staff Login & Access"], ["roles", "Roles & Authentication"], ["chart", "Organization Chart"], ["commissions", "Commission Structure"], ["agent-commissions", "Agent Commissions"], ["incentives", "Employee Incentives"], ["leadership", "Leadership"]];

function Branch({ employee, rows, ancestors = [] }: { employee: EmployeeRow; rows: EmployeeRow[]; ancestors?: string[] }) {
  if (ancestors.includes(employee.id)) return <li className="p-3 text-danger">Reporting cycle detected. Review employee reporting lines.</li>;
  const children = rows.filter(e => e.reporting_manager_id === employee.id);
  return <li className="mt-3"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"><div><Link href={`/employees/${employee.id}`} className="font-bold text-primary hover:underline">{employee.full_name}</Link><div className="mt-1 text-xs text-muted">{employee.employee_code} · {employee.designation ?? "Designation not assigned"}</div></div><Badge tone="gold">{employee.commission_level ? `Commission L${employee.commission_level}` : "No commission level"}</Badge></div>{children.length > 0 && <ul className="ml-4 border-l-2 border-border pl-4 sm:ml-6">{children.map(e => <Branch key={e.id} employee={e} rows={rows} ancestors={[...ancestors, employee.id]} />)}</ul>}</li>;
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("staff.manage");
  const sp = await searchParams;
  const section = sections.some(([key]) => key === sp.section) ? sp.section : "directory";
  const employees = section === "chart" || section === "leadership" || section === "agents" ? await listEmployees(ctx) : [];
  const agents = section === "agents" ? await listAgents(ctx) : [];
  const designations = [...new Set(employees.map(e => e.designation ?? "Unassigned designation"))];
  const roots = employees.filter(e => !e.reporting_manager_id || !employees.some(other => other.id === e.reporting_manager_id));
  return <>
    <PageHeader eyebrow="People & organization" title="Staff & Access" subtitle={`One workspace for ${ctx.organizationName}: people, sign-in access, reporting lines and commission leadership.`} />
    <nav aria-label="Staff workspace" className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-2">{sections.map(([key, label]) => <Link key={key} href={`/staff?section=${key}`} aria-current={section === key ? "page" : undefined} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${section === key ? "bg-primary text-primary-contrast" : "text-muted hover:bg-surface-2"}`}>{label}</Link>)}</nav>
    {section === "directory" && <EmployeesPage searchParams={Promise.resolve({ ...sp, staffWorkspace: "true" })} />}
    {section === "access" && <StaffAccessPanel />}
    {section === "agents" && <AgentDirectory agents={agents} employees={employees.map(e=>({id:e.id,employee_code:e.employee_code,full_name:e.full_name}))} />}
    {section === "incentives" && <PeopleIncentives audience="employee" />}
    {section === "agent-commissions" && <PeopleIncentives audience="agent" />}
    {section === "commissions" && <CommissionPlansPage searchParams={searchParams} />}
    {section === "roles" && <div className="space-y-5"><Card><CardHeader title="Role access matrix" subtitle="Current server-enforced permissions. A leadership title or commission level does not grant login permissions." /><div className="overflow-x-auto"><table className="table"><thead><tr><th>System permission</th>{ORG_ROLES.map(role => <th key={role}>{ROLE_LABELS[role]}</th>)}</tr></thead><tbody>{PERMISSIONS.filter(p => p !== "platform.manage").map(permission => <tr key={permission}><td className="font-mono text-xs">{permission}</td>{ORG_ROLES.map(role => <td key={role}><Badge tone={permissionsFor(role).includes(permission) ? "success" : "neutral"}>{permissionsFor(role).includes(permission) ? "Allowed" : "—"}</Badge></td>)}</tr>)}</tbody></table></div></Card><Card className="p-5"><h2 className="font-bold">Authentication and account control</h2><p className="mt-2 text-sm text-muted">Staff Login &amp; Access manages account creation, role assignment, activation, password reset and employee links. Signing in authenticates the user; organization membership and the matrix above determine what they may do. Sensitive changes remain audited.</p><Link className="mt-3 inline-block font-semibold text-primary underline" href="/staff?section=access">Manage staff accounts →</Link></Card></div>}
    {section === "chart" && <Card><CardHeader title="Organization reporting chart" subtitle="Built from employee reporting managers. Commission levels are separate from reporting relationships." /><div className="max-h-[900px] overflow-auto p-5">{roots.length ? <ul>{roots.map(e => <Branch key={e.id} employee={e} rows={employees} />)}</ul> : <EmptyState title="No reporting roots found">Add employees or review their reporting relationships in the directory.</EmptyState>}</div></Card>}
    {section === "leadership" && <><p className="mb-5 text-sm text-muted">Leadership groups use your existing designations and reporting relationships. Edit a person in Employee Directory to update their designation, manager, commission level or eligibility. System access remains controlled by their login role.</p><div className="grid gap-4 md:grid-cols-2">{designations.map(title => <Card key={title}><CardHeader title={title} subtitle={`${employees.filter(e => (e.designation ?? "Unassigned designation") === title).length} employee(s)`} /><ul className="divide-y divide-border">{employees.filter(e => (e.designation ?? "Unassigned designation") === title).map(e => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-4"><div><Link className="font-semibold text-primary" href={`/employees/${e.id}`}>{e.full_name}</Link><p className="text-xs text-muted">{e.direct_reports} direct reports · {e.manager_name ? `Reports to ${e.manager_name}` : "Top-level reporting position"}</p></div><Badge>{e.commission_eligible ? `Eligible · ${e.commission_level ? `L${e.commission_level}` : "level unassigned"}` : "Commission ineligible"}</Badge></li>)}</ul></Card>)}</div>{!employees.length && <EmptyState title="No employees yet" />}</>}
  </>;
}
