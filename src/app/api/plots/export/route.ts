import { authed } from "@/lib/api";
import { exportPlotsCsv, plotFilterSchema } from "@/lib/services/plots";
import { contentDisposition } from "@/lib/services/assets";

/** CSV export of the (filtered) inventory. Permission-checked and venture-scoped in the service. */
export const GET = authed(async (req, ctx) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const filters = plotFilterSchema.parse({ ...sp, ventureId: sp.ventureId ?? sp.venture, page: undefined, pageSize: undefined });
  const { csv, fileName } = await exportPlotsCsv(ctx, filters);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store, private",
    },
  });
});
