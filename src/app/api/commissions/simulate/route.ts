import { authed, body, json } from "@/lib/api";
import { simulate, simulateSchema } from "@/lib/services/commissions";

export const POST = authed(async (req, ctx) => json(await simulate(ctx, await body(req, simulateSchema))));
