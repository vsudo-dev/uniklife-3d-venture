import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { num } from "@/lib/db/types";
import { db, withTx } from "./common";
import { createEmployee } from "./employees";

// ---------------------------------------------------------------------------
// Platform administration: organizations (platform.manage)
// ---------------------------------------------------------------------------
export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  contact_email: string | null;
  created_at: Date;
  staff_count: number;
  customer_count: number;
  employee_count: number;
  venture_count: number;
  booking_count: number;
  primary_domain: string | null;
}

export async function listOrganizations(ctx: AuthContext): Promise<OrganizationRow[]> {
  assertPermission(ctx, "platform.manage");
  const q = await db();
  return q.query<OrganizationRow>(
    `select o.id, o.name, o.slug, o.status, o.contact_email, o.created_at,
            (select count(*)::int from organization_members m where m.organization_id = o.id and m.role <> 'customer') as staff_count,
            (select count(*)::int from organization_members m where m.organization_id = o.id and m.role = 'customer') as customer_count,
            (select count(*)::int from employees e where e.organization_id = o.id) as employee_count,
            (select count(*)::int from ventures v where v.organization_id = o.id) as venture_count,
            (select count(*)::int from bookings b where b.organization_id = o.id) as booking_count,
            (select d.domain from organization_domains d where d.organization_id = o.id and d.is_primary limit 1) as primary_domain
       from organizations o order by o.created_at`,
  );
}

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Slug: lowercase letters, digits and hyphens (2-63 chars)"),
  contactEmail: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminName: z.string().trim().min(2).max(160),
  adminPassword: z.string().min(1).max(200).superRefine((v, c) => {
    const err = validatePasswordStrength(v);
    if (err) c.addIssue({ code: z.ZodIssueCode.custom, message: err });
  }),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Creates an organization with its first administrator (user + membership + level-1 employee record). */
export async function createOrganization(ctx: AuthContext, raw: CreateOrganizationInput) {
  assertPermission(ctx, "platform.manage");
  const input = createOrganizationSchema.parse(raw);
  const hash = await hashPassword(input.adminPassword);
  return withTx(async (q) => {
    const [slugTaken] = await q.query("select 1 from organizations where slug = $1", [input.slug]);
    if (slugTaken) throw conflict("This slug is already in use");
    const [userTaken] = await q.query("select 1 from app_users where lower(email) = $1", [input.adminEmail]);
    if (userTaken) throw conflict("An account with the administrator email already exists");
    const [org] = await q.query<{ id: string }>(
      "insert into organizations (name, slug, contact_email, app_name) values ($1,$2,$3,$1) returning id",
      [input.name, input.slug, input.contactEmail ?? null],
    );
    const [user] = await q.query<{ id: string }>(
      "insert into app_users (email, full_name, password_hash) values ($1,$2,$3) returning id",
      [input.adminEmail, input.adminName, hash],
    );
    await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'org_admin')", [org.id, user.id]);
    const orgCtx: AuthContext = { ...ctx, organizationId: org.id, organizationName: input.name, employee: null, networkEmployeeIds: null, ventureIds: null };
    const emp = await createEmployee(
      orgCtx,
      {
        fullName: input.adminName, mobile: null, email: input.adminEmail, designation: "Managing Director", commissionLevel: 1,
        commissionEligible: true, reportingManagerId: null, employmentStatus: "active", joiningDate: null, ventureIds: [], hrmReference: null,
      },
      { userId: user.id, tx: q },
    );
    await writeAudit(q, orgCtx, {
      action: "organization.created", entityType: "organization", entityId: org.id,
      summary: `Organization ${input.name} created with administrator ${input.adminEmail}`,
      after: { name: input.name, slug: input.slug, admin_email: input.adminEmail, admin_employee_code: emp.employee_code },
    });
    return { id: org.id, adminUserId: user.id, adminEmployeeCode: String(emp.employee_code) };
  });
}

export async function setOrganizationStatus(ctx: AuthContext, orgId: string, status: "active" | "suspended") {
  assertPermission(ctx, "platform.manage");
  if (status !== "active" && status !== "suspended") throw badRequest("Invalid status");
  return withTx(async (q) => {
    const [o] = await q.query<{ id: string; status: string; name: string }>("select id, status, name from organizations where id = $1 for update", [orgId]);
    if (!o) throw notFound("Organization");
    if (o.status === status) return { id: orgId, status };
    await q.query("update organizations set status = $2 where id = $1", [orgId, status]);
    await writeAudit(q, { ...ctx, organizationId: orgId }, {
      action: status === "suspended" ? "organization.suspended" : "organization.reactivated", entityType: "organization", entityId: orgId,
      summary: `${o.name} ${status === "suspended" ? "suspended" : "reactivated"}`, before: { status: o.status }, after: { status },
    });
    return { id: orgId, status };
  });
}

/** Organizations the current user may switch to. */
export async function switchableOrganizations(ctx: AuthContext): Promise<{ id: string; name: string; status: string; slug?: string; plot_count?: number }[]> {
  if (ctx.user.isPlatformAdmin) {
    return (await db()).query("select o.id, o.name, o.status, o.slug, (select count(*)::int from plots p join ventures v on v.id=p.venture_id where p.organization_id=o.id and v.deleted_at is null) as plot_count from organizations o order by name, slug");
  }
  return ctx.memberships.map((m) => ({ id: m.organizationId, name: m.organizationName, status: "active" }));
}

/** Validates that the user may act in the target organization (returns the org id to put in the session). */
export async function resolveSwitchTarget(ctx: AuthContext, organizationId: string): Promise<string> {
  const q = await db();
  if (ctx.user.isPlatformAdmin) {
    const [o] = await q.query<{ id: string }>("select id from organizations where id = $1", [organizationId]);
    if (!o) throw notFound("Organization");
  } else {
    const [m] = await q.query(
      `select 1 from organization_members m join organizations o on o.id = m.organization_id
        where m.user_id = $1 and m.organization_id = $2 and m.status = 'active' and o.status = 'active'`,
      [ctx.user.id, organizationId],
    );
    if (!m) throw forbidden("You are not an active member of that organization");
  }
  await withTx((tx) =>
    writeAudit(tx, { ...ctx, organizationId }, { action: "auth.organization_switched", entityType: "organization", entityId: organizationId, metadata: { from: ctx.organizationId } }),
  );
  return organizationId;
}

// ---------------------------------------------------------------------------
// Organization settings (org.manage)
// ---------------------------------------------------------------------------
export const orgSettingsSchema = z.object({
  holdMinutes: z.coerce.number().int().min(1).max(1440),
  paymentWindowMinutes: z.coerce.number().int().min(5).max(10080),
  bookingAmountPercent: z.coerce.number().gt(0).max(100),
  allowDiscountStacking: z.boolean().default(false),
  maxDiscountPercent: z.coerce.number().min(0).max(100),
  discountApprovalThresholdPercent: z.coerce.number().min(0).max(100),
  followupReminderHours: z.array(z.coerce.number().int().min(1).max(720)).max(6).default([]),
  employeeCodePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, "Prefix must be 2-6 letters"),
  contactEmail: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(40).optional().nullable().or(z.literal("").transform(() => null)),
  /** Four-eyes control for commission plans. Omitted = unchanged. */
  commissionRequiresSecondApprover: z.boolean().optional(),
}).refine((v) => v.discountApprovalThresholdPercent <= v.maxDiscountPercent, {
  message: "Approval threshold cannot exceed the maximum discount", path: ["discountApprovalThresholdPercent"],
});
export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>;

export async function getOrgSettings(ctx: AuthContext): Promise<OrgSettingsInput & { name: string }> {
  assertPermission(ctx, "org.manage");
  const q = await db();
  const [o] = await q.query<Record<string, unknown>>("select * from organizations where id = $1", [ctx.organizationId]);
  if (!o) throw notFound("Organization");
  return {
    name: String(o.name),
    holdMinutes: num(o.hold_minutes),
    paymentWindowMinutes: num(o.payment_window_minutes),
    bookingAmountPercent: num(o.booking_amount_percent),
    allowDiscountStacking: Boolean(o.allow_discount_stacking),
    maxDiscountPercent: num(o.max_discount_percent),
    discountApprovalThresholdPercent: num(o.discount_approval_threshold_percent),
    followupReminderHours: ((o.followup_reminder_hours as unknown[]) ?? []).map(num),
    employeeCodePrefix: String(o.employee_code_prefix),
    contactEmail: (o.contact_email as string) ?? null,
    contactPhone: (o.contact_phone as string) ?? null,
    commissionRequiresSecondApprover: o.commission_requires_second_approver === undefined || o.commission_requires_second_approver === null ? true : Boolean(o.commission_requires_second_approver),
  };
}

export async function updateOrgSettings(ctx: AuthContext, raw: OrgSettingsInput) {
  assertPermission(ctx, "org.manage");
  const s = orgSettingsSchema.parse(raw);
  return withTx(async (q) => {
    const [before] = await q.query<Record<string, unknown>>(
      `select hold_minutes, payment_window_minutes, booking_amount_percent, allow_discount_stacking, max_discount_percent,
              discount_approval_threshold_percent, followup_reminder_hours, employee_code_prefix, contact_email, contact_phone,
              commission_requires_second_approver
         from organizations where id = $1 for update`,
      [ctx.organizationId],
    );
    if (!before) throw notFound("Organization");
    const hours = [...new Set(s.followupReminderHours)].sort((a, b) => a - b);
    const [after] = await q.query<Record<string, unknown>>(
      `update organizations set hold_minutes=$2, payment_window_minutes=$3, booking_amount_percent=$4, allow_discount_stacking=$5,
              max_discount_percent=$6, discount_approval_threshold_percent=$7, followup_reminder_hours=$8::int[], employee_code_prefix=$9,
              contact_email=$10, contact_phone=$11,
              commission_requires_second_approver = coalesce($12::boolean, commission_requires_second_approver)
        where id = $1
        returning hold_minutes, payment_window_minutes, booking_amount_percent, allow_discount_stacking, max_discount_percent,
                  discount_approval_threshold_percent, followup_reminder_hours, employee_code_prefix, contact_email, contact_phone,
                  commission_requires_second_approver`,
      [
        ctx.organizationId, s.holdMinutes, s.paymentWindowMinutes, s.bookingAmountPercent, s.allowDiscountStacking, s.maxDiscountPercent,
        s.discountApprovalThresholdPercent, hours, s.employeeCodePrefix, s.contactEmail ?? null, s.contactPhone ?? null,
        s.commissionRequiresSecondApprover ?? null,
      ],
    );
    await writeAudit(q, ctx, { action: "organization.settings_updated", entityType: "organization", entityId: ctx.organizationId, summary: "Organization settings updated", before, after });
    return after;
  });
}
