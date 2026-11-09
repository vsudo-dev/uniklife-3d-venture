import Link from "next/link";
import { ArrowLeft, Network, ShieldCheck, Users } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { getMyNetwork } from "@/lib/services/employees";
import { isUuid } from "@/lib/services/common";
import { AppError } from "@/lib/errors";
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader, Stat, StatusBadge, cx } from "@/components/ui";
import { num } from "@/lib/format";

export const metadata = { title: "My network" };

interface Member {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string | null;
  commission_level: number | null;
  reporting_manager_id: string | null;
  depth: number;
  employment_status: string;
  bookings: number;
  confirmed_bookings: number;
  booked_area: string;
}

interface Node extends Member {
  children: Node[];
  teamSize: number;
  teamArea: number;
  teamConfirmed: number;
}

function buildTree(members: Member[], rootId: string): Node | null {
  const nodes = new Map<string, Node>(members.map((m) => [m.id, { ...m, children: [], teamSize: 0, teamArea: 0, teamConfirmed: 0 }]));
  for (const n of nodes.values()) {
    if (n.id !== rootId && n.reporting_manager_id && nodes.has(n.reporting_manager_id)) nodes.get(n.reporting_manager_id)!.children.push(n);
  }
  const root = nodes.get(rootId) ?? null;
  const roll = (n: Node): void => {
    n.children.sort((a, b) => (a.commission_level ?? 99) - (b.commission_level ?? 99) || a.full_name.localeCompare(b.full_name));
    for (const c of n.children) {
      roll(c);
      n.teamSize += 1 + c.teamSize;
      n.teamArea += Number(c.booked_area) + c.teamArea;
      n.teamConfirmed += c.confirmed_bookings + c.teamConfirmed;
    }
  };
  if (root) roll(root);
  return root;
}

function LevelBadge({ level }: { level: number | null }) {
  return level ? (
    <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-md bg-gradient-to-br from-[#f3dc8a] via-gold to-gold-strong px-1.5 text-xs font-extrabold text-[#1b1400]">L{level}</span>
  ) : (
    <Badge tone="neutral">off ladder</Badge>
  );
}

function NodeRow({ n, isRoot }: { n: Node; isRoot: boolean }) {
  return (
    <div className={cx("flex flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between", isRoot ? "border-gold/60 bg-gold-soft/40" : "border-border bg-surface hover:border-gold/60")}>
      <div className="flex min-w-0 items-center gap-3">
        <LevelBadge level={n.commission_level} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 font-semibold">
            {isRoot ? <span>{n.full_name}</span> : <Link href={`/network?root=${n.id}`} className="text-primary hover:underline">{n.full_name}</Link>}
            <span className="text-xs font-medium text-muted">{n.employee_code}</span>
            {n.employment_status !== "active" && <StatusBadge status={n.employment_status} />}
          </div>
          <div className="truncate text-xs text-muted">{n.designation ?? "—"}{n.children.length > 0 ? ` · ${n.children.length} direct · ${n.teamSize} in team` : ""}</div>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-right text-xs sm:min-w-[260px]">
        <div><dt className="text-muted">Bookings</dt><dd className="font-bold tabular-nums">{n.bookings}</dd></div>
        <div><dt className="text-muted">Confirmed</dt><dd className="font-bold tabular-nums">{n.confirmed_bookings}</dd></div>
        <div><dt className="text-muted">Area (sq yd)</dt><dd className="font-bold tabular-nums">{num(n.booked_area)}</dd></div>
      </dl>
    </div>
  );
}

function Tree({ n, isRoot = false }: { n: Node; isRoot?: boolean }) {
  if (n.children.length === 0) return <NodeRow n={n} isRoot={isRoot} />;
  return (
    <details open={n.depth < 3} className="group">
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <span className="mt-3 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-border bg-surface text-xs font-bold text-muted transition group-open:rotate-90" aria-hidden>›</span>
        <div className="min-w-0 flex-1"><NodeRow n={n} isRoot={isRoot} /></div>
      </summary>
      <ul className="ml-2.5 mt-2 space-y-2 border-l-2 border-gold/30 pl-4 sm:ml-[1.1rem] sm:pl-5">
        {n.children.map((c) => (
          <li key={c.id} className="relative before:absolute before:-left-4 before:top-6 before:h-px before:w-4 before:bg-gold/30 sm:before:-left-5 sm:before:w-5">
            <Tree n={c} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function NetworkPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("staff");
  const sp = await searchParams;
  const requested = sp.root && isUuid(sp.root) ? sp.root : undefined;

  let data: Awaited<ReturnType<typeof getMyNetwork>> | null = null;
  let outOfScope = false;
  try {
    data = await getMyNetwork(ctx, requested);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) outOfScope = true;
    else throw e;
  }

  const header = (
    <PageHeader
      eyebrow="Sales"
      title="My network"
      subtitle="Your reporting tree — you and everyone who reports to you, directly or indirectly. Upline managers and their earnings are never shown."
      actions={requested && requested !== ctx.employee?.id ? <LinkButton href="/network" variant="outline"><ArrowLeft size={16} aria-hidden /> Back to my network</LinkButton> : undefined}
    />
  );

  if (outOfScope) {
    return (
      <>
        {header}
        <Notice tone="warning" title="Not in your network">You can only view yourself and employees who report to you.</Notice>
      </>
    );
  }
  if (!data?.root) {
    return (
      <>
        {header}
        <Card><EmptyState title="No employee record linked">Your account is not linked to an employee in the directory, so there is no reporting tree to show.</EmptyState></Card>
      </>
    );
  }

  const members = data.members as Member[];
  const tree = buildTree(members, data.root);
  if (!tree) {
    return (
      <>
        {header}
        <Card><EmptyState title="Employee not found" /></Card>
      </>
    );
  }
  const viewingSelf = tree.id === ctx.employee?.id;
  const team = members.filter((m) => m.id !== tree.id);
  const teamBookings = team.reduce((s, m) => s + m.bookings, 0);
  const levelCounts = new Map<number, number>();
  for (const m of team) if (m.commission_level) levelCounts.set(m.commission_level, (levelCounts.get(m.commission_level) ?? 0) + 1);

  return (
    <>
      {header}

      <section className="premium-hero mb-6 overflow-hidden rounded-2xl p-5 text-white shadow-[var(--shadow)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-[#f3dc8a]/40">
              <Network size={26} className="text-[#f3dc8a]" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#f3dc8a]">{viewingSelf ? "Your position" : "Viewing subtree"}</div>
              <div className="truncate text-2xl font-extrabold tracking-tight">{tree.full_name}</div>
              <div className="text-sm text-white/70">{tree.employee_code} · {tree.designation ?? "—"}{tree.commission_level ? ` · Level ${tree.commission_level}` : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80 ring-1 ring-white/15">
            <ShieldCheck size={16} className="text-[#f3dc8a]" aria-hidden /> Scope enforced on the server — only you and your downline.
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Team members" value={team.length} hint={`${tree.children.length} direct report${tree.children.length === 1 ? "" : "s"}`} accent="primary" />
        <Stat label="Team bookings" value={teamBookings} hint={`${tree.teamConfirmed} confirmed`} />
        <Stat label="Team confirmed area" value={`${num(tree.teamArea)} sq yd`} hint="Confirmed & completed bookings" accent="gold" />
        <Stat label={viewingSelf ? "Your confirmed area" : "Their confirmed area"} value={`${num(tree.booked_area)} sq yd`} hint={`${tree.confirmed_bookings} confirmed of ${tree.bookings}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Hierarchy" subtitle="Click a name to focus on that person's subtree. Expand or collapse branches with the arrow." />
          <div className="overflow-x-auto p-4 sm:p-5">
            <Tree n={tree} isRoot />
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={<span className="inline-flex items-center gap-2"><Users size={16} className="text-gold" aria-hidden /> Direct downline</span>} subtitle={`${tree.children.length} reporting directly`} />
            {tree.children.length === 0 ? (
              <EmptyState title="No direct reports" />
            ) : (
              <ul className="divide-y divide-border">
                {tree.children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/network?root=${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                      <span className="flex min-w-0 items-center gap-3">
                        <LevelBadge level={c.commission_level} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{c.full_name}</span>
                          <span className="block truncate text-xs text-muted">{c.employee_code} · {c.designation ?? "—"}</span>
                        </span>
                      </span>
                      <span className="text-right text-xs text-muted">
                        <span className="block font-bold text-text tabular-nums">{num(Number(c.booked_area) + c.teamArea)} sq yd</span>
                        incl. {c.teamSize} below
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {levelCounts.size > 0 && (
            <Card className="p-5">
              <h3 className="font-bold">Team by level</h3>
              <ul className="mt-3 space-y-2">
                {[...levelCounts.entries()].sort((a, b) => a[0] - b[0]).map(([lvl, count]) => (
                  <li key={lvl} className="flex items-center gap-3 text-sm">
                    <LevelBadge level={lvl} />
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(8, (count / team.length) * 100)}%` }} />
                    </span>
                    <span className="w-6 text-right font-bold tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
