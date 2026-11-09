import { authed, rateLimit } from "@/lib/api";
import { exportAuditCsv } from "@/lib/services/audit-log";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, ctx) => {
  rateLimit(`audit-export:${ctx.user.id}`, 10, 60_000);
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { csv, truncated } = await exportAuditCsv(ctx, sp);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "Cache-Control": "no-store, private",
      "X-Export-Truncated": truncated ? "1" : "0",
    },
  });
});
