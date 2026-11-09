import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { assignableRoles, ROLE_LABELS } from "@/lib/auth/permissions";
import { listStaff } from "@/lib/services/staff";
import { listManagerOptions, listVentureOptions } from "@/lib/services/employees";
import { PageHeader, Stat } from "@/components/ui";
import { StaffManager, type StaffRow } from "@/components/admin/staff-manager";


export async function StaffAccessPanel() {
  const ctx = await requirePageContext("staff.manage");
  const canEmp = can(ctx, "employee.manage");
  const [rows, managers, ventures] = await Promise.all([
    listStaff(ctx),
    canEmp ? listManagerOptions(ctx) : Promise.resolve([]),
    canEmp ? listVentureOptions(ctx) : Promise.resolve([]),
  ]);
  const serial: StaffRow[] = rows.map((r) => ({
    member_id: r.member_id, user_id: r.user_id, email: r.email, full_name: r.full_name, role: r.role, status: r.status,
    user_status: r.user_status, last_login_at: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    employee_id: r.employee_id, employee_code: r.employee_code, other_org_count: r.other_org_count,
  }));
  const roles = assignableRoles(ctx.role).map((id) => ({ id, label: ROLE_LABELS[id] }));
  const active = rows.filter((r) => r.status === "active").length;
  const admins = rows.filter((r) => r.role === "org_admin" && r.status === "active").length;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Staff & access" subtitle={`Who can sign in to ${ctx.organizationName}, with which role. Every change is recorded in the audit log.`} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Staff members" value={rows.length} accent="gold" />
        <Stat label="Active" value={active} />
        <Stat label="Administrators" value={admins} />
        <Stat label="Without employee link" value={rows.filter((r) => !r.employee_id).length} />
      </div>
      <StaffManager
        rows={serial}
        currentUserId={ctx.user.id}
        roles={roles}
        managers={managers.map((m) => ({ id: m.id, employee_code: m.employee_code, full_name: m.full_name }))}
        ventures={ventures.map((v) => ({ id: v.id, name: v.name }))}
        isPlatformAdmin={ctx.role === "platform_admin"}
      />
    </>
  );
}
