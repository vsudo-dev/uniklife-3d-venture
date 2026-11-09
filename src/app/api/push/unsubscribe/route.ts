import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { unsubscribePush } from "@/lib/push";

const schema = z.object({ endpoint: z.string().url().max(1000) });

/** POST — remove one of the current user's push subscriptions. */
export const POST = authed(async (req, ctx) => {
  const { endpoint } = await body(req, schema);
  return json(await unsubscribePush(ctx, endpoint));
});
