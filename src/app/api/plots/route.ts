import { authed, json } from "@/lib/api";
import { listPlots, plotFilterSchema } from "@/lib/services/plots";

export const GET = authed(async (req, ctx) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const filters = plotFilterSchema.parse({ ...sp, ventureId: sp.ventureId ?? sp.venture });
  return json(await listPlots(ctx, filters));
});
