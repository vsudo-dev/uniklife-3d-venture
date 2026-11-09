import { authed, body, json } from "@/lib/api";
import { sendTestEvent } from "@/lib/services/integration";
import { z } from "zod";

/** POST — enqueue + dispatch an `integration.test` event with safe sample data (test: true). */
const schema = z.object({ connection_id: z.string().uuid().optional() });
export const POST = authed(async (req, ctx) => json(await sendTestEvent(ctx, await body(req, schema)), 201));
