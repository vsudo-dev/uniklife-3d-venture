import { authed, json } from "@/lib/api";
import { commissionSummary } from "@/lib/services/commissions";

/** The caller's own commission totals by status. */
export const GET = authed(async (_req, ctx) => json(await commissionSummary(ctx)));
