import { authed, body, json, rateLimit } from "@/lib/api";
import { createSiteVisit, listSiteVisits, siteVisitCreateSchema } from "@/lib/services/site-visits";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json(
    await listSiteVisits(ctx, {
      status: sp.get("status") ?? undefined,
      ventureId: sp.get("venture") ?? undefined,
      mine: sp.get("mine") === "1",
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      q: sp.get("q")?.slice(0, 60) ?? undefined,
    }),
  );
});

/** Staff schedule visits; customers request a visit for themselves (status "requested"). */
export const POST = authed(async (req, ctx) => {
  if (ctx.role === "customer") rateLimit(`site-visit:${ctx.user.id}`, 5, 60 * 60_000);
  return json(await createSiteVisit(ctx, await body(req, siteVisitCreateSchema)), 201);
});
