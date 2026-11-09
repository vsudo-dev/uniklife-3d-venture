import { authed, json } from "@/lib/api";
import { listWebhookEvents } from "@/lib/services/integration";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json(await listWebhookEvents(ctx, { status: sp.get("status") ?? undefined }));
});
