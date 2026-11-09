import { authed, json } from "@/lib/api";
import { notificationCounts } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => {
  const c = await notificationCounts(ctx);
  return json({ unread: c.unread, total: c.total, byType: c.byType });
});
