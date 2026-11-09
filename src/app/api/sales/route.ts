import { authed, json } from "@/lib/api";
import { salesMetrics } from "@/lib/services/dashboard";
import { isUuid } from "@/lib/services/common";

export const GET = authed(async (req, ctx) => {
  const v = req.nextUrl.searchParams.get("venture");
  return json(await salesMetrics(ctx, { ventureId: isUuid(v) ? v : undefined }));
});
