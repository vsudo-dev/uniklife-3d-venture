import { authed, json } from "@/lib/api";
import { listAuditLogs } from "@/lib/services/audit-log";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, ctx) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  return json(await listAuditLogs(ctx, sp));
});
