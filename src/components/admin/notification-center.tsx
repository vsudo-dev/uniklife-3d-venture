"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCheck, ListTodo } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, EmptyState, cx, type Tone } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";
import { MessageLine, useAction } from "./use-action";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  booking_id: string | null;
  booking_number: string | null;
  plot_numbers: string[];
  link: string | null;
  follow_up_action: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_TONE: Record<string, Tone> = {
  downline_booking: "gold",
  downline_reservation: "warning",
  reservation_reminder: "warning",
  followup_reminder: "info",
  site_visit_update: "info",
  commission_update: "success",
  booking_update: "neutral",
  system: "neutral",
};

/** Only same-origin relative links are followed (the DB also enforces this). */
function safeLink(link: string | null): string | null {
  return link && /^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(link) ? link : null;
}

export function NotificationCenter({ items, typeLabels }: { items: NotificationItem[]; typeLabels: Record<string, string> }) {
  const [tab, setTab] = useState<string>("all");
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const { busy, msg, run } = useAction();

  const isRead = (n: NotificationItem) => !!n.read_at || readIds.has(n.id);
  const unread = items.filter((n) => !isRead(n)).length;
  const presentTypes = useMemo(() => [...new Set(items.map((n) => n.type))], [items]);
  const visible = items.filter((n) => (tab === "all" ? true : tab === "unread" ? !isRead(n) : n.type === tab));

  async function mark(ids: string[] | "all") {
    await run(
      "mark",
      async () => {
        await api("/api/notifications/read", { body: ids === "all" ? { all: true } : { ids } });
        setReadIds((s) => new Set([...s, ...(ids === "all" ? items.map((n) => n.id) : ids)]));
      },
      ids === "all" ? "All notifications marked as read" : undefined,
    );
  }

  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "all", label: "All", count: items.length },
    { id: "unread", label: "Unread", count: unread },
    ...presentTypes.map((t) => ({ id: t, label: typeLabels[t] ?? t, count: items.filter((n) => n.type === t).length })),
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div role="tablist" aria-label="Filter notifications" className="-mx-1 flex gap-1 overflow-x-auto pb-1 sm:pb-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition",
                tab === t.id ? "border-gold bg-gold-soft text-gold-strong" : "border-border text-muted hover:border-gold",
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1 tabular-nums opacity-70">{t.count}</span>}
            </button>
          ))}
        </div>
        <Button variant="outline" className="shrink-0" disabled={!!busy || unread === 0} onClick={() => mark("all")}>
          <CheckCheck size={16} aria-hidden /> Mark all read
        </Button>
      </div>
      {msg && <div className="px-5 pt-3"><MessageLine msg={msg} /></div>}
      {visible.length === 0 ? (
        <EmptyState title={tab === "unread" ? "No unread notifications" : "Nothing here yet"}>
          Team bookings, reservations, follow-up reminders and site-visit updates appear here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((n) => {
            const read = isRead(n);
            const link = safeLink(n.link);
            return (
              <li key={n.id} className={cx("px-4 py-4 sm:px-5", !read && "bg-[color-mix(in_srgb,var(--gold)_6%,transparent)]")}>
                <div className="flex items-start gap-3">
                  <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", read ? "bg-border" : "bg-gold shadow-[0_0_0_3px_var(--gold-soft)]")} aria-label={read ? "Read" : "Unread"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TYPE_TONE[n.type] ?? "neutral"}>{typeLabels[n.type] ?? n.type}</Badge>
                      {n.booking_number && <Badge tone="info">{n.booking_number}</Badge>}
                      <time className="text-xs text-muted" dateTime={n.created_at} title={dateTime(n.created_at)}>{relative(n.created_at)}</time>
                    </div>
                    <h3 className={cx("mt-1.5 text-sm", read ? "font-semibold" : "font-bold")}>{n.title}</h3>
                    <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                    {n.plot_numbers.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1" aria-label="Plots">
                        {n.plot_numbers.map((p) => (
                          <span key={p} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[0.7rem] font-semibold tabular-nums">Plot {p}</span>
                        ))}
                      </div>
                    )}
                    {n.follow_up_action && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gold-strong">
                        <ListTodo size={14} aria-hidden /> {n.follow_up_action}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {link && (
                        <Link
                          href={link}
                          onClick={() => { if (!read) void api("/api/notifications/read", { body: { ids: [n.id] } }).catch(() => undefined); }}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-contrast hover:bg-primary-strong"
                        >
                          Open <ArrowRight size={14} aria-hidden />
                        </Link>
                      )}
                      {!read && (
                        <button
                          onClick={() => mark([n.id])}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-gold disabled:opacity-50"
                        >
                          <Check size={14} aria-hidden /> Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
