import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { assignableRoles, ORG_ROLES, type OrgRole } from "@/lib/auth/permissions";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { db, withTx } from "./common";
import { createEmployee } from "./employees";

// ---------------------------------------------------------------------------
// Staff & access (organization members). All functions require staff.manage
// except the self-service profile/password functions at the bottom.
// ---------------------------------------------------------------------------

export interface StaffMemberRow {
  member_id: string;
  user_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: OrgRole;
  status: "active" | "disabled";
  user_status: "active" | "disabled";
  is_platform_admin: boolean;
  last_login_at: Date | null;
  created_at: Date;
  employee_id: string | null;
  employee_code: string | null;
  other_org_count: number;
}

export async function listStaff(ctx: AuthContext, opts: { includeCustomers?: boolean; q?: string } = {}): Promise<StaffMemberRow[]> {
  assertPermission(ctx, "staff.manage");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["m.organization_id = $1"];
  if (!opts.includeCustomers) where.push("m.role <> 'customer'");
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    where.push(`(lower(u.full_name) like $${params.length} or lower(u.email) like $${params.length})`);
  }
  return q.query<StaffMemberRow>(
    `select m.id as member_id, u.id as user_id, u.email, u.full_name, u.phone, m.role, m.status, u.status as user_status,
            u.is_platform_admin, u.last_login_at, m.created_at, e.id as employee_id, e.employee_code,
            (select count(*)::int from organization_members o2 where o2.user_id = u.id and o2.organization_id <> m.organization_id) as other_org_count
       from organization_members m
       join app_users u on u.id = m.user_id
       left join employees e on e.user_id = u.id and e.organization_id = m.organization_id
      where ${where.join(" and ")}
      order by case m.role when 'org_admin' then 0 when 'venture_manager' then 1 when 'sales_manager' then 2 when 'sales_executive' then 3 else 4 end, u.full_name`,
    params,
  );
}

const passwordField = z
  .string()
  .min(1, "Temporary password is required")
  .max(200)
  .superRefine((v, c) => {
    const err = validatePasswordStrength(v);
    if (err) c.addIssue({ code: z.ZodIssueCode.custom, message: err });
  });

const staffRole = z.enum(["org_admin", "venture_manager", "sales_manager", "sales_executive"]);

export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid phone number").optional().nullable().or(z.literal("").transform(() => null)),
  role: staffRole,
  temporaryPassword: passwordField,
  employee: z
    .object({
      designation: z.string().trim().max(80).optional().nullable(),
      commissionLevel: z.coerce.number().int().min(1).max(12).optional().nullable(),
      reportingManagerId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
      joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
      ventureIds: z.array(z.string().uuid()).default([]),
    })
    .optional()
    .nullable(),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

function assertAssignable(ctx: AuthContext, role: string) {
  if (!assignableRoles(ctx.role).includes(role as OrgRole)) throw forbidden("You cannot assign this role");
}

/**
 * Creates a staff user + membership (and optionally a linked employee record) in a
 * single transaction. Existing accounts are never silently re-used: their password
 * belongs to their owner, so an existing email is a conflict.
 */
export async function createStaff(ctx: AuthContext, raw: CreateStaffInput) {
  assertPermission(ctx, "staff.manage");
  const input = createStaffSchema.parse(raw);
  assertAssignable(ctx, input.role);
  const hash = await hashPassword(input.temporaryPassword);
  return withTx(async (q) => {
    const [existing] = await q.query<{ id: string }>("select id from app_users where lower(email) = $1", [input.email]);
    if (existing) throw conflict("An account with this email already exists");
    const [user] = await q.query<{ id: string }>(
      "insert into app_users (email, full_name, phone, password_hash) values ($1,$2,$3,$4) returning id",
      [input.email, input.fullName, input.phone ?? null, hash],
    );
    const [member] = await q.query<{ id: string }>(
      "insert into organization_members (organization_id, user_id, role) values ($1,$2,$3) returning id",
      [ctx.organizationId, user.id, input.role],
    );
    let employeeCode: string | null = null;
    if (input.employee) {
      const emp = await createEmployee(
        ctx,
        {
          fullName: input.fullName,
          mobile: input.phone ?? null,
          email: input.email,
          designation: input.employee.designation ?? null,
          commissionLevel: input.employee.commissionLevel ?? null,
          commissionEligible: true,
          reportingManagerId: input.employee.reportingManagerId ?? null,
          employmentStatus: "active",
          joiningDate: input.employee.joiningDate ?? null,
          ventureIds: input.employee.ventureIds,
          hrmReference: null,
        },
        { userId: user.id, tx: q },
      );
      employeeCode = String(emp.employee_code);
    }
    await writeAudit(q, ctx, {
      action: "staff.created",
      entityType: "organization_member",
      entityId: member.id,
      summary: `Created staff user ${input.email} (${input.role})${employeeCode ? ` linked to ${employeeCode}` : ""}`,
      after: { user_id: user.id, email: input.email, full_name: input.fullName, role: input.role, employee_code: employeeCode },
    });
    return { memberId: member.id, userId: user.id, employeeCode };
  });
}

async function lockMember(q: Queryable, ctx: AuthContext, memberId: string) {
  const [m] = await q.query<{ id: string; user_id: string; role: OrgRole; status: string; email: string }>(
    `select m.id, m.user_id, m.role, m.status, u.email from organization_members m join app_users u on u.id = m.user_id
      where m.organization_id = $1 and m.id = $2 for update of m`,
    [ctx.organizationId, memberId],
  );
  if (!m) throw notFound("Staff member");
  return m;
}

/** Count of OTHER active org admins (locks the admin rows to serialize concurrent changes). */
async function otherActiveAdmins(q: Queryable, orgId: string, excludeMemberId: string): Promise<number> {
  const rows = await q.query<{ id: string }>(
    `select m.id from organization_members m join app_users u on u.id = m.user_id
      where m.organization_id = $1 and m.role = 'org_admin' and m.status = 'active' and u.status = 'active' and m.id <> $2
      for update of m`,
    [orgId, excludeMemberId],
  );
  return rows.length;
}

export async function changeStaffRole(ctx: AuthContext, memberId: string, role: string) {
  assertPermission(ctx, "staff.manage");
  if (!(ORG_ROLES as readonly string[]).includes(role) || role === "customer") throw badRequest("Invalid role");
  assertAssignable(ctx, role);
  return withTx(async (q) => {
    const m = await lockMember(q, ctx, memberId);
    if (m.role === "customer") throw badRequest("Customer accounts are managed from the customer screens");
    if (m.role === role) return { memberId, role };
    if (m.role === "org_admin" && (await otherActiveAdmins(q, ctx.organizationId, m.id)) === 0) {
      throw conflict("The organization must keep at least one active administrator");
    }
    await q.query("update organization_members set role = $3 where organization_id = $1 and id = $2", [ctx.organizationId, memberId, role]);
    await writeAudit(q, ctx, {
      action: "staff.role_changed", entityType: "organization_member", entityId: memberId,
      summary: `Role of ${m.email} changed from ${m.role} to ${role}`, before: { role: m.role }, after: { role },
    });
    return { memberId, role };
  });
}

export async function setStaffStatus(ctx: AuthContext, memberId: string, status: "active" | "disabled") {
  assertPermission(ctx, "staff.manage");
  if (status !== "active" && status !== "disabled") throw badRequest("Invalid status");
  return withTx(async (q) => {
    const m = await lockMember(q, ctx, memberId);
    if (m.status === status) return { memberId, status };
    if (status === "disabled") {
      if (m.user_id === ctx.user.id) throw conflict("You cannot disable your own access");
      if (m.role === "org_admin" && (await otherActiveAdmins(q, ctx.organizationId, m.id)) === 0) {
        throw conflict("You cannot disable the last active organization administrator");
      }
    }
    await q.query("update organization_members set status = $3 where organization_id = $1 and id = $2", [ctx.organizationId, memberId, status]);
    await writeAudit(q, ctx, {
      action: status === "disabled" ? "staff.disabled" : "staff.enabled", entityType: "organization_member", entityId: memberId,
      summary: `${status === "disabled" ? "Disabled" : "Enabled"} access for ${m.email}`, before: { status: m.status }, after: { status },
    });
    return { memberId, status };
  });
}

/**
 * Sets a new temporary password. Only for accounts that belong solely to this
 * organization (an org admin must not be able to take over an account that is
 * also used in another organization) — platform admins excepted.
 */
export async function resetStaffPassword(ctx: AuthContext, memberId: string, newPassword: string) {
  assertPermission(ctx, "staff.manage");
  const err = validatePasswordStrength(newPassword ?? "");
  if (err) throw badRequest(err);
  const hash = await hashPassword(newPassword);
  return withTx(async (q) => {
    const m = await lockMember(q, ctx, memberId);
    const [u] = await q.query<{ is_platform_admin: boolean; auth_provider: string; other: number }>(
      `select is_platform_admin, auth_provider,
              (select count(*)::int from organization_members o where o.user_id = u.id and o.organization_id <> $2) as other
         from app_users u where u.id = $1`,
      [m.user_id, ctx.organizationId],
    );
    if (u.auth_provider !== "local") throw badRequest("This account signs in through an external identity provider");
    if (ctx.role !== "platform_admin" && (u.is_platform_admin || u.other > 0)) {
      throw forbidden("This account is shared with another organization; ask the platform administrator to reset it");
    }
    await q.query("update app_users set password_hash = $2 where id = $1", [m.user_id, hash]);
    await writeAudit(q, ctx, {
      action: "staff.password_reset", entityType: "organization_member", entityId: memberId,
      summary: `Temporary password set for ${m.email}`,
    });
    return { memberId };
  });
}

// ---------------------------------------------------------------------------
// Self-service profile
// ---------------------------------------------------------------------------
export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid phone number").optional().nullable().or(z.literal("").transform(() => null)),
});

export async function getMyProfile(ctx: AuthContext) {
  const q = await db();
  const [u] = await q.query<{ id: string; email: string; full_name: string; phone: string | null; auth_provider: string; last_login_at: Date | null }>(
    "select id, email, full_name, phone, auth_provider, last_login_at from app_users where id = $1",
    [ctx.user.id],
  );
  if (!u) throw notFound("User");
  return u;
}

export async function updateMyProfile(ctx: AuthContext, raw: z.infer<typeof profileSchema>) {
  const input = profileSchema.parse(raw);
  return withTx(async (q) => {
    const [before] = await q.query<{ full_name: string; phone: string | null }>("select full_name, phone from app_users where id = $1 for update", [ctx.user.id]);
    await q.query("update app_users set full_name = $2, phone = $3 where id = $1", [ctx.user.id, input.fullName, input.phone ?? null]);
    await writeAudit(q, ctx, { action: "user.profile_updated", entityType: "user", entityId: ctx.user.id, before, after: { full_name: input.fullName, phone: input.phone ?? null } });
    return { fullName: input.fullName, phone: input.phone ?? null };
  });
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export async function changeMyPassword(ctx: AuthContext, raw: z.infer<typeof changePasswordSchema>) {
  const input = changePasswordSchema.parse(raw);
  const q = await db();
  const [u] = await q.query<{ password_hash: string | null; auth_provider: string }>("select password_hash, auth_provider from app_users where id = $1", [ctx.user.id]);
  if (!u) throw notFound("User");
  if (u.auth_provider !== "local") throw badRequest("Your password is managed by the external identity provider");
  if (!(await verifyPassword(input.currentPassword, u.password_hash))) throw badRequest("Current password is incorrect");
  const err = validatePasswordStrength(input.newPassword);
  if (err) throw badRequest(err);
  if (input.newPassword === input.currentPassword) throw badRequest("The new password must be different");
  const hash = await hashPassword(input.newPassword);
  await withTx(async (tx) => {
    await tx.query("update app_users set password_hash = $2 where id = $1", [ctx.user.id, hash]);
    await writeAudit(tx, ctx, { action: "user.password_changed", entityType: "user", entityId: ctx.user.id });
  });
  return { ok: true };
}
