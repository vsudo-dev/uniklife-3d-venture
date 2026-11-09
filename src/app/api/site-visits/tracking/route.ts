import { authed, json } from "@/lib/api";
import { listTeamTracking } from "@/lib/services/site-visits";

/** Team tracking for a day (YYYY-MM-DD, IST). Network-scoped in the service. */
export const GET = authed(async (req, ctx) => json(await listTeamTracking(ctx, req.nextUrl.searchParams.get("date"))));
