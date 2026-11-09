import { authed, json } from "@/lib/api";
import { listMyNotifications } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const items = await listMyNotifications(ctx, {
    unreadOnly: sp.get("unread") === "1",
    type: sp.get("type") ?? undefined,
    limit: Number(sp.get("limit") ?? 100) || 100,
  });
  return json({ items });
});
