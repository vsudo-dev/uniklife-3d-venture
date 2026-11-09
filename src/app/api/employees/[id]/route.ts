import { authed, body, json } from "@/lib/api";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";
import { employeeInputSchema, getEmployee, updateEmployee } from "@/lib/services/employees";

export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Employee");
  return json({ employee: await getEmployee(ctx, id) });
});

export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Employee");
  const input = await body(req, employeeInputSchema);
  const row = await updateEmployee(ctx, id, input);
  return json({ id: row.id, employeeCode: row.employee_code });
});
