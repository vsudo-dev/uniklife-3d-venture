import { authed, json } from "@/lib/api";
import { searchVisitAssignees } from "@/lib/services/site-visits";

/** Only employees inside the caller's permitted network are returned. */
export const GET = authed(async (req, ctx) => json(await searchVisitAssignees(ctx, (req.nextUrl.searchParams.get("q") ?? "").slice(0, 60))));
