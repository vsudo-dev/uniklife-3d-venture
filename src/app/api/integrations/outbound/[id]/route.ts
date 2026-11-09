import { authed, json } from "@/lib/api";
import { getOutbound } from "@/lib/services/integration";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getOutbound(ctx, id)));
