import { authed } from "@/lib/api";
import { statementWorkbook } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { badRequest } from "@/lib/errors";
import { xlsxResponse } from "../xlsx";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Personal commission statement (XLSX): own entries, or a descendant's for managers. */
export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const employeeId = sp.get("employeeId") || undefined;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  if (employeeId && !isUuid(employeeId)) throw badRequest("Invalid employee id");
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw badRequest("Dates must be YYYY-MM-DD");
  const { buffer, filename } = await statementWorkbook(ctx, { employeeId, from, to });
  return xlsxResponse(buffer, filename);
});
