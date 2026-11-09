import { authed, json } from "@/lib/api";
import { listOutbound } from "@/lib/services/integration";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json(await listOutbound(ctx, { status: sp.get("status") ?? undefined, type: sp.get("type") ?? undefined, limit: Number(sp.get("limit") ?? 100) || 100 }));
});
