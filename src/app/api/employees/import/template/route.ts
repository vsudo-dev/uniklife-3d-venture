import { authed } from "@/lib/api";
import { assertPermission } from "@/lib/auth/context";
import { EMPLOYEE_IMPORT_TEMPLATE } from "@/lib/services/employees";

export const GET = authed(async (_req, ctx) => {
  assertPermission(ctx, "employee.manage");
  return new Response(EMPLOYEE_IMPORT_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="employee-import-template.csv"',
      "Cache-Control": "no-store, private",
    },
  });
});
