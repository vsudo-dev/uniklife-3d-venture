import Link from "next/link";
import { CalendarPlus, Mail, MapPin, Phone } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { enquiryStatusCounts, listEnquiries } from "@/lib/services/enquiries";
import { listVentures } from "@/lib/services/ventures";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, cx } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";
import { EnquiryControls } from "./enquiry-controls";
import { NewEnquiry } from "./new-enquiry";

export const metadata = { title: "Enquiries" };

const TABS = ["", "new", "contacted", "qualified", "converted", "closed"];
const SOURCE: Record<string, string> = { web: "Website", "3d_viewer": "3D viewer", portal: "Customer portal", staff: "Staff", crm: "CRM" };

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("enquiry.view");
  const sp = await searchParams;
  const status = TABS.includes(sp.status ?? "") ? (sp.status ?? "") : "";
  const mine = sp.mine === "1";
  const q = sp.q?.slice(0, 60) ?? "";
  const focus = sp.focus ?? null;
  const canManage = can(ctx, "enquiry.manage");
  const [rows, counts, ventures] = await Promise.all([
    listEnquiries(ctx, { status: status || undefined, mine, q: q || undefined }),
    enquiryStatusCounts(ctx, { mine }),
    canManage ? listVentures(ctx) : Promise.resolve([]),
  ]);
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { status: status || null, mine: mine ? "1" : null, q: q || null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/enquiries${s ? `?${s}` : ""}`;
  };
  // Focused enquiry first so the deep link from a notification is visible immediately.
  const ordered = focus ? [...rows.filter((r) => r.id === focus), ...rows.filter((r) => r.id !== focus)] : rows;

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Enquiries"
        subtitle={ctx.networkEmployeeIds === null ? "All enquiries in your organization." : ctx.role === "sales_manager" ? "Enquiries assigned to you and your team, plus unassigned leads." : "Enquiries assigned to you and your team."}
        actions={canManage ? <NewEnquiry ventures={ventures.map((v) => ({ id: v.id, name: v.name }))} /> : undefined}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:pb-0" aria-label="Filter by status">
            {TABS.map((t) => (
              <Link key={t || "all"} href={href({ status: t || null, focus: null })} aria-current={status === t ? "page" : undefined}
                className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold capitalize", status === t ? "bg-primary text-primary-contrast" : "text-muted hover:bg-surface-2")}>
                {t || "All"} <span className="ml-1 text-xs opacity-70">{counts[t || "all"] ?? 0}</span>
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            {ctx.employee && (
              <Link href={href({ mine: mine ? null : "1" })} className={cx("rounded-lg border px-3 py-1.5 text-sm font-semibold", mine ? "border-gold bg-gold-soft text-gold-strong" : "border-border text-muted")} aria-pressed={mine}>
                Assigned to me
              </Link>
            )}
            <form action="/enquiries" className="flex gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              {mine && <input type="hidden" name="mine" value="1" />}
              <input name="q" defaultValue={q} className="input py-1.5 sm:w-56" placeholder="Search name or phone" aria-label="Search enquiries" />
            </form>
          </div>
        </div>

        {ordered.length === 0 ? (
          <EmptyState title="No enquiries">{q || status || mine ? "Try clearing the filters." : "Enquiries from the website, 3D viewer and customer portal appear here."}</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {ordered.map((e) => {
              const focused = e.id === focus;
              return (
                <li key={String(e.id)} id={`enq-${e.id}`} className={cx("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between", focused && "bg-gold-soft ring-2 ring-inset ring-gold")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{String(e.name)}</span>
                      <StatusBadge status={String(e.status)} />
                      <Badge tone="neutral">{SOURCE[String(e.source)] ?? String(e.source)}</Badge>
                      {focused && <Badge tone="gold">from notification</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone size={12} />{String(e.phone)}</a>
                      {e.email ? <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1 hover:text-primary"><Mail size={12} />{String(e.email)}</a> : null}
                      <span className="inline-flex items-center gap-1"><MapPin size={12} />{String(e.venture_name)}{e.plot_number ? ` · Plot ${e.plot_number}` : ""}</span>
                      <span title={dateTime(e.created_at as string)}>{relative(e.created_at as Date)}</span>
                    </div>
                    {e.message ? <p className="mt-2 line-clamp-3 text-sm">{String(e.message)}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {can(ctx, "site_visit.manage") && (
                        <Link className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                          href={`/site-visits/new?venture=${e.venture_id}${e.plot_id ? `&plots=${e.plot_id}` : ""}&enquiry=${e.id}&name=${encodeURIComponent(String(e.name))}&phone=${encodeURIComponent(String(e.phone))}`}>
                          <CalendarPlus size={12} />Schedule site visit
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {canManage ? (
                      <EnquiryControls id={String(e.id)} status={String(e.status)} assigned={{ code: (e.assigned_code as string) ?? null, name: (e.assigned_name as string) ?? null }} />
                    ) : (
                      <div className="text-xs text-muted">{e.assigned_code ? `${e.assigned_code} · ${e.assigned_name}` : "Unassigned"}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
