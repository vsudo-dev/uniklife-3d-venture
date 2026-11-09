import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, can, canAccessVenture, inNetwork } from "@/lib/auth/context";
import { badRequest, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { db, withTx } from "./common";
import { normalizePhone } from "./customers";
import { createNotification } from "./notifications";

export const enquiryCreateSchema = z.object({
  ventureId: z.string().uuid(),
  plotId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid mobile number"),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  message: z.string().trim().max(2000).optional().nullable(),
  source: z.enum(["web", "3d_viewer", "portal", "staff"]).default("web"),
  assignedEmployeeId: z.string().uuid().optional().nullable(),
  website: z.string().max(0).optional(), // honeypot — must stay empty
});

/** Creates an enquiry. Works for customers, staff (attributed) and is the target of the public form. */
export async function createEnquiry(ctx: AuthContext | null, orgIdForPublic: string | null, input: z.infer<typeof enquiryCreateSchema>) {
  return withTx(async (q) => {
    const orgId = ctx?.organizationId ?? orgIdForPublic;
    if (!orgId) throw badRequest("Organization could not be determined");
    const [v] = await q.query<{ id: string; name: string; is_published: boolean }>(
      "select id, name, is_published from ventures where organization_id = $1 and id = $2",
      [orgId, input.ventureId],
    );
    if (!v || ((!ctx || ctx.role === "customer") && !v.is_published) || (ctx && ctx.role !== "customer" && !canAccessVenture(ctx, v.id))) throw notFound("Venture");
    let plotNumber: string | null = null;
    if (input.plotId) {
      const [p] = await q.query<{ plot_number: string }>("select plot_number from plots where id = $1 and venture_id = $2", [input.plotId, v.id]);
      if (!p) throw notFound("Plot");
      plotNumber = p.plot_number;
    }
    // Staff may assign within their permitted network; defaults to themselves.
    let assigned: string | null = null;
    if (ctx && ctx.role !== "customer") {
      assertPermission(ctx, "enquiry.manage");
      assigned = input.assignedEmployeeId ?? ctx.employee?.id ?? null;
      if (assigned && !can(ctx, "employee.view_all") && !inNetwork(ctx, assigned)) throw notFound("Employee");
    }
    const customerId = ctx?.role === "customer" ? ctx.customerId : null;
    const [row] = await q.query<{ id: string }>(
      `insert into enquiries (organization_id, venture_id, plot_id, customer_id, name, email, phone, message, source, assigned_employee_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [orgId, v.id, input.plotId ?? null, customerId, input.name, input.email ?? null, normalizePhone(input.phone), input.message ?? null,
        ctx && ctx.role !== "customer" ? "staff" : input.source, assigned, ctx?.user.id ?? null],
    );
    await writeAudit(q, ctx ?? { system: true, organizationId: orgId }, {
      action: "enquiry.created", entityType: "enquiry", entityId: row.id, summary: `Enquiry for ${v.name}${plotNumber ? ` plot ${plotNumber}` : ""}`,
    });
    await enqueueOutboundEvent(q, {
      organizationId: orgId, eventType: "plot.enquiry.created", aggregateType: "enquiry", aggregateId: row.id, idempotencyKey: `enquiry.created:${row.id}`,
      data: { enquiry_id: row.id, venture_id: v.id, venture_name: v.name, plot_number: plotNumber, name: input.name, phone: normalizePhone(input.phone), email: input.email ?? null, message: input.message ?? null, source: input.source },
    });
    // Unassigned web enquiries: notify org admins and sales managers.
    if (assigned) {
      const [owner] = await q.query<{ user_id: string | null }>("select user_id from employees where id=$1 and organization_id=$2", [assigned,orgId]);
      if (owner?.user_id) await createNotification(q,{organizationId:orgId,recipientUserId:owner.user_id,type:"system",title:"New lead received",body:`${input.name} enquired about ${v.name}.`,link:`/enquiries?focus=${row.id}`,dedupeKey:`enquiry:${row.id}:${owner.user_id}`});
    } else {
      const managers = await q.query<{ user_id: string }>(
        "select user_id from organization_members where organization_id = $1 and role in ('org_admin','sales_manager') and status = 'active'",
        [orgId],
      );
      for (const m of managers) {
        await createNotification(q, {
          organizationId: orgId, recipientUserId: m.user_id, type: "system", title: "New enquiry",
          body: `${input.name} enquired about ${plotNumber ? `Plot ${plotNumber} in ` : ""}${v.name}.`, link: `/enquiries?focus=${row.id}`,
          followUpAction: "Assign and contact the lead", dedupeKey: `enquiry:${row.id}:${m.user_id}`,
        });
      }
    }
    return { id: row.id };
  });
}

export async function listEnquiries(ctx: AuthContext, f: { status?: string; mine?: boolean; q?: string } = {}) {
  assertPermission(ctx, "enquiry.view");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["e.organization_id = $1"];
  if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    where.push(`e.venture_id = any($${params.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds);
    where.push(`(e.assigned_employee_id = any($${params.length}::uuid[])${ctx.role === "sales_manager" ? " or e.assigned_employee_id is null" : ""})`);
  }
  if (f.mine) {
    params.push(ctx.employee?.id ?? null);
    where.push(`e.assigned_employee_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`e.status = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    where.push(`(lower(e.name) like $${params.length} or e.phone like $${params.length})`);
  }
  return q.query<Record<string, unknown>>(
    `select e.*, v.name as venture_name, p.plot_number, emp.employee_code as assigned_code, emp.full_name as assigned_name
       from enquiries e join ventures v on v.id = e.venture_id left join plots p on p.id = e.plot_id left join employees emp on emp.id = e.assigned_employee_id
      where ${where.join(" and ")} order by e.created_at desc limit 500`,
    params,
  );
}

/** Per-status counts for the enquiry tabs, using the same scope as listEnquiries. */
export async function enquiryStatusCounts(ctx: AuthContext, f: { mine?: boolean } = {}): Promise<Record<string, number>> {
  assertPermission(ctx, "enquiry.view");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["e.organization_id = $1"];
  if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    where.push(`e.venture_id = any($${params.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds);
    where.push(`(e.assigned_employee_id = any($${params.length}::uuid[])${ctx.role === "sales_manager" ? " or e.assigned_employee_id is null" : ""})`);
  }
  if (f.mine) {
    params.push(ctx.employee?.id ?? null);
    where.push(`e.assigned_employee_id = $${params.length}`);
  }
  const rows = await q.query<{ status: string; n: number }>(
    `select e.status, count(*)::int as n from enquiries e where ${where.join(" and ")} group by e.status`,
    params,
  );
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status] = Number(r.n);
    out.all += Number(r.n);
  }
  return out;
}

/** Customer portal: the signed-in customer's own enquiries (no internal assignment details). */
export async function listMyEnquiries(ctx: AuthContext) {
  if (ctx.role !== "customer") throw notFound("Enquiry");
  const q = await db();
  return q.query<{ id: string; status: string; message: string | null; created_at: Date; venture_name: string; plot_number: string | null }>(
    `select e.id, e.status, e.message, e.created_at, v.name as venture_name, p.plot_number
       from enquiries e join ventures v on v.id = e.venture_id left join plots p on p.id = e.plot_id
      where e.organization_id = $1 and (e.customer_id = $2 or e.created_by = $3)
      order by e.created_at desc limit 50`,
    [ctx.organizationId, ctx.customerId, ctx.user.id],
  );
}

export const enquiryUpdateSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "converted", "closed"]).optional(),
  assignedEmployeeId: z.string().uuid().nullable().optional(),
});

export async function updateEnquiry(ctx: AuthContext, id: string, input: z.infer<typeof enquiryUpdateSchema>) {
  assertPermission(ctx, "enquiry.manage");
  return withTx(async (q) => {
    const [e] = await q.query<Record<string, unknown>>("select * from enquiries where organization_id = $1 and id = $2 for update", [ctx.organizationId, id]);
    if (!e || !canAccessVenture(ctx, String(e.venture_id))) throw notFound("Enquiry");
    const visible = ctx.networkEmployeeIds === null || inNetwork(ctx, e.assigned_employee_id as string | null) || (ctx.role === "sales_manager" && !e.assigned_employee_id);
    if (!visible) throw notFound("Enquiry");
    if (input.assignedEmployeeId && !can(ctx, "employee.view_all") && !inNetwork(ctx, input.assignedEmployeeId)) throw notFound("Employee");
    if (input.assignedEmployeeId) {
      const [emp] = await q.query("select 1 from employees where organization_id = $1 and id = $2 and employment_status = 'active'", [ctx.organizationId, input.assignedEmployeeId]);
      if (!emp) throw notFound("Employee");
    }
    const [after] = await q.query<Record<string, unknown>>(
      `update enquiries set status = coalesce($3, status),
              assigned_employee_id = case when $4 then $5::uuid else assigned_employee_id end
        where id = $1 and organization_id = $2 returning *`,
      [id, ctx.organizationId, input.status ?? null, input.assignedEmployeeId !== undefined, input.assignedEmployeeId ?? null],
    );
    await writeAudit(q, ctx, { action: "enquiry.updated", entityType: "enquiry", entityId: id, before: e, after });
    return after;
  });
}
