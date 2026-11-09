import { authed, body, json } from "@/lib/api";
import { syncNow } from "@/lib/services/integration";
import { z } from "zod";

/**
 * POST /api/integrations/uniklife/sync — INTERNAL "Dispatch now" trigger: runs the outbox
 * dispatcher for the caller's organization. This is NOT a UNIKLIFE.AI destination endpoint.
 */
const schema = z.object({ connection_id: z.string().uuid().optional() });
export const POST = authed(async (req, ctx) => json(await syncNow(ctx, await body(req, schema))));
