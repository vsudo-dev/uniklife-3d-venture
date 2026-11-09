import { authed, body, json } from "@/lib/api";
import { createSettlement, listSettlements, settlementCreateSchema } from "@/lib/services/commissions";

export const GET = authed(async (_req, ctx) => json(await listSettlements(ctx)));

/** Weekly (Monday start) or monthly (1st) settlement of approved, unsettled entries. */
export const POST = authed(async (req, ctx) => json(await createSettlement(ctx, await body(req, settlementCreateSchema)), 201));
