import { authed, body, json } from "@/lib/api";
import { createEmployee, employeeInputSchema, listEmployees } from "@/lib/services/employees";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const items = await listEmployees(ctx, { q: sp.get("q") ?? undefined, status: sp.get("status") || undefined });
  return json({ items });
});

export const POST = authed(async (req, ctx) => {
  const input = await body(req, employeeInputSchema);
  const row = await createEmployee(ctx, input);
  return json({ id: row.id, employeeCode: row.employee_code }, 201);
});
