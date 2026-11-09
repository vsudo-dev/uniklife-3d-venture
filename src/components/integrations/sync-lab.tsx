"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowLeftRight, CheckCheck, Clock3, Network, Pause, Play, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Badge, Button, Card, CardHeader, Notice, Stat } from "@/components/ui";
import { editDemo, initialSyncDemo, pendingDemo, resolveDemo, syncDemo, type Side } from "@/lib/integration/sync-prototype";

const firstScenario = () => editDemo(initialSyncDemo(), "app", "PLOT-042", "On hold");

export function SyncLab() {
  const [state, setState] = useState(firstScenario);
  const [pollDue, setPollDue] = useState(15);
  const [reconcileDue, setReconcileDue] = useState(900);
  const [elapsed, setElapsed] = useState(0);
  const seconds = Math.max(0, pollDue - elapsed);
  const reconcileIn = Math.max(0, reconcileDue - elapsed);
  const [tab, setTab] = useState("workspace");
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => {
      setElapsed(n => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.running]);
  useEffect(() => {
    if (!state.running || (elapsed < pollDue && elapsed < reconcileDue)) return;
    const full = elapsed >= reconcileDue;
    setState(s => syncDemo(s, Date.now(), full));
    setPollDue(elapsed + 15);
    if (full) setReconcileDue(elapsed + 900);
  }, [elapsed, pollDue, reconcileDue, state.running]);
  const change = (side: Side, id: string, status: string) => setState(s => editDemo(s, side, id, status));
  return <div className="space-y-6">
    <section className="relative overflow-hidden rounded-3xl bg-[#101e2d] p-6 text-white sm:p-8">
      <div className="absolute -right-12 -top-24 h-72 w-72 rounded-full border-[45px] border-emerald-400/10" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-emerald-300"><Activity size={16} /> Continuous integration lab</div><h1 className="text-3xl font-extrabold sm:text-4xl">Two applications.<br />One shared rhythm.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Changes checked every 15 seconds. A full reconciliation every 15 minutes. Clear checkpoints, safe retries, and a person in control of conflicts.</p></div>
        <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200">PROTOTYPE · DEMO DATA</span>
      </div>
      <div className="relative mt-7 flex flex-wrap items-center gap-3 text-xs text-slate-200"><ShieldCheck size={17} className="text-emerald-300" /> Authorize once <span className="text-slate-500">/</span><Network size={17} className="text-emerald-300" /> Durable sync worker planned <span className="text-slate-500">/</span> Existing API &amp; Webhooks preserved</div>
    </section>
    <Notice title="Your first demo action is queued" tone="info">Plot 42 starts as On hold in UNIKLIFE and Available in the CRM. Watch it sync after 15 seconds, or choose Sync now. Then try editing either side. These are two simulated applications in this browser; no production records or external accounts are connected.</Notice>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Connection" value={state.online ? "Healthy" : "Offline"} hint={state.running ? "Auto checks running" : "Auto checks paused"} accent="primary" /><Stat label="Next change check" value={`${seconds}s`} hint="15-second cadence while running" /><Stat label="Reconciliation" value={`${Math.floor(reconcileIn / 60)}m ${reconcileIn % 60}s`} hint="Full comparison every 15 minutes" /><Stat label="Pending records" value={pendingDemo(state)} hint={`${state.conflicts.length} conflicts · ${state.retries} offline retries`} accent="gold" /></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><nav aria-label="Sync lab sections" className="flex flex-wrap gap-1 rounded-xl border border-border p-1">{[["workspace", "Live workspace"], ["activity", "Sync activity"], ["architecture", "How it works"]].map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === id ? "bg-primary text-primary-contrast" : "text-muted"}`}>{label}</button>)}</nav><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setState(s => ({ ...s, running: !s.running }))}>{state.running ? <Pause size={15} /> : <Play size={15} />}{state.running ? "Pause checks" : "Resume checks"}</Button><Button variant="gold" onClick={() => { setState(s => syncDemo(s, Date.now())); setPollDue(elapsed + 15); }}><RefreshCw size={15} />Sync now</Button></div></div>
    {tab === "workspace" && <>
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_auto_1fr]">{(["app", "crm"] as Side[]).map((side, index) => <div key={side} className="contents">{index === 1 && <div className="hidden self-center text-primary xl:block"><ArrowLeftRight size={28} /></div>}<Card className="min-w-0 overflow-hidden"><CardHeader title={side === "app" ? "UNIKLIFE · Application A" : "Connected CRM · Application B"} subtitle={side === "app" ? "Venture, employee and sales records" : "Simulated partner application"} action={<Badge tone={state.online || side === "app" ? "success" : "danger"}>{state.online || side === "app" ? "Connected" : "Unavailable"}</Badge>} /><div className="divide-y divide-border">{state[side].map(row => <div key={row.id} className="space-y-2 p-4"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{row.name}</span><span className="font-mono text-[10px] text-muted">{row.id}</span></div><select className="input" aria-label={`${side} ${row.id} status`} value={row.status} onChange={e => change(side, row.id, e.target.value)}>{(row.id.startsWith("EMP") ? ["Active", "On leave", "Inactive"] : row.id.startsWith("PLOT") ? ["Available", "On hold", "Booked"] : ["New", "Contacted", "Qualified"]).map(value => <option key={value}>{value}</option>)}</select></div>)}</div><div className="border-t border-border bg-surface-2 px-4 py-3 text-xs text-muted">Source sequence <strong>{state.sequence[side]}</strong> · Acknowledged checkpoint <strong>{state.checkpoint[side]}</strong></div></Card></div>)}</div>
      {!!state.conflicts.length && <Card className="border-warning p-5"><h2 className="font-bold">Conflicts need your decision</h2><p className="mt-1 text-sm text-muted">Both sides changed the same record. Neither side is overwritten automatically.</p>{state.conflicts.map(id => <div key={id} className="mt-3 flex flex-wrap items-center gap-3"><strong className="text-sm">{id}</strong>{(["app", "crm"] as Side[]).map(side => <Button key={side} variant="outline" disabled={!state.online} onClick={() => setState(s => resolveDemo(s, id, side))}>Keep {side === "app" ? "UNIKLIFE" : "CRM"}: {state[side].find(r => r.id === id)?.status}</Button>)}</div>)}</Card>}
      <Card><CardHeader title="Test resilience" subtitle="Temporarily take the CRM offline, make changes, then reconnect. The next check catches up." /><div className="flex flex-wrap gap-3 p-5"><Button variant="outline" onClick={() => setState(s => ({ ...s, online: !s.online }))}><Unplug size={15} />{state.online ? "Simulate CRM offline" : "Reconnect CRM"}</Button><Button variant="outline" onClick={() => { setState(s => syncDemo(s, Date.now(), true)); setReconcileDue(elapsed + 900); }}><CheckCheck size={15} />Reconcile now</Button><Button variant="ghost" onClick={() => { setState(firstScenario()); setElapsed(0); setPollDue(15); setReconcileDue(900); }}>Reset demo</Button></div></Card>
    </>}
    {tab === "activity" && <Card><CardHeader title="Sync activity" subtitle="Latest 30 in-memory events. This log clears when the page reloads." /><ol className="divide-y divide-border">{state.log.map((line, i) => <li key={`${i}-${line}`} className="flex items-start gap-3 px-5 py-3 text-sm"><Clock3 size={16} className="mt-0.5 shrink-0 text-muted" />{line}</li>)}</ol><div className="border-t border-border p-5 text-xs text-muted">Last successful check: {state.lastSync ? new Date(state.lastSync).toLocaleTimeString() : "Waiting"} · Last reconciliation: {state.lastReconcile ? new Date(state.lastReconcile).toLocaleTimeString() : "Waiting"}</div></Card>}
    {tab === "architecture" && <div className="grid gap-4 md:grid-cols-2">{[
      ["01 · Authorize once", "A secure connector is authorized once, then tokens are refreshed where supported. No repeated manual registration for each sync. Provider access, consent and permissions are still required."],
      ["02 · Capture changes", "Use database change capture, an outbox or a provider change feed. Where unavailable, poll an API with a durable cursor and pagination. Read changes since the last acknowledged cursor, rather than only a timestamp window."],
      ["03 · Apply safely", "A durable worker checks both directions every 15 seconds. Stable record IDs, idempotency keys, origin markers and retries prevent duplicate writes and echo loops. Conflicting edits go to review."],
      ["04 · Reconcile every 15 minutes", "Compare actual records and versions to catch drift. Resume from checkpoints after restarts. Tombstones and explicit deletion rules prevent old records from reappearing."],
      ["05 · MCP for intelligent actions", "MCP can expose tools such as inspect_sync, reconcile and review_conflict to an assistant. It complements the sync service; MCP by itself does not schedule work or replace the source application's APIs."],
      ["06 · Continuous operations", "Production needs an always-running worker, durable queue and checkpoint store, tenant isolation, rate-limit backoff, dead-letter handling and monitoring. This browser demo pauses or slows when closed or backgrounded; it is not a 24-hour worker."],
    ].map(([title, text]) => <Card key={title} className="p-5"><h2 className="font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{text}</p></Card>)}<p className="text-xs text-muted md:col-span-2">References: <a href="https://modelcontextprotocol.io/specification/2025-11-25/basic/transports" target="_blank" rel="noreferrer" className="underline">MCP transport specification</a>{" · "}<a href="https://www.postgresql.org/docs/current/logicaldecoding.html" target="_blank" rel="noreferrer" className="underline">PostgreSQL change capture</a>. Target application adapters and actual MCP server are future implementation, pending prototype approval.</p></div>}
  </div>;
}
