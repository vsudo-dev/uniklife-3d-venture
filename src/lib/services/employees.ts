import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { constraintName, isPgError } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff, can, inNetwork } from "@/lib/auth/context";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import type { ChainMember } from "@/lib/commissions/engine";
import { db, withTx } from "./common";
import { parseCsv } from "@/lib/csv";

export interface EmployeeRow {
  id: string;
  employee_code: string;
  full_name: string;
  mobile: string | null;
  email: string | null;
  designation: string | null;
  commission_level: number | null;
  commission_eligible: boolean;
  reporting_manager_id: string | null;
  manager_code: string | null;
  manager_name: string | null;
  employment_status: string;
  joining_date: string | null;
  user_id: string | null;
  user_email: string | null;
  hrm_reference: string | null;
  venture_ids: string[];
  direct_reports: number;
}

const EMPLOYEE_SELECT = `
  select e.id, e.employee_code, e.full_name, e.mobile, e.email, e.designation, e.commission_level, e.commission_eligible,
         e.reporting_manager_id, m.employee_code as manager_code, m.full_name as manager_name,
         e.employment_status, to_char(e.joining_date, 'YYYY-MM-DD') as joining_date, e.user_id, u.email as user_email,
         e.hrm_reference,
         coalesce((select array_agg(va.venture_id) from venture_assignments va where va.employee_id = e.id), '{}') as venture_ids,
         (select count(*)::int from employees d where d.reporting_manager_id = e.id) as direct_reports
    from employees e
    left join employees m on m.id = e.reporting_manager_id
    left join app_users u on u.id = e.user_id`;

/** Employees the caller may see: whole directory with employee.view_all, else own network. */
export async function listEmployees(ctx: AuthContext, filters: { q?: string; status?: string } = {}): Promise<EmployeeRow[]> {
  assertStaff(ctx);
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["e.organization_id = $1"];
  if (!can(ctx, "employee.view_all") && ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds);
    where.push(`e.id = any($${params.length}::uuid[])`);
  } else if (!can(ctx, "employee.view_all")) {
    // org-wide record scope (venture manager) still only sees own network in the directory
    params.push(ctx.employee ? [ctx.employee.id] : []);
    where.push(`e.id = any($${params.length}::uuid[])`);
  }
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    where.push(`(lower(e.full_name) like $${params.length} or lower(e.employee_code) like $${params.length} or coalesce(e.mobile,'') like $${params.length})`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`e.employment_status = $${params.length}`);
  }
  return q.query<EmployeeRow>(`${EMPLOYEE_SELECT} where ${where.join(" and ")} order by e.commission_level nulls last, e.full_name`, params);
}

export async function getEmployee(ctx: AuthContext, id: string): Promise<EmployeeRow> {
  assertStaff(ctx);
  const q = await db();
  const [row] = await q.query<EmployeeRow>(`${EMPLOYEE_SELECT} where e.organization_id = $1 and e.id = $2`, [ctx.organizationId, id]);
  if (!row) throw notFound("Employee");
  if (!can(ctx, "employee.view_all") && !(ctx.networkEmployeeIds ?? (ctx.employee ? [ctx.employee.id] : [])).includes(id)) {
    throw notFound("Employee");
  }
  return row;
}

/** Upline chain: the employee first, then reporting managers upward. */
export async function getUplineChain(q: Queryable, orgId: string, employeeId: string): Promise<(ChainMember & { userId: string | null; designation: string | null })[]> {
  const rows = await q.query<{
    id: string; employee_code: string; full_name: string; commission_level: number | null;
    employment_status: string; commission_eligible: boolean; user_id: string | null; designation: string | null; depth: number;
  }>(
    `with recursive up(id, depth) as (
       select id, 0 from employees where id = $1 and organization_id = $2
       union all
       select e.reporting_manager_id, up.depth + 1 from employees e join up on e.id = up.id
        where e.reporting_manager_id is not null and up.depth < 64
     )
     select e.id, e.employee_code, e.full_name, e.commission_level, e.employment_status, e.commission_eligible,
            e.user_id, e.designation, up.depth
       from up join employees e on e.id = up.id
      order by up.depth`,
    [employeeId, orgId],
  );
  return rows.map((r) => ({
    employeeId: r.id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    commissionLevel: r.commission_level,
    active: r.employment_status === "active",
    commissionEligible: r.commission_eligible,
    userId: r.user_id,
    designation: r.designation,
  }));
}

/**
 * Resolves the employee to credit for a booking/hold.
 * - Customers can never choose attribution.
 * - Staff may credit themselves, or (managers) someone in their own network;
 *   org-wide roles may credit any active employee. An ID outside the caller's
 *   permitted set is reported as "not found" so IDs cannot be probed or impersonated.
 */
export async function resolveCreditedEmployee(
  ctx: AuthContext,
  q: Queryable,
  code: string | null | undefined,
): Promise<{ id: string; code: string; fullName: string } | null> {
  if (ctx.role === "customer") return null;
  const trimmed = (code ?? "").trim().toUpperCase();
  if (!trimmed) return ctx.employee ? { id: ctx.employee.id, code: ctx.employee.code, fullName: ctx.employee.fullName } : null;
  const [e] = await q.query<{ id: string; employee_code: string; full_name: string; employment_status: string }>(
    "select id, employee_code, full_name, employment_status from employees where organization_id = $1 and upper(employee_code) = $2",
    [ctx.organizationId, trimmed],
  );
  const permitted =
    e && e.employment_status === "active" && (can(ctx, "employee.view_all") || inNetwork(ctx, e.id));
  if (!permitted) throw notFound("Employee ID");
  return { id: e.id, code: e.employee_code, fullName: e.full_name };
}

/** Booking employee selector: only staff the caller is permitted to credit. */
export async function searchCreditableEmployees(ctx: AuthContext, term: string) {
  assertPermission(ctx, "booking.create");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["organization_id = $1", "employment_status = 'active'"];
  if (!can(ctx, "employee.view_all")) {
    params.push(ctx.networkEmployeeIds ?? (ctx.employee ? [ctx.employee.id] : []));
    where.push(`id = any($${params.length}::uuid[])`);
  }
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    where.push(`(lower(full_name) like $${params.length} or lower(employee_code) like $${params.length})`);
  }
  return q.query<{ id: string; employee_code: string; full_name: string; designation: string | null }>(
    `select id, employee_code, full_name, designation from employees where ${where.join(" and ")} order by full_name limit 20`,
    params,
  );
}

export const employeeInputSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  mobile: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid mobile number").optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  designation: z.string().trim().max(80).optional().nullable(),
  commissionLevel: z.coerce.number().int().min(1).max(12).optional().nullable(),
  commissionEligible: z.boolean().default(true),
  reportingManagerId: z.string().uuid().optional().nullable(),
  employmentStatus: z.enum(["active", "on_leave", "resigned", "terminated"]).default("active"),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  ventureIds: z.array(z.string().uuid()).default([]),
  hrmReference: z.string().trim().max(80).optional().nullable(),
});
export type EmployeeInput = z.infer<typeof employeeInputSchema>;

/** Allocates the next unique employee code for the organization (row-locked counter). */
export async function nextEmployeeCode(q: Queryable, orgId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const [o] = await q.query<{ prefix: string; n: number }>(
      `update organizations set next_employee_number = next_employee_number + 1
        where id = $1 returning employee_code_prefix as prefix, next_employee_number - 1 as n`,
      [orgId],
    );
    const code = `${o.prefix}-${String(o.n).padStart(5, "0")}`;
    const [taken] = await q.query("select 1 from employees where organization_id = $1 and upper(employee_code) = $2", [orgId, code]);
    if (!taken) return code;
  }
  throw conflict("Could not allocate an employee ID");
}

async function assertVenturesInOrg(q: Queryable, orgId: string, ventureIds: string[]) {
  if (ventureIds.length === 0) return;
  const rows = await q.query("select id from ventures where organization_id = $1 and id = any($2::uuid[])", [orgId, ventureIds]);
  if (rows.length !== new Set(ventureIds).size) throw badRequest("One or more ventures are invalid");
}

async function assertManagerInOrg(q: Queryable, orgId: string, managerId: string | null | undefined) {
  if (!managerId) return;
  const [m] = await q.query("select 1 from employees where organization_id = $1 and id = $2", [orgId, managerId]);
  if (!m) throw badRequest("Reporting manager not found");
}

function employeeEventData(e: Record<string, unknown>) {
  return {
    employee_id: e.id,
    employee_code: e.employee_code,
    full_name: e.full_name,
    designation: e.designation,
    commission_level: e.commission_level,
    reporting_manager_id: e.reporting_manager_id,
    employment_status: e.employment_status,
  };
}

export async function createEmployee(ctx: AuthContext, input: EmployeeInput, opts: { userId?: string | null; tx?: Queryable } = {}) {
  assertPermission(ctx, "employee.manage");
  const run = async (q: Queryable) => {
    await assertManagerInOrg(q, ctx.organizationId, input.reportingManagerId);
    await assertVenturesInOrg(q, ctx.organizationId, input.ventureIds);
    const code = await nextEmployeeCode(q, ctx.organizationId);
    let row: Record<string, unknown>;
    try {
      [row] = await q.query<Record<string, unknown>>(
        `insert into employees (organization_id, employee_code, user_id, full_name, mobile, email, designation, commission_level,
                                commission_eligible, reporting_manager_id, employment_status, joining_date, hrm_reference)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [
          ctx.organizationId, code, opts.userId ?? null, input.fullName, input.mobile ?? null, input.email ?? null,
          input.designation ?? null, input.commissionLevel ?? null, input.commissionEligible, input.reportingManagerId ?? null,
          input.employmentStatus, input.joiningDate ?? null, input.hrmReference ?? null,
        ],
      );
    } catch (e) {
      if (isPgError(e, "23505") && constraintName(e) === "employees_org_user_key") throw conflict("This user is already linked to an employee");
      throw e;
    }
    for (const v of input.ventureIds) {
      await q.query("insert into venture_assignments (organization_id, venture_id, employee_id) values ($1,$2,$3)", [ctx.organizationId, v, row.id]);
    }
    await writeAudit(q, ctx, { action: "employee.created", entityType: "employee", entityId: String(row.id), summary: `Created employee ${code}`, after: row });
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "employee.created", aggregateType: "employee", aggregateId: String(row.id),
      idempotencyKey: `employee.created:${row.id}`, data: employeeEventData(row),
    });
    return row;
  };
  return opts.tx ? run(opts.tx) : withTx(run);
}

export async function updateEmployee(ctx: AuthContext, id: string, input: EmployeeInput) {
  assertPermission(ctx, "employee.manage");
  return withTx(async (q) => {
    const [before] = await q.query<Record<string, unknown>>("select * from employees where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
    if (!before) throw notFound("Employee");
    if (input.reportingManagerId && input.reportingManagerId === id) throw badRequest("An employee cannot report to themselves");
    await assertManagerInOrg(q, ctx.organizationId, input.reportingManagerId);
    await assertVenturesInOrg(q, ctx.organizationId, input.ventureIds);
    let after: Record<string, unknown>;
    try {
      [after] = await q.query<Record<string, unknown>>(
        `update employees set full_name=$3, mobile=$4, email=$5, designation=$6, commission_level=$7, commission_eligible=$8,
                reporting_manager_id=$9, employment_status=$10, joining_date=$11, hrm_reference=$12
          where organization_id = $1 and id = $2 returning *`,
        [
          ctx.organizationId, id, input.fullName, input.mobile ?? null, input.email ?? null, input.designation ?? null,
          input.commissionLevel ?? null, input.commissionEligible, input.reportingManagerId ?? null, input.employmentStatus,
          input.joiningDate ?? null, input.hrmReference ?? null,
        ],
      );
    } catch (e) {
      if (isPgError(e, "P0001")) throw badRequest((e as Error).message);
      throw e;
    }
    await q.query("delete from venture_assignments where employee_id = $1", [id]);
    for (const v of input.ventureIds) {
      await q.query("insert into venture_assignments (organization_id, venture_id, employee_id) values ($1,$2,$3)", [ctx.organizationId, v, id]);
    }
    await writeAudit(q, ctx, { action: "employee.updated", entityType: "employee", entityId: id, summary: `Updated employee ${after.employee_code}`, before, after });
    const stamp = new Date().toISOString();
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "employee.updated", aggregateType: "employee", aggregateId: id,
      idempotencyKey: `employee.updated:${id}:${stamp}`, data: employeeEventData(after),
    });
    if (before.reporting_manager_id !== after.reporting_manager_id) {
      await writeAudit(q, ctx, {
        action: "employee.manager_changed", entityType: "employee", entityId: id,
        summary: `Reporting manager changed for ${after.employee_code}`,
        before: { reporting_manager_id: before.reporting_manager_id }, after: { reporting_manager_id: after.reporting_manager_id },
      });
      await enqueueOutboundEvent(q, {
        organizationId: ctx.organizationId, eventType: "employee.manager_changed", aggregateType: "employee", aggregateId: id,
        idempotencyKey: `employee.manager_changed:${id}:${stamp}`,
        data: { employee_id: id, employee_code: after.employee_code, from_manager_id: before.reporting_manager_id, to_manager_id: after.reporting_manager_id },
      });
    }
    return after;
  });
}

// ---------------------------------------------------------------------------
// Administrator-approved imports: preview (dry run) then commit.
// ---------------------------------------------------------------------------
export interface ImportPreviewRow {
  line: number;
  fullName: string;
  mobile: string | null;
  email: string | null;
  designation: string | null;
  commissionLevel: number | null;
  managerRef: string | null; // employee code or hrm reference of manager (existing or earlier in file)
  hrmReference: string | null;
  joiningDate: string | null;
  errors: string[];
}

export async function previewEmployeeImport(ctx: AuthContext, csvText: string): Promise<{ rows: ImportPreviewRow[]; valid: number; invalid: number }> {
  assertPermission(ctx, "employee.manage");
  const q = await db();
  const { rows } = parseCsv(csvText);
  const existing = await q.query<{ employee_code: string; hrm_reference: string | null; mobile: string | null }>(
    "select employee_code, hrm_reference, mobile from employees where organization_id = $1",
    [ctx.organizationId],
  );
  const knownRefs = new Set(existing.flatMap((e) => [e.employee_code.toUpperCase(), (e.hrm_reference ?? "").toUpperCase()]).filter(Boolean));
  const knownMobiles = new Set(existing.map((e) => e.mobile).filter(Boolean));
  const fileRefs = new Set<string>();
  const fileMobiles = new Set<string>();
  const out: ImportPreviewRow[] = rows.map((r, i) => {
    const get = (k: string) => (r[k] ?? "").trim() || null;
    const row: ImportPreviewRow = {
      line: i + 2,
      fullName: get("full_name") ?? "",
      mobile: get("mobile"),
      email: get("email"),
      designation: get("designation"),
      commissionLevel: get("commission_level") ? Number(get("commission_level")) : null,
      managerRef: get("manager_ref")?.toUpperCase() ?? null,
      hrmReference: get("hrm_reference"),
      joiningDate: get("joining_date"),
      errors: [],
    };
    if (row.fullName.length < 2) row.errors.push("full_name is required");
    if (row.commissionLevel !== null && !(Number.isInteger(row.commissionLevel) && row.commissionLevel >= 1 && row.commissionLevel <= 12)) {
      row.errors.push("commission_level must be 1-12");
    }
    if (row.mobile && !/^\+?[0-9 -]{7,20}$/.test(row.mobile)) row.errors.push("invalid mobile");
    if (row.mobile && knownMobiles.has(row.mobile)) row.errors.push("mobile already exists in directory");
    else if (row.mobile && fileMobiles.has(row.mobile)) row.errors.push("duplicate mobile in file");
    if (row.mobile) fileMobiles.add(row.mobile);
    if (row.joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.joiningDate)) row.errors.push("joining_date must be YYYY-MM-DD");
    if (row.hrmReference) {
      const ref = row.hrmReference.toUpperCase();
      if (knownRefs.has(ref) || fileRefs.has(ref)) row.errors.push("duplicate hrm_reference");
    }
    if (row.managerRef && !knownRefs.has(row.managerRef) && !fileRefs.has(row.managerRef)) {
      row.errors.push("manager_ref not found (must be an existing employee ID / HRM ref, or appear earlier in the file)");
    }
    if (row.hrmReference) fileRefs.add(row.hrmReference.toUpperCase());
    return row;
  });
  const invalid = out.filter((r) => r.errors.length > 0).length;
  return { rows: out, valid: out.length - invalid, invalid };
}

export async function commitEmployeeImport(ctx: AuthContext, csvText: string) {
  assertPermission(ctx, "employee.manage");
  if (ctx.role !== "org_admin" && ctx.role !== "platform_admin") throw badRequest("Imports must be approved by an organization administrator");
  const preview = await previewEmployeeImport(ctx, csvText);
  if (preview.invalid > 0) throw badRequest("Fix invalid rows before importing", preview.rows.filter((r) => r.errors.length));
  return withTx(async (q) => {
    const created: string[] = [];
    for (const r of preview.rows) {
      let managerId: string | null = null;
      if (r.managerRef) {
        const [m] = await q.query<{ id: string }>(
          "select id from employees where organization_id = $1 and (upper(employee_code) = $2 or upper(hrm_reference) = $2)",
          [ctx.organizationId, r.managerRef],
        );
        managerId = m?.id ?? null;
      }
      const row = await createEmployee(
        ctx,
        {
          fullName: r.fullName, mobile: r.mobile, email: r.email, designation: r.designation, commissionLevel: r.commissionLevel,
          commissionEligible: true, reportingManagerId: managerId, employmentStatus: "active", joiningDate: r.joiningDate,
          ventureIds: [], hrmReference: r.hrmReference,
        },
        { tx: q },
      );
      created.push(String(row.employee_code));
    }
    await writeAudit(q, ctx, { action: "employee.import_committed", entityType: "employee", summary: `Imported ${created.length} employees`, metadata: { codes: created } });
    return { created };
  });
}

/** Reporting-manager options for the employee form (organization employees only). */
export async function listManagerOptions(ctx: AuthContext, excludeId?: string) {
  assertPermission(ctx, "employee.manage");
  const q = await db();
  return q.query<{ id: string; employee_code: string; full_name: string; commission_level: number | null; employment_status: string }>(
    `select id, employee_code, full_name, commission_level, employment_status from employees
      where organization_id = $1 and ($2::uuid is null or id <> $2::uuid)
      order by commission_level nulls last, full_name`,
    [ctx.organizationId, excludeId ?? null],
  );
}

/** Ventures of the organization for the venture-assignment multi-select. */
export async function listVentureOptions(ctx: AuthContext) {
  assertPermission(ctx, "employee.manage");
  const q = await db();
  return q.query<{ id: string; name: string; code: string; status: string }>(
    "select id, name, code, status from ventures where organization_id = $1 order by name",
    [ctx.organizationId],
  );
}

/** Direct reports of an employee (employee.view_all). */
export async function listDirectReports(ctx: AuthContext, employeeId: string) {
  assertPermission(ctx, "employee.view_all");
  const q = await db();
  return q.query<{ id: string; employee_code: string; full_name: string; designation: string | null; commission_level: number | null; employment_status: string }>(
    `select id, employee_code, full_name, designation, commission_level, employment_status from employees
      where organization_id = $1 and reporting_manager_id = $2 order by full_name`,
    [ctx.organizationId, employeeId],
  );
}

/** Directory headline counts (employee.view_all). */
export async function employeeDirectoryStats(ctx: AuthContext) {
  assertPermission(ctx, "employee.view_all");
  const q = await db();
  const [r] = await q.query<{ total: number; active: number; linked: number; unassigned_manager: number }>(
    `select count(*)::int as total,
            count(*) filter (where employment_status = 'active')::int as active,
            count(user_id)::int as linked,
            count(*) filter (where reporting_manager_id is null)::int as unassigned_manager
       from employees where organization_id = $1`,
    [ctx.organizationId],
  );
  return r;
}

export const EMPLOYEE_IMPORT_TEMPLATE =
  "full_name,mobile,email,designation,commission_level,manager_ref,hrm_reference,joining_date\r\n" +
  "Asha Reddy,+919800000001,asha@example.com,Sales Manager,4,EMP-00118,HRM-1001,2024-04-01\r\n" +
  "Rahul Varma,+919800000002,rahul@example.com,Sales Executive,5,HRM-1001,HRM-1002,2024-05-15\r\n";

/** Direct reports + team stats for the Network screen (own network only). */
export async function getMyNetwork(ctx: AuthContext, rootEmployeeId?: string) {
  assertStaff(ctx);
  const q = await db();
  const root = rootEmployeeId ?? ctx.employee?.id;
  if (!root) return { root: null, members: [] };
  const allowed = can(ctx, "employee.view_all") || (ctx.networkEmployeeIds ?? [ctx.employee?.id]).includes(root);
  if (!allowed) throw notFound("Employee");
  const members = await q.query<{
    id: string; employee_code: string; full_name: string; designation: string | null; commission_level: number | null;
    reporting_manager_id: string | null; depth: number; employment_status: string;
    bookings: number; confirmed_bookings: number; booked_area: string;
  }>(
    `with recursive tree(id, depth) as (
       select id, 0 from employees where id = $1 and organization_id = $2
       union all
       select e.id, t.depth + 1 from employees e join tree t on e.reporting_manager_id = t.id where t.depth < 64
     )
     select e.id, e.employee_code, e.full_name, e.designation, e.commission_level, e.reporting_manager_id, t.depth, e.employment_status,
            (select count(*)::int from bookings b where b.credited_employee_id = e.id and b.status <> 'expired') as bookings,
            (select count(*)::int from bookings b where b.credited_employee_id = e.id and b.status in ('confirmed','completed')) as confirmed_bookings,
            (select coalesce(sum(b.total_area_sq_yards),0) from bookings b where b.credited_employee_id = e.id and b.status in ('confirmed','completed')) as booked_area
       from tree t join employees e on e.id = t.id
      order by t.depth, e.full_name`,
    [root, ctx.organizationId],
  );
  return { root, members };
}
