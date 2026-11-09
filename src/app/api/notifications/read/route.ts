import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { markRead, unreadCount } from "@/lib/services/notifications";

const schema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }),
]);

export const POST = authed(async (req, ctx) => {
  const input = await body(req, schema);
  await markRead(ctx, "all" in input ? "all" : input.ids);
  return json({ ok: true, unread: await unreadCount(ctx) });
});
