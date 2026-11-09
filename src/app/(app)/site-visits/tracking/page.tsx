import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { getMapRuntime } from "@/lib/services/maps";
import { RETENTION_NOTE, getVisitTracking, listTeamTracking } from "@/lib/services/site-visits";
import { Card, EmptyState, LinkButton, PageHeader, Stat, cx } from "@/components/ui";
import { formatDistance, formatDuration } from "@/lib/geo";
import { relative } from "@/lib/format";
import { StageBadge, TrackingPrivacyNotice } from "@/components/site-visits/tracking-ui";
import { TrackingDetail } from "@/components/site-visits/tracking-detail";

export const metadata = { title: "Team tracking" };

const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—");
const shiftDay = (day: string, by: number) => new Date(new Date(`${day}T12:00:00+05:30`).getTime() + by * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const longDay = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default async function TeamTrackingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageContext("staff");
  const ctx = await requirePageContext("site_visit.manage");
  const sp = await searchParams;
  const [data, map] = await Promise.all([listTeamTracking(ctx, sp.date ?? null), getMapRuntime(ctx)]);
  const selected = sp.visit && data.items.some((i) => i.id === sp.visit) ? await getVisitTracking(ctx, sp.visit).catch(() => null) : null;
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null> = { date: data.date, visit: null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/site-visits/tracking?${p.toString()}`;
  };
  const scope = ctx.networkEmployeeIds === null ? "everyone in your organization" : ctx.networkEmployeeIds.length > 1 ? "you and your team (your reporting network)" : "your own trips";

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Team tracking"
        subtitle={`Site-visit trips stage by stage — start, arrival, visit, return — for ${scope}.`}
        actions={<LinkButton href="/site-visits" variant="outline"><ArrowLeft size={16} />Site visits</LinkButton>}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ date: shiftDay(data.date, -1) })} className="rounded-lg border border-border p-2 hover:border-gold" aria-label="Previous day"><ChevronLeft size={16} /></Link>
          <form action="/site-visits/tracking" className="flex flex-wrap items-center gap-2">
            <label htmlFor="track-date" className="sr-only">Date</label>
            <input id="track-date" type="date" name="date" defaultValue={data.date} className="input py-1.5" />
            <button type="submit" className="rounded-xl border border-border px-4 py-1.5 text-sm font-semibold hover:border-gold">Show</button>
          </form>
          <Link href={href({ date: shiftDay(data.date, 1) })} className="rounded-lg border border-border p-2 hover:border-gold" aria-label="Next day"><ChevronRight size={16} /></Link>
          <span className="text-sm font-semibold">{longDay(data.date)}</span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Employees" value={data.counts.employees} hint="with visits this day" />
        <Stat label="Visits" value={data.counts.visits} />
        <Stat label="On the move / on site" value={data.counts.active} hint={`${data.counts.onSite} on site now`} accent="gold" />
        <Stat label="Returned" value={data.counts.returned} />
      </div>

      {selected && (
        <Card className="mt-4 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">Trip details</h2>
            <div className="flex gap-2">
              <Link href={`/site-visits/${selected.visit.id}/track`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Open trip page<ExternalLink size={12} /></Link>
              <Link href={href({})} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text" aria-label="Close details"><X size={14} />Close</Link>
            </div>
          </div>
          <TrackingDetail data={selected} showPrivacy={false} map={map} />
        </Card>
      )}

      <Card className="mt-4">
        {data.items.length === 0 ? (
          <EmptyState title="No site visits on this day">Visits scheduled or trips started on {longDay(data.date)} will appear here.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full min-w-[56rem] text-sm">
              <thead>
                <tr>
                  <th>Employee</th><th>Visit</th><th>Stage</th><th>Started</th><th>Arrived</th><th>Completed</th><th>Returned</th>
                  <th>On site</th><th>Distance</th><th>Last update</th><th><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className={cx(sp.visit === r.id && "bg-gold-soft")}>
                    <td><div className="font-semibold">{r.employeeName}</div><div className="text-xs text-muted">{r.employeeCode}</div></td>
                    <td><div>{r.visitorName}</div><div className="text-xs text-muted">{r.ventureName} · {t(r.scheduledAt)}</div></td>
                    <td><StageBadge stage={r.stage} /></td>
                    <td>{t(r.tripStartedAt)}</td>
                    <td>{t(r.arrivedAt)}{r.travelToSiteS != null && r.arrivedAt && <div className="text-xs text-muted">{formatDuration(r.travelToSiteS)} travel</div>}</td>
                    <td>{t(r.visitCompletedAt)}</td>
                    <td>{t(r.returnedAt)}</td>
                    <td>{formatDuration(r.timeOnSiteS)}</td>
                    <td>{r.tripStartedAt ? formatDistance(r.totalDistanceM) : "—"}</td>
                    <td className="text-xs">{r.lastUpdateAt ? relative(r.lastUpdateAt) : "—"}{r.lastLocationAt && <div className="text-muted">GPS {t(r.lastLocationAt)}</div>}</td>
                    <td>
                      {r.stage !== "not_started"
                        ? <Link href={href({ visit: r.id })} className="font-semibold text-primary hover:underline">Timeline</Link>
                        : <span className="text-xs text-muted">Not started</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4"><TrackingPrivacyNotice retentionNote={RETENTION_NOTE} /></div>
    </>
  );
}
