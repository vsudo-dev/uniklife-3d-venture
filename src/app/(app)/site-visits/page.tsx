import Link from "next/link";
import { CalendarDays, List, MapPin, Navigation, Phone, Plus, Radar, UserRound } from "lucide-react";
import { isPingStage } from "@/lib/geo";
import { inNetwork } from "@/lib/auth/context";
import { StageBadge } from "@/components/site-visits/tracking-ui";
import { requirePageContext } from "@/lib/auth/server";
import { listSiteVisits, type CheckIn } from "@/lib/services/site-visits";
import { listVentures } from "@/lib/services/ventures";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatusBadge, cx } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { VisitActions } from "@/components/site-visits/visit-actions";

export const metadata = { title: "Site visits" };

const STATUSES = ["", "requested", "scheduled", "completed", "cancelled", "no_show"];
const RANGES = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "All dates" },
];

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const timeLabel = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

export default async function SiteVisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageContext("staff");
  const ctx = await requirePageContext("site_visit.manage");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? (sp.status ?? "") : "";
  const range = RANGES.some((r) => r.key === sp.range) ? sp.range! : "upcoming";
  const view = sp.view === "list" ? "list" : "agenda";
  const mine = sp.mine === "1";
  const ventureId = sp.venture ?? "";
  const focus = sp.focus ?? null;
  const startOfToday = new Date(`${dayKey(new Date())}T00:00:00+05:30`);

  const [rows, ventures] = await Promise.all([
    listSiteVisits(ctx, {
      status: status || undefined, mine, ventureId: ventureId || undefined, q: sp.q?.slice(0, 60),
      from: range === "upcoming" ? startOfToday.toISOString() : undefined,
      to: range === "past" ? startOfToday.toISOString() : undefined,
    }),
    listVentures(ctx),
  ]);
  const visits = range === "past" ? [...rows].reverse() : rows;
  if (focus && !visits.some((v) => v.id === focus)) {
    // Deep link to a visit outside the current filter: show it on top.
    const all = await listSiteVisits(ctx, {});
    const f = all.find((v) => v.id === focus);
    if (f) visits.unshift(f);
  }

  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null> = { status: status || null, range: range === "upcoming" ? null : range, view: view === "list" ? "list" : null, mine: mine ? "1" : null, venture: ventureId || null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/site-visits${s ? `?${s}` : ""}`;
  };

  const todayCount = rows.filter((r) => dayKey(new Date(r.scheduled_at as string)) === dayKey(new Date()) && ["requested", "scheduled"].includes(String(r.status))).length;
  const requested = rows.filter((r) => r.status === "requested").length;
  const unassigned = rows.filter((r) => !r.employee_id && ["requested", "scheduled"].includes(String(r.status))).length;

  const groups = new Map<string, { label: string; items: typeof visits }>();
  for (const v of visits) {
    const d = new Date(v.scheduled_at as string);
    const k = dayKey(d);
    if (!groups.has(k)) groups.set(k, { label: dayLabel(d), items: [] });
    groups.get(k)!.items.push(v);
  }

  const VisitCard = ({ v }: { v: (typeof visits)[number] }) => {
    const d = new Date(v.scheduled_at as string);
    const ci = v.check_in as CheckIn | null;
    const focused = v.id === focus;
    return (
      <div className={cx("rounded-xl border border-border bg-surface p-4", focused && "ring-2 ring-gold")} id={`visit-${v.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-14 shrink-0 place-items-center rounded-lg bg-gold-soft text-center">
              <span className="text-sm font-extrabold text-gold-strong">{timeLabel(d)}</span>
            </div>
            <div className="min-w-0">
              <div className="font-semibold">{String(v.visitor_name)}</div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                <a href={`tel:${v.visitor_phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone size={11} />{String(v.visitor_phone)}</a>
                <span className="inline-flex items-center gap-1"><MapPin size={11} />{String(v.venture_name)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={String(v.status)} />
            {focused && <Badge tone="gold">from notification</Badge>}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1"><UserRound size={11} />{v.employee_code ? `${v.employee_code} · ${v.employee_name}` : <span className="font-semibold text-warning">Unassigned</span>}</span>
          {(v.plot_numbers as string[]).length > 0 && <span>Plots {(v.plot_numbers as string[]).join(", ")}</span>}
          {v.enquiry_id ? <Link href={`/enquiries?focus=${v.enquiry_id}`} className="text-primary hover:underline">Linked enquiry</Link> : null}
        </div>
        {v.notes ? <p className="mt-2 whitespace-pre-line text-xs text-muted">{String(v.notes)}</p> : null}
        {v.status === "completed" && (
          <div className="mt-2 rounded-lg bg-surface-2 p-2 text-xs">
            <div><strong>Outcome:</strong> {String(v.outcome_notes ?? "—")}</div>
            <div className="text-muted">
              Checked in {ci ? dateTime(ci.at) : dateTime(v.completed_at as string)}
              {ci?.lat != null && ci?.lng != null ? (
                <> · <a className="text-primary hover:underline" href={`https://www.openstreetmap.org/?mlat=${ci.lat}&mlon=${ci.lng}#map=17/${ci.lat}/${ci.lng}`} target="_blank" rel="noopener noreferrer">{ci.lat.toFixed(5)}, {ci.lng.toFixed(5)}</a>{ci.accuracy != null ? ` (±${ci.accuracy} m)` : ""}</>
              ) : " · no location shared"}
            </div>
          </div>
        )}
        {(() => {
          const stage = String(v.tracking_stage ?? "not_started");
          const isAssignee = !!ctx.employee && v.employee_id === ctx.employee.id;
          const tripActive = isPingStage(stage);
          if (isAssignee && (v.status === "scheduled" || stage !== "not_started")) {
            return (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <LinkButton href={`/site-visits/${v.id}/track`} variant={tripActive || stage === "not_started" ? "gold" : "outline"} className="px-3 py-1.5 text-xs">
                  <Navigation size={13} />{stage === "not_started" ? "Track trip" : tripActive ? "Continue trip" : "View trip"}
                </LinkButton>
                {stage !== "not_started" && <StageBadge stage={stage} />}
              </div>
            );
          }
          if (!isAssignee && inNetwork(ctx, v.employee_id as string | null) && stage !== "not_started") {
            return (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={`/site-visits/${v.id}/track`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Navigation size={12} />Trip timeline</Link>
                <StageBadge stage={stage} />
              </div>
            );
          }
          return null;
        })()}
        <VisitActions id={String(v.id)} status={String(v.status)} scheduledAt={new Date(v.scheduled_at as string).toISOString()} hasEmployee={!!v.employee_id} />
      </div>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Site visits"
        subtitle={ctx.networkEmployeeIds === null ? "All site visits in your organization." : "Visits assigned to you and your team" + (ctx.role === "sales_manager" ? ", plus unassigned customer requests." : ".")}
        actions={
          <>
            <LinkButton href="/site-visits/tracking" variant="outline"><Radar size={16} />Team tracking</LinkButton>
            <LinkButton href="/site-visits/new" variant="gold"><Plus size={16} />Schedule visit</LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Today" value={todayCount} hint="Open visits today" accent="gold" />
        <Stat label="Requests" value={requested} hint="Awaiting confirmation" />
        <Stat label="Unassigned" value={unassigned} hint="Need an employee" />
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav className="-mx-1 flex gap-1 overflow-x-auto" aria-label="Date range">
              {RANGES.map((r) => (
                <Link key={r.key} href={href({ range: r.key === "upcoming" ? null : r.key })} aria-current={range === r.key ? "page" : undefined}
                  className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold", range === r.key ? "bg-primary text-primary-contrast" : "text-muted hover:bg-surface-2")}>{r.label}</Link>
              ))}
            </nav>
            <div className="flex gap-1" role="group" aria-label="View">
              <Link href={href({ view: null })} className={cx("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold", view === "agenda" ? "bg-gold-soft text-gold-strong" : "text-muted")} aria-pressed={view === "agenda"}><CalendarDays size={14} />Agenda</Link>
              <Link href={href({ view: "list" })} className={cx("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold", view === "list" ? "bg-gold-soft text-gold-strong" : "text-muted")} aria-pressed={view === "list"}><List size={14} />List</Link>
            </div>
          </div>
          <form action="/site-visits" className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
            {range !== "upcoming" && <input type="hidden" name="range" value={range} />}
            {view === "list" && <input type="hidden" name="view" value="list" />}
            <select name="status" defaultValue={status} className="input py-1.5" aria-label="Status">
              {STATUSES.map((s) => <option key={s || "all"} value={s}>{s ? s.replace("_", " ") : "All statuses"}</option>)}
            </select>
            <select name="venture" defaultValue={ventureId} className="input py-1.5" aria-label="Venture">
              <option value="">All ventures</option>
              {ventures.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input name="q" defaultValue={sp.q ?? ""} className="input py-1.5" placeholder="Visitor name or phone" aria-label="Search" />
            {ctx.employee ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={mine} />Mine</label>
            ) : <span />}
            <button type="submit" className="rounded-xl border border-border px-4 py-1.5 text-sm font-semibold hover:border-gold">Apply</button>
          </form>
        </div>

        {visits.length === 0 ? (
          <EmptyState title="No site visits" action={<LinkButton href="/site-visits/new" variant="outline">Schedule a visit</LinkButton>}>
            {range === "upcoming" ? "Nothing scheduled from today onwards." : "No visits match these filters."}
          </EmptyState>
        ) : view === "agenda" ? (
          <div className="space-y-6 p-4">
            {[...groups.entries()].map(([k, g]) => (
              <section key={k} aria-labelledby={`day-${k}`}>
                <h2 id={`day-${k}`} className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <span className="h-2 w-2 rounded-full bg-gold" aria-hidden />{g.label}
                  {k === dayKey(new Date()) && <Badge tone="gold">Today</Badge>}
                  <span className="text-xs font-normal text-muted">{g.items.length} visit(s)</span>
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {g.items.map((v) => <VisitCard key={String(v.id)} v={v} />)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {visits.map((v) => (
              <div key={String(v.id)}>
                <div className="mb-1 text-xs font-semibold text-muted">{dateTime(v.scheduled_at as string)}</div>
                <VisitCard v={v} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
