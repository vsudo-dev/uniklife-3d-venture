import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { db, withTx } from "./common";
import { getUplineChain } from "./employees";

export type NotificationType =
  | "downline_booking"
  | "downline_reservation"
  | "reservation_reminder"
  | "followup_reminder"
  | "site_visit_update"
  | "commission_update"
  | "booking_update"
  | "system";

export interface Preferences {
  in_app: boolean;
  dashboard_alerts: boolean;
  whatsapp_via_uniklife: boolean;
  email_via_uniklife: boolean;
  push: boolean;
}

const DEFAULT_PREFS: Preferences = { in_app: true, dashboard_alerts: true, whatsapp_via_uniklife: false, email_via_uniklife: false, push: false };

export async function loadPreferences(q: Queryable, orgId: string, userId: string): Promise<Preferences> {
  const [p] = await q.query<Preferences>(
    "select in_app, dashboard_alerts, whatsapp_via_uniklife, email_via_uniklife, push from notification_preferences where organization_id = $1 and user_id = $2",
    [orgId, userId],
  );
  return p ?? DEFAULT_PREFS;
}

/** "Plot 17" / "Plots 17 and 18" / "Plots 17, 18, 19 and 20" */
export function formatPlotList(plotNumbers: string[]): string {
  if (plotNumbers.length === 1) return `Plot ${plotNumbers[0]}`;
  const head = plotNumbers.slice(0, -1).join(", ");
  return `Plots ${head} and ${plotNumbers[plotNumbers.length - 1]}`;
}

export async function createNotification(
  q: Queryable,
  n: {
    organizationId: string;
    recipientUserId: string;
    type: NotificationType;
    title: string;
    body: string;
    bookingId?: string | null;
    bookingNumber?: string | null;
    plotNumbers?: string[];
    link?: string | null;
    followUpAction?: string | null;
    dedupeKey?: string | null;
  },
): Promise<string | null> {
  const prefs = await loadPreferences(q, n.organizationId, n.recipientUserId);
  if (!prefs.in_app && !prefs.push && !prefs.dashboard_alerts && !prefs.email_via_uniklife && !prefs.whatsapp_via_uniklife) return null;
  const [row] = await q.query<{ id: string }>(
    `insert into notifications (organization_id, recipient_user_id, type, title, body, booking_id, booking_number, plot_numbers,
                                link, follow_up_action, dedupe_key, push_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12)
     on conflict (dedupe_key) do nothing returning id`,
    [
      n.organizationId, n.recipientUserId, n.type, n.title, n.body, n.bookingId ?? null, n.bookingNumber ?? null,
      n.plotNumbers ?? [], n.link ?? null, n.followUpAction ?? null, n.dedupeKey ?? null, prefs.push ? "pending" : "not_requested",
    ],
  );
  if (row) {
    for (const channel of [...(prefs.email_via_uniklife ? ["smtp"] : []), ...(prefs.whatsapp_via_uniklife ? ["whatsapp"] : [])]) {
      await q.query("insert into message_deliveries(organization_id,notification_id,channel) values($1,$2,$3) on conflict(notification_id,channel) do nothing",[n.organizationId,row.id,channel]);
    }
  }
  return row?.id ?? null;
}

/**
 * Downline booking/reservation → notify authorized uplines (reporting chain above the
 * credited employee), emit a CRM event and schedule follow-up reminders.
 * Notification content is limited to what every upline may see (seller name, plots,
 * venture, booking reference) — never commissions or other uplines' details.
 */
export async function notifyUplines(
  q: Queryable,
  args: {
    organizationId: string;
    kind: "reservation" | "booking";
    creditedEmployeeId: string;
    actorUserId: string | null;
    ventureName: string;
    plotNumbers: string[];
    bookingId?: string | null;
    bookingNumber?: string | null;
    holdGroupId?: string | null;
    refKey: string; // stable key for dedupe (e.g. booking id / hold group id)
  },
): Promise<{ notified: string[] }> {
  const chain = await getUplineChain(q, args.organizationId, args.creditedEmployeeId);
  if (chain.length === 0) return { notified: [] };
  const seller = chain[0];
  const uplines = chain.slice(1).filter((m) => m.userId && m.active);

  // Only notify uplines who are still active staff members of this organization.
  const activeUserIds = new Set(
    (
      await q.query<{ user_id: string }>(
        `select m.user_id from organization_members m join app_users u on u.id = m.user_id
          where m.organization_id = $1 and m.status = 'active' and u.status = 'active' and m.role <> 'customer'
            and m.user_id = any($2::uuid[])`,
        [args.organizationId, uplines.map((u) => u.userId)],
      )
    ).map((r) => r.user_id),
  );

  const plots = formatPlotList(args.plotNumbers);
  const verb = args.kind === "booking" ? "created a booking for" : "reserved";
  const notified: string[] = [];
  const recipients: { employee_code: string; channels: string[] }[] = [];
  for (const u of uplines) {
    if (!u.userId || !activeUserIds.has(u.userId) || u.userId === args.actorUserId) continue;
    const prefs = await loadPreferences(q, args.organizationId, u.userId);
    const body =
      `Your team member ${seller.fullName} has ${verb} ${plots} in ${args.ventureName}. ` +
      `Please coordinate with the sales team to complete the booking and follow-up.`;
    const id = await createNotification(q, {
      organizationId: args.organizationId,
      recipientUserId: u.userId,
      type: args.kind === "booking" ? "downline_booking" : "downline_reservation",
      title: args.kind === "booking" ? `New team booking ${args.bookingNumber ?? ""}`.trim() : "New team reservation",
      body,
      bookingId: args.bookingId ?? null,
      bookingNumber: args.bookingNumber ?? null,
      plotNumbers: args.plotNumbers,
      link: args.bookingId ? `/bookings/${args.bookingId}` : "/bookings?view=holds",
      followUpAction: "Coordinate with the sales team and follow up with the customer",
      dedupeKey: `${args.kind}:${args.refKey}:${u.userId}`,
    });
    if (id) notified.push(u.userId);
    const channels = ["in_app"];
    if (prefs.whatsapp_via_uniklife) channels.push("whatsapp");
    if (prefs.email_via_uniklife) channels.push("email");
    recipients.push({ employee_code: u.employeeCode, channels });
  }

  if (recipients.length > 0) {
    await enqueueOutboundEvent(q, {
      organizationId: args.organizationId,
      eventType: "upline.booking.notification_requested",
      aggregateType: args.kind === "booking" ? "booking" : "hold_group",
      aggregateId: args.bookingId ?? args.holdGroupId ?? null,
      idempotencyKey: `upline.notify:${args.kind}:${args.refKey}`,
      data: {
        kind: args.kind,
        booking_id: args.bookingId ?? null,
        booking_number: args.bookingNumber ?? null,
        venture_name: args.ventureName,
        plot_numbers: args.plotNumbers,
        credited_employee_code: seller.employeeCode,
        credited_employee_name: seller.fullName,
        // WhatsApp/email delivery happens only if UNIKLIFE.AI supports it (unverified).
        recipients,
      },
    });
  }

  // Follow-up reminders (bookings only): the seller and the direct manager.
  if (args.kind === "booking" && args.bookingId) {
    const [org] = await q.query<{ followup_reminder_hours: number[] }>("select followup_reminder_hours from organizations where id = $1", [args.organizationId]);
    // Seller always (if they have an account); direct manager only if an active staff member.
    const targets = [seller, chain[1]].filter(
      (m): m is (typeof chain)[number] => !!m?.userId && (m === seller || activeUserIds.has(m.userId)),
    );
    for (const hours of org?.followup_reminder_hours ?? []) {
      for (const t of targets) {
        if (!t?.userId) continue;
        await q.query(
          `insert into follow_up_reminders (organization_id, kind, booking_id, recipient_user_id, due_at)
           values ($1, 'booking_followup', $2, $3, now() + make_interval(hours => $4))`,
          [args.organizationId, args.bookingId, t.userId, hours],
        );
      }
    }
  }
  return { notified };
}

/** Processes due reminders (called by the scheduler). */
export async function processDueReminders(limit = 100): Promise<{ sent: number; cancelled: number }> {
  return withTx(async (q) => {
    const due = await q.query<{
      id: string; organization_id: string; kind: string; booking_id: string | null; site_visit_id: string | null; recipient_user_id: string;
    }>(
      `select id, organization_id, kind, booking_id, site_visit_id, recipient_user_id from follow_up_reminders
        where status = 'pending' and due_at <= now() order by due_at limit $1 for update skip locked`,
      [limit],
    );
    let sent = 0;
    let cancelled = 0;
    for (const r of due) {
      if (r.kind === "booking_followup" && r.booking_id) {
        const [b] = await q.query<{ status: string; booking_number: string; plots: string[]; venture: string }>(
          `select b.status, b.booking_number, v.name as venture,
                  array(select bp.plot_number from booking_plots bp where bp.booking_id = b.id order by bp.plot_number) as plots
             from bookings b join ventures v on v.id = b.venture_id where b.id = $1`,
          [r.booking_id],
        );
        if (!b || b.status !== "payment_pending") {
          await q.query("update follow_up_reminders set status = 'cancelled' where id = $1", [r.id]);
          cancelled++;
          continue;
        }
        await createNotification(q, {
          organizationId: r.organization_id, recipientUserId: r.recipient_user_id, type: "followup_reminder",
          title: `Follow up: ${b.booking_number}`,
          body: `Booking ${b.booking_number} (${formatPlotList(b.plots)}, ${b.venture}) is still awaiting the advance payment. Please follow up with the customer.`,
          bookingId: r.booking_id, bookingNumber: b.booking_number, plotNumbers: b.plots, link: `/bookings/${r.booking_id}`,
          followUpAction: "Contact the customer about the pending advance", dedupeKey: `reminder:${r.id}`,
        });
        await enqueueOutboundEvent(q, {
          organizationId: r.organization_id, eventType: "upline.followup.reminder_due", aggregateType: "booking", aggregateId: r.booking_id,
          idempotencyKey: `reminder:${r.id}`, data: { booking_id: r.booking_id, booking_number: b.booking_number, plot_numbers: b.plots, reminder_id: r.id },
        });
      } else if (r.kind === "site_visit" && r.site_visit_id) {
        const [sv] = await q.query<{ status: string; visitor_name: string; scheduled_at: Date; venture: string }>(
          "select s.status, s.visitor_name, s.scheduled_at, v.name as venture from site_visits s join ventures v on v.id = s.venture_id where s.id = $1",
          [r.site_visit_id],
        );
        if (!sv || !["requested", "scheduled"].includes(sv.status)) {
          await q.query("update follow_up_reminders set status = 'cancelled' where id = $1", [r.id]);
          cancelled++;
          continue;
        }
        await createNotification(q, {
          organizationId: r.organization_id, recipientUserId: r.recipient_user_id, type: "site_visit_update",
          title: "Upcoming site visit",
          body: `Site visit with ${sv.visitor_name} at ${sv.venture} is scheduled for ${new Date(sv.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
          link: `/site-visits?focus=${r.site_visit_id}`, followUpAction: "Confirm the visit with the customer", dedupeKey: `reminder:${r.id}`,
        });
        await enqueueOutboundEvent(q, {
          organizationId: r.organization_id, eventType: "site_visit.reminder_due", aggregateType: "site_visit", aggregateId: r.site_visit_id,
          idempotencyKey: `reminder:${r.id}`, data: { site_visit_id: r.site_visit_id, scheduled_at: sv.scheduled_at },
        });
      }
      await q.query("update follow_up_reminders set status = 'sent', sent_at = now() where id = $1", [r.id]);
      sent++;
    }
    return { sent, cancelled };
  });
}

/** Cancels pending booking reminders (booking confirmed/cancelled/expired). */
export async function cancelBookingReminders(q: Queryable, bookingId: string) {
  await q.query("update follow_up_reminders set status = 'cancelled' where booking_id = $1 and status = 'pending'", [bookingId]);
}

// ---------------------------------------------------------------------------
// Notification center (always scoped to the current user + organization)
// ---------------------------------------------------------------------------
export async function listNotifications(ctx: AuthContext, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const q = await db();
  return q.query<{
    id: string; type: NotificationType; title: string; body: string; booking_id: string | null; booking_number: string | null;
    plot_numbers: string[]; link: string | null; follow_up_action: string | null; read_at: Date | null; created_at: Date;
  }>(
    `select id, type, title, body, booking_id, booking_number, plot_numbers, link, follow_up_action, read_at, created_at
       from notifications where recipient_user_id = $1 and organization_id = $2 ${opts.unreadOnly ? "and read_at is null" : ""}
      order by created_at desc limit $3`,
    [ctx.user.id, ctx.organizationId, Math.min(opts.limit ?? 50, 200)],
  );
}

export async function unreadCount(ctx: AuthContext): Promise<number> {
  const q = await db();
  const [r] = await q.query<{ n: number }>(
    "select count(*)::int as n from notifications where recipient_user_id = $1 and organization_id = $2 and read_at is null",
    [ctx.user.id, ctx.organizationId],
  );
  return r?.n ?? 0;
}

export async function markRead(ctx: AuthContext, ids: string[] | "all") {
  const q = await db();
  if (ids === "all") {
    await q.query("update notifications set read_at = now() where recipient_user_id = $1 and organization_id = $2 and read_at is null", [ctx.user.id, ctx.organizationId]);
  } else {
    await q.query(
      "update notifications set read_at = now() where recipient_user_id = $1 and organization_id = $2 and id = any($3::uuid[]) and read_at is null",
      [ctx.user.id, ctx.organizationId, ids],
    );
  }
}

export const NOTIFICATION_TYPES: NotificationType[] = [
  "downline_booking", "downline_reservation", "reservation_reminder", "followup_reminder",
  "site_visit_update", "commission_update", "booking_update", "system",
];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  downline_booking: "Team booking",
  downline_reservation: "Team reservation",
  reservation_reminder: "Reservation reminder",
  followup_reminder: "Follow-up",
  site_visit_update: "Site visit",
  commission_update: "Commission",
  booking_update: "Booking",
  system: "System",
};

/** Notification center listing with type filter (current user + organization only). */
export async function listMyNotifications(ctx: AuthContext, opts: { unreadOnly?: boolean; type?: string; limit?: number } = {}) {
  const q = await db();
  const params: unknown[] = [ctx.user.id, ctx.organizationId];
  const where = ["recipient_user_id = $1", "organization_id = $2"];
  if (opts.unreadOnly) where.push("read_at is null");
  if (opts.type && (NOTIFICATION_TYPES as string[]).includes(opts.type)) {
    params.push(opts.type);
    where.push(`type = $${params.length}`);
  }
  params.push(Math.min(Math.max(opts.limit ?? 100, 1), 200));
  return q.query<{
    id: string; type: NotificationType; title: string; body: string; booking_id: string | null; booking_number: string | null;
    plot_numbers: string[]; link: string | null; follow_up_action: string | null; read_at: Date | null; created_at: Date;
  }>(
    `select id, type, title, body, booking_id, booking_number, plot_numbers, link, follow_up_action, read_at, created_at
       from notifications where ${where.join(" and ")} order by created_at desc limit $${params.length}`,
    params,
  );
}

/** Unread total and per-type counts for the current user. */
export async function notificationCounts(ctx: AuthContext): Promise<{ unread: number; total: number; byType: Record<string, { total: number; unread: number }> }> {
  const q = await db();
  const rows = await q.query<{ type: string; total: number; unread: number }>(
    `select type, count(*)::int as total, count(*) filter (where read_at is null)::int as unread
       from notifications where recipient_user_id = $1 and organization_id = $2 group by type`,
    [ctx.user.id, ctx.organizationId],
  );
  const byType: Record<string, { total: number; unread: number }> = {};
  let unread = 0;
  let total = 0;
  for (const r of rows) {
    byType[r.type] = { total: r.total, unread: r.unread };
    unread += r.unread;
    total += r.total;
  }
  return { unread, total, byType };
}

export const preferencesSchema = z.object({
  in_app: z.boolean(),
  dashboard_alerts: z.boolean(),
  whatsapp_via_uniklife: z.boolean(),
  email_via_uniklife: z.boolean(),
  push: z.boolean(),
});

export async function getMyPreferences(ctx: AuthContext) {
  return loadPreferences(await db(), ctx.organizationId, ctx.user.id);
}

export async function updateMyPreferences(ctx: AuthContext, p: Preferences) {
  return withTx(async (q) => {
    await q.query(
      `insert into notification_preferences (organization_id, user_id, in_app, dashboard_alerts, whatsapp_via_uniklife, email_via_uniklife, push, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (organization_id, user_id) do update set in_app = excluded.in_app, dashboard_alerts = excluded.dashboard_alerts,
         whatsapp_via_uniklife = excluded.whatsapp_via_uniklife, email_via_uniklife = excluded.email_via_uniklife, push = excluded.push, updated_at = now()`,
      [ctx.organizationId, ctx.user.id, p.in_app, p.dashboard_alerts, p.whatsapp_via_uniklife, p.email_via_uniklife, p.push],
    );
    await writeAudit(q, ctx, { action: "notification_preferences.updated", entityType: "user", entityId: ctx.user.id, after: p });
    return p;
  });
}
