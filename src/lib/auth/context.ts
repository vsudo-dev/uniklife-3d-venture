import type { Queryable } from "@/lib/db/types";
import { forbidden, notFound, unauthorized } from "@/lib/errors";
import { hasOrgWideRecordScope, isVentureScopedRole, roleHas, STAFF_ROLES, type OrgRole, type Permission, type Role } from "./permissions";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
}

export interface AuthContext {
  user: AuthUser;
  organizationId: string;
  organizationName: string;
  role: Role;
  /** null => all ventures of the organization; otherwise only these (assignment-scoped roles). */
  ventureIds: string[] | null;
  /** Customer record for role=customer. */
  customerId: string | null;
  /** The caller's own employee record (staff), used for attribution and network scope. */
  employee: { id: string; code: string; fullName: string; commissionLevel: number | null } | null;
  /** null => org-wide record scope; otherwise self + all descendants in the reporting tree. */
  networkEmployeeIds: string[] | null;
  memberships: Membership[];
  ip?: string | null;
}

/** True if the employee is visible to the caller (self/descendant, or org-wide scope). */
export function inNetwork(ctx: AuthContext, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false;
  return ctx.networkEmployeeIds === null || ctx.networkEmployeeIds.includes(employeeId);
}

/** Recursive descendant lookup (inclusive of the root). */
export async function loadNetworkIds(q: Queryable, orgId: string, rootEmployeeId: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `with recursive tree(id, depth) as (
       select id, 0 from employees where id = $1 and organization_id = $2
       union all
       select e.id, t.depth + 1 from employees e join tree t on e.reporting_manager_id = t.id
        where e.organization_id = $2 and t.depth < 64
     ) select id from tree`,
    [rootEmployeeId, orgId],
  );
  return rows.map((r) => r.id);
}

export function isStaff(ctx: AuthContext): boolean {
  return ctx.role === "platform_admin" || STAFF_ROLES.includes(ctx.role as OrgRole);
}

export function can(ctx: AuthContext, permission: Permission): boolean {
  return roleHas(ctx.role, permission);
}

export function assertPermission(ctx: AuthContext, permission: Permission): void {
  if (!can(ctx, permission)) throw forbidden();
}

export function assertStaff(ctx: AuthContext): void {
  if (!isStaff(ctx)) throw forbidden();
}

export function canAccessVenture(ctx: AuthContext, ventureId: string): boolean {
  if (ctx.ventureIds === null) return true;
  return ctx.ventureIds.includes(ventureId);
}

/** Use after loading a venture row already filtered by organization. */
export function assertVentureAccess(ctx: AuthContext, ventureId: string): void {
  if (!canAccessVenture(ctx, ventureId)) throw notFound("Venture");
}

/** SQL fragment restricting a venture_id column to the caller's scope. Appends to params. */
export function ventureScopeSql(ctx: AuthContext, column: string, params: unknown[]): string {
  if (ctx.ventureIds === null) return "true";
  params.push(ctx.ventureIds);
  return `${column} = any($${params.length}::uuid[])`;
}

/**
 * Builds a fresh context from the database on every request so that disabling
 * a user or changing a role takes effect immediately.
 */
export async function loadAuthContext(
  q: Queryable,
  userId: string,
  requestedOrgId: string | null,
  ip?: string | null,
): Promise<AuthContext> {
  const [user] = await q.query<{ id: string; email: string; full_name: string; is_platform_admin: boolean; status: string }>(
    "select id, email, full_name, is_platform_admin, status from app_users where id = $1",
    [userId],
  );
  if (!user || user.status !== "active") throw unauthorized();

  const memberships = (
    await q.query<{ organization_id: string; name: string; role: OrgRole }>(
      `select m.organization_id, o.name, m.role
         from organization_members m join organizations o on o.id = m.organization_id
        where m.user_id = $1 and m.status = 'active' and o.status = 'active'
        order by o.name`,
      [userId],
    )
  ).map((m) => ({ organizationId: m.organization_id, organizationName: m.name, role: m.role }));

  const authUser: AuthUser = { id: user.id, email: user.email, fullName: user.full_name, isPlatformAdmin: user.is_platform_admin };

  if (user.is_platform_admin) {
    let orgId = requestedOrgId;
    let orgName = "";
    if (orgId) {
      const [o] = await q.query<{ id: string; name: string }>("select id, name from organizations where id = $1", [orgId]);
      if (o) orgName = o.name;
      else orgId = null;
    }
    if (!orgId) {
      const [o] = await q.query<{ id: string; name: string }>("select id, name from organizations order by created_at limit 1");
      if (!o) throw forbidden("No organizations exist yet");
      orgId = o.id;
      orgName = o.name;
    }
    const employee = await loadEmployeeFor(q, userId, orgId);
    return {
      user: authUser, organizationId: orgId, organizationName: orgName, role: "platform_admin",
      ventureIds: null, customerId: null, employee, networkEmployeeIds: null, memberships, ip,
    };
  }

  const active = memberships.find((m) => m.organizationId === requestedOrgId) ?? memberships[0];
  if (!active) throw forbidden("Your account is not a member of any active organization");

  const employee = active.role === "customer" ? null : await loadEmployeeFor(q, userId, active.organizationId);

  let ventureIds: string[] | null = null;
  if (isVentureScopedRole(active.role)) {
    ventureIds = employee
      ? (
          await q.query<{ venture_id: string }>(
            "select venture_id from venture_assignments where employee_id = $1 and organization_id = $2",
            [employee.id, active.organizationId],
          )
        ).map((r) => r.venture_id)
      : [];
  }

  let networkEmployeeIds: string[] | null = null;
  if (!hasOrgWideRecordScope(active.role)) {
    networkEmployeeIds = employee ? await loadNetworkIds(q, active.organizationId, employee.id) : [];
  }

  let customerId: string | null = null;
  if (active.role === "customer") {
    const [c] = await q.query<{ id: string }>(
      "select id from customers where user_id = $1 and organization_id = $2",
      [userId, active.organizationId],
    );
    customerId = c?.id ?? null;
  }

  return {
    user: authUser,
    organizationId: active.organizationId,
    organizationName: active.organizationName,
    role: active.role,
    ventureIds,
    customerId,
    employee,
    networkEmployeeIds,
    memberships,
    ip,
  };
}

async function loadEmployeeFor(q: Queryable, userId: string, orgId: string): Promise<AuthContext["employee"]> {
  const [e] = await q.query<{ id: string; employee_code: string; full_name: string; commission_level: number | null }>(
    `select id, employee_code, full_name, commission_level from employees
      where user_id = $1 and organization_id = $2 and employment_status in ('active', 'on_leave')`,
    [userId, orgId],
  );
  return e ? { id: e.id, code: e.employee_code, fullName: e.full_name, commissionLevel: e.commission_level } : null;
}
