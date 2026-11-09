import { z } from "zod";
import { getDb } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";

/**
 * Web Push (VAPID). Sending is enabled ONLY when VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 * and VAPID_SUBJECT are all set; otherwise pending notifications are marked
 * 'unavailable' (they remain visible in the in-app notification centre).
 */
export function pushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function pushPublicKey(): { enabled: boolean; publicKey: string | null } {
  const c = pushConfig();
  return { enabled: !!c, publicKey: c?.publicKey ?? null };
}

export const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "Push endpoint must use https://"),
  keys: z.object({
    p256dh: z.string().min(16).max(200).regex(/^[A-Za-z0-9_=-]+$/),
    auth: z.string().min(8).max(100).regex(/^[A-Za-z0-9_=-]+$/),
  }),
  userAgent: z.string().max(300).optional(),
});

/** Stores (or re-binds) a browser push subscription for the current user + organization. */
export async function subscribePush(ctx: AuthContext, input: z.infer<typeof subscriptionSchema>) {
  const s = subscriptionSchema.parse(input);
  const db = await getDb();
  return db.transaction(async (q) => {
    // Endpoints are per-browser capability URLs; if the browser switches account it is re-bound.
    const [row] = await q.query<{ id: string }>(
      `insert into push_subscriptions (organization_id, user_id, endpoint, p256dh, auth, user_agent)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (endpoint) do update set organization_id = excluded.organization_id, user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
       returning id`,
      [ctx.organizationId, ctx.user.id, s.endpoint, s.keys.p256dh, s.keys.auth, s.userAgent ?? null],
    );
    await writeAudit(q, ctx, { action: "push.subscribed", entityType: "push_subscription", entityId: row.id, summary: "Push notifications enabled on a device" });
    return { id: row.id, sendingEnabled: !!pushConfig() };
  });
}

export async function unsubscribePush(ctx: AuthContext, endpoint: string) {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    "delete from push_subscriptions where endpoint = $1 and user_id = $2 and organization_id = $3 returning id",
    [endpoint, ctx.user.id, ctx.organizationId],
  );
  return { removed: rows.length };
}

export async function listMyPushSubscriptions(ctx: AuthContext) {
  const db = await getDb();
  return db.query<{ id: string; user_agent: string | null; created_at: Date }>(
    "select id, user_agent, created_at from push_subscriptions where user_id = $1 and organization_id = $2 order by created_at desc",
    [ctx.user.id, ctx.organizationId],
  );
}

function safeLink(link: string | null): string {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : "/dashboard";
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

/** Sends pending push notifications (scheduler). `sender` is a test seam. */
export async function processPushQueue(limit = 100, sender?: Sender): Promise<{ sent: number; failed: number; unavailable: number; removedSubscriptions: number }> {
  const db = await getDb();
  const cfg = pushConfig();
  if (!cfg && !sender) {
    const rows = await db.query<{ id: string }>("update notifications set push_status = 'unavailable' where push_status = 'pending' returning id");
    return { sent: 0, failed: 0, unavailable: rows.length, removedSubscriptions: 0 };
  }
  let send: Sender;
  if (sender) send = sender;
  else {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(cfg!.subject, cfg!.publicKey, cfg!.privateKey);
    send = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600 });
  }

  return db.transaction(async (q) => {
    const due = await q.query<{ id: string; organization_id: string; recipient_user_id: string; title: string; body: string; link: string | null }>(
      `select id, organization_id, recipient_user_id, title, body, link from notifications
        where push_status = 'pending' order by created_at limit $1 for update skip locked`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    let sent = 0, failed = 0, unavailable = 0, removed = 0;
    for (const n of due) {
      const subs = await q.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
        "select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1 and organization_id = $2",
        [n.recipient_user_id, n.organization_id],
      );
      if (subs.length === 0) {
        await q.query("update notifications set push_status = 'unavailable' where id = $1", [n.id]);
        unavailable++;
        continue;
      }
      const payload = JSON.stringify({ title: n.title.slice(0, 120), body: n.body.slice(0, 400), url: safeLink(n.link) });
      let ok = false;
      for (const s of subs) {
        try {
          await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          ok = true;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await q.query("delete from push_subscriptions where id = $1", [s.id]);
            removed++;
          } else {
            console.error("[push] send failed:", code ?? (e as Error)?.name ?? "error");
          }
        }
      }
      await q.query("update notifications set push_status = $2 where id = $1", [n.id, ok ? "sent" : "failed"]);
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed, unavailable, removedSubscriptions: removed };
  });
}
