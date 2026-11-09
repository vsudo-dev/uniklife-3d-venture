import { authed, json } from "@/lib/api";
import { visitFormOptions } from "@/lib/services/site-visits";

export const GET = authed(async (req, ctx) => json(await visitFormOptions(ctx, req.nextUrl.searchParams.get("venture"))));
