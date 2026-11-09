import { Bell, BellRing } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { getMyPreferences, listMyNotifications, notificationCounts, NOTIFICATION_TYPE_LABELS } from "@/lib/services/notifications";
import { PageHeader, Stat } from "@/components/ui";
import { NotificationCenter, type NotificationItem } from "@/components/admin/notification-center";
import { NotificationPreferences } from "@/components/admin/notification-preferences";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const ctx = await requirePageContext();
  const [items, counts, prefs] = await Promise.all([listMyNotifications(ctx, { limit: 200 }), notificationCounts(ctx), getMyPreferences(ctx)]);
  const serial: NotificationItem[] = items.map((n) => ({
    ...n,
    plot_numbers: n.plot_numbers ?? [],
    read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
    created_at: new Date(n.created_at).toISOString(),
  }));
  const followUps = (counts.byType.followup_reminder?.unread ?? 0) + (counts.byType.reservation_reminder?.unread ?? 0);
  const team = (counts.byType.downline_booking?.unread ?? 0) + (counts.byType.downline_reservation?.unread ?? 0);

  return (
    <>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><BellRing size={14} aria-hidden /> Notification center</span>}
        title="Notifications"
        subtitle="Team bookings and reservations, follow-up reminders and updates — only those addressed to you."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Unread" value={counts.unread} accent="gold" hint={<span className="inline-flex items-center gap-1"><Bell size={12} aria-hidden /> needs attention</span>} />
        <Stat label="Team activity" value={team} hint="unread bookings & reservations" />
        <Stat label="Follow-ups" value={followUps} hint="unread reminders" />
        <Stat label="Total" value={counts.total} hint="last 200 shown" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NotificationCenter items={serial} typeLabels={NOTIFICATION_TYPE_LABELS} />
        </div>
        <div id="preferences" className="scroll-mt-24">
          <NotificationPreferences initial={prefs} />
        </div>
      </div>
    </>
  );
}
