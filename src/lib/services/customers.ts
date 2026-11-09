import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff } from "@/lib/auth/context";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { db } from "./common";

export const customerInputSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid phone number"),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  address: z.string().trim().max(500).optional().nullable(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const normalizePhone = (p: string) => p.replace(/[^0-9+]/g, "");

/** Resolves (or creates) the customer for a hold/booking according to the caller's role. */
export async function resolveCustomer(
  ctx: AuthContext,
  q: Queryable,
  input: { customerId?: string | null; customer?: CustomerInput | null },
): Promise<{ id: string; fullName: string; phone: string | null; email: string | null }> {
  if (ctx.role === "customer") {
    if (!ctx.customerId) throw forbidden("Your customer profile is incomplete");
    const [c] = await q.query<{ id: string; full_name: string; phone: string | null; email: string | null }>(
      "select id, full_name, phone, email from customers where id = $1 and organization_id = $2",
      [ctx.customerId, ctx.organizationId],
    );
    if (!c) throw forbidden();
    return { id: c.id, fullName: c.full_name, phone: c.phone, email: c.email };
  }
  assertPermission(ctx, "booking.create");
  if (input.customerId) {
    const [c] = await q.query<{ id: string; full_name: string; phone: string | null; email: string | null }>(
      "select id, full_name, phone, email from customers where id = $1 and organization_id = $2",
      [input.customerId, ctx.organizationId],
    );
    if (!c) throw notFound("Customer");
    return { id: c.id, fullName: c.full_name, phone: c.phone, email: c.email };
  }
  if (!input.customer) throw badRequest("Customer details are required");
  const phone = normalizePhone(input.customer.phone);
  const [existing] = await q.query<{ id: string; full_name: string; phone: string | null; email: string | null }>(
    "select id, full_name, phone, email from customers where organization_id = $1 and phone = $2 order by created_at limit 1",
    [ctx.organizationId, phone],
  );
  if (existing) return { id: existing.id, fullName: existing.full_name, phone: existing.phone, email: existing.email };
  const [c] = await q.query<{ id: string; full_name: string; phone: string | null; email: string | null }>(
    `insert into customers (organization_id, full_name, phone, email, address) values ($1,$2,$3,$4,$5)
     returning id, full_name, phone, email`,
    [ctx.organizationId, input.customer.fullName, phone, input.customer.email ?? null, input.customer.address ?? null],
  );
  return { id: c.id, fullName: c.full_name, phone: c.phone, email: c.email };
}

export async function searchCustomers(ctx: AuthContext, term: string) {
  assertStaff(ctx);
  assertPermission(ctx, "booking.create");
  const q = await db();
  const t = `%${term.toLowerCase()}%`;
  if (ctx.networkEmployeeIds === null) {
    return q.query<{ id: string; full_name: string; phone: string | null; email: string | null }>(
      `select id, full_name, phone, email from customers where organization_id = $1
         and (lower(full_name) like $2 or coalesce(phone,'') like $2 or lower(coalesce(email,'')) like $2)
       order by full_name limit 15`,
      [ctx.organizationId, t],
    );
  }
  // Network-scoped staff: customers their network already works with, or an exact phone match.
  return q.query<{ id: string; full_name: string; phone: string | null; email: string | null }>(
    `select c.id, c.full_name, c.phone, c.email from customers c
      where c.organization_id = $1
        and (
          c.phone = $4
          or ((lower(c.full_name) like $2 or coalesce(c.phone,'') like $2) and (
               exists (select 1 from bookings b where b.customer_id = c.id and (b.credited_employee_id = any($3::uuid[]) or b.requested_by = $5))
            or exists (select 1 from reservations r where r.customer_id = c.id and (r.credited_employee_id = any($3::uuid[]) or r.created_by = $5))
            or exists (select 1 from enquiries e where e.customer_id = c.id and e.assigned_employee_id = any($3::uuid[]))))
        )
      order by c.full_name limit 15`,
    [ctx.organizationId, t, ctx.networkEmployeeIds, normalizePhone(term), ctx.user.id],
  );
}
