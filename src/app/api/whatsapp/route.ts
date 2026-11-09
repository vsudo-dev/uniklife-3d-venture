import { z } from "zod";
import { authed, body, json, rateLimit } from "@/lib/api";
import { connectSchema, connectWhatsapp, disconnectWhatsapp, sendWhatsappTest, testSendSchema, whatsappTemplates } from "@/lib/services/whatsapp";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect") }).merge(connectSchema),
  z.object({ action: z.literal("test") }).merge(testSendSchema),
  z.object({ action: z.literal("templates"), accountId: z.string().uuid() }),
  z.object({ action: z.literal("disconnect"), accountId: z.string().uuid() }),
]);

/** POST /api/whatsapp — connect (Embedded Signup result), test send, list templates, disconnect. Requires integration.manage. */
export const POST = authed(async (req, ctx) => {
  rateLimit(`whatsapp:${ctx.user.id}`, 20, 60_000);
  const input = await body(req, schema);
  switch (input.action) {
    case "connect": return json(await connectWhatsapp(ctx, input), 201);
    case "test": return json(await sendWhatsappTest(ctx, input));
    case "templates": return json({ templates: await whatsappTemplates(ctx, input.accountId) });
    case "disconnect": await disconnectWhatsapp(ctx, input.accountId); return json({ ok: true });
  }
});
