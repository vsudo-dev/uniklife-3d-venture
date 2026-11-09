import { IntegrationNav } from "@/components/integrations/integration-nav";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { auditFilterOptions, auditFilterSchema, listAuditLogs } from "@/lib/services/audit-log";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || (typeof value === "object" && Object.keys(value as object).length === 0)) return null;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-muted">{label}</div>
      <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 p-2 text-[0.7rem] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("audit.view");
  const sp = await searchParams;
  const parsed = auditFilterSchema.safeParse({
    action: sp.action ?? "", entityType: sp.entityType ?? "", actorId: sp.actorId ?? "", from: sp.from ?? "", to: sp.to ?? "", page: sp.page ?? 1, pageSize: 50,
  });
  const filters = parsed.success ? parsed.data : auditFilterSchema.parse({});
  const [result, options] = await Promise.all([listAuditLogs(ctx, filters), auditFilterOptions(ctx)]);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const all = { action: filters.action, entityType: filters.entityType, actorId: filters.actorId, from: filters.from, to: filters.to, page: filters.page, ...over };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportHref = `/api/audit/export${qs({ page: undefined })}`;

  return (
    <>
      {sp.embedded !== "1" && <IntegrationNav />}
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        subtitle={`Append-only record of changes in ${ctx.organizationName}. Credentials and secrets are redacted before they are stored.`}
        actions={<a href={exportHref} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-gold"><Download size={16} aria-hidden /> Export CSV</a>}
      />
      {!parsed.success && <div className="mb-4"><Notice tone="warning">Some filters were invalid and have been ignored.</Notice></div>}

      <form action="/audit" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="f-action">Action contains</label>
          <input id="f-action" name="action" className="input" defaultValue={filters.action ?? ""} placeholder="e.g. booking.confirmed" />
        </div>
        <div>
          <label className="label" htmlFor="f-entity">Entity type</label>
          <select id="f-entity" name="entityType" className="input" defaultValue={filters.entityType ?? ""}>
            <option value="">All</option>
            {options.entityTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-actor">Actor</label>
          <select id="f-actor" name="actorId" className="input" defaultValue={filters.actorId ?? ""}>
            <option value="">Anyone</option>
            {options.actors.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">From</label>
          <input id="f-from" name="from" type="date" className="input" defaultValue={filters.from ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">To</label>
          <input id="f-to" name="to" type="date" className="input" defaultValue={filters.to ?? ""} />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-6">
          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast hover:bg-primary-strong">Apply filters</button>
          <Link href="/audit" className="text-sm font-semibold text-primary">Reset</Link>
          <span className="ml-auto text-xs text-muted">{result.total.toLocaleString("en-IN")} entries · dates in IST</span>
        </div>
      </form>

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState title="No audit entries match these filters" />
        ) : (
          <ul className="divide-y divide-border">
            {result.rows.map((r) => {
              const hasDetail = r.before_data != null || r.after_data != null || (r.metadata != null && Object.keys(r.metadata as object).length > 0);
              const head = (
                <div className="grid gap-1 sm:grid-cols-[170px_1fr_auto] sm:items-center sm:gap-4">
                  <time className="text-xs tabular-nums text-muted" dateTime={new Date(r.created_at).toISOString()}>{dateTime(r.created_at)}</time>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-gold-soft px-1.5 py-0.5 text-xs font-bold text-gold-strong">{r.action}</code>
                      <Badge>{r.entity_type.replace(/_/g, " ")}</Badge>
                    </div>
                    {r.summary && <div className="mt-0.5 truncate text-sm">{r.summary}</div>}
                  </div>
                  <div className="text-xs sm:text-right">
                    <div className="font-semibold">{r.actor_name ?? (r.actor_type === "user" ? "Unknown user" : r.actor_type)}</div>
                    {r.actor_email && <div className="text-muted">{r.actor_email}</div>}
                  </div>
                </div>
              );
              return (
                <li key={r.id} className="px-4 py-3 sm:px-5">
                  {hasDetail ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        {head}
                        <span className="mt-1 inline-block text-[0.7rem] font-semibold text-primary group-open:hidden">Show details</span>
                      </summary>
                      <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        <Json label="Before" value={r.before_data} />
                        <Json label="After" value={r.after_data} />
                        <Json label="Metadata" value={r.metadata} />
                      </div>
                      <div className="mt-2 text-[0.7rem] text-muted">
                        {r.entity_id && <>Entity {r.entity_id} · </>}{r.ip_address && <>IP {r.ip_address} · </>}Entry {r.id}
                      </div>
                    </details>
                  ) : head}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {result.pages > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
          {result.page > 1 ? <Link className="rounded-xl border border-border px-3 py-1.5 font-semibold hover:border-gold" href={`/audit${qs({ page: result.page - 1 })}`}>← Newer</Link> : <span />}
          <span className="text-muted">Page {result.page} of {result.pages}</span>
          {result.page < result.pages ? <Link className="rounded-xl border border-border px-3 py-1.5 font-semibold hover:border-gold" href={`/audit${qs({ page: result.page + 1 })}`}>Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
