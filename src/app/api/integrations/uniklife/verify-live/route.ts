import { authed, body, json } from "@/lib/api";
import { verifyLive, verifyLiveSchema } from "@/lib/services/integration";

/** POST — org admin marks the connection as verified for LIVE delivery (or reverts to MOCK). */
export const POST = authed(async (req, ctx) => {
  return json({ connection: await verifyLive(ctx, await body(req, verifyLiveSchema)) });
});
