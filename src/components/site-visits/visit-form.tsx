"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, UserRound } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Card, Notice, cx } from "@/components/ui";

type Employee = { id: string; employee_code: string; full_name: string; designation: string | null };

export interface VisitPrefill {
  ventureId?: string | null;
  plotIds?: string[];
  enquiryId?: string | null;
  name?: string | null;
  phone?: string | null;
}

function defaultWhen(): string {
  // Tomorrow 11:00 local time.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VisitForm({
  isCustomer,
  ventures,
  prefill,
  me,
  successHref,
}: {
  isCustomer: boolean;
  ventures: { id: string; name: string }[];
  prefill: VisitPrefill;
  me: { employeeId: string | null; employeeLabel: string | null; name?: string | null; phone?: string | null };
  successHref: string;
}) {
  const router = useRouter();
  const [ventureId, setVentureId] = useState(prefill.ventureId && ventures.some((v) => v.id === prefill.ventureId) ? prefill.ventureId : ventures[0]?.id ?? "");
  const [plots, setPlots] = useState<{ id: string; plot_number: string; status: string }[]>([]);
  const [plotIds, setPlotIds] = useState<string[]>(prefill.plotIds ?? []);
  const [when, setWhen] = useState("");
  const [name, setName] = useState(prefill.name ?? (isCustomer ? me.name ?? "" : ""));
  const [phone, setPhone] = useState(prefill.phone ?? (isCustomer ? me.phone ?? "" : ""));
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState<Employee | null>(null);
  const [empQ, setEmpQ] = useState("");
  const [emps, setEmps] = useState<Employee[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setWhen(defaultWhen()), []);

  useEffect(() => {
    if (!ventureId) return setPlots([]);
    api<{ plots: { id: string; plot_number: string; status: string }[] }>(`/api/site-visits/options?venture=${ventureId}`)
      .then((r) => {
        setPlots(r.plots);
        setPlotIds((ids) => ids.filter((id) => r.plots.some((p) => p.id === id)));
      })
      .catch(() => setPlots([]));
  }, [ventureId]);

  useEffect(() => {
    if (isCustomer) return;
    const t = window.setTimeout(() => api<Employee[]>(`/api/site-visits/assignees?q=${encodeURIComponent(empQ)}`).then(setEmps).catch(() => setEmps([])), 200);
    return () => window.clearTimeout(t);
  }, [empQ, isCustomer]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const scheduledAt = new Date(when);
      if (Number.isNaN(scheduledAt.getTime())) throw new Error("Choose a valid date and time");
      await api("/api/site-visits", {
        body: {
          ventureId, plotIds, scheduledAt: scheduledAt.toISOString(), visitorName: name || null, visitorPhone: phone || null, notes: notes || null,
          ...(isCustomer ? {} : { employeeId: assignee?.id ?? null, enquiryId: prefill.enquiryId ?? null }),
        },
      });
      router.push(successHref);
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (ventures.length === 0) return <Notice tone="info">No ventures are available for site visits right now.</Notice>;

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <h2 className="font-bold">Where</h2>
          <div>
            <label className="label" htmlFor="sv-v">Venture</label>
            <select id="sv-v" className="input" value={ventureId} onChange={(e) => setVentureId(e.target.value)} required>
              {ventures.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <span className="label">Plots of interest (optional)</span>
            {plots.length === 0 ? (
              <p className="text-sm text-muted">No plots to choose from for this venture.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-xl border border-border p-2">
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
                  {plots.map((p) => {
                    const on = plotIds.includes(p.id);
                    return (
                      <button type="button" key={p.id} aria-pressed={on} title={p.status}
                        onClick={() => setPlotIds(on ? plotIds.filter((x) => x !== p.id) : plotIds.length >= 10 ? plotIds : [...plotIds, p.id])}
                        className={cx("rounded-lg border px-1.5 py-1.5 text-xs font-semibold", on ? "border-gold bg-gold text-[#1b1400]" : "border-border hover:border-gold", p.status !== "available" && !on && "opacity-60")}>
                        {p.plot_number}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="mt-1 text-xs text-muted">{plotIds.length} selected (max 10).</p>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-bold">{isCustomer ? "Your details" : "Visitor"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="sv-n">Name</label>
              <input id="sv-n" className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="sv-p">Mobile</label>
              <input id="sv-p" className="input" required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="sv-notes">{isCustomer ? "Anything we should know? (optional)" : "Notes (optional)"}</label>
              <textarea id="sv-notes" className="input" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </Card>

        {!isCustomer && (
          <Card className="space-y-3 p-5">
            <h2 className="font-bold">Assigned employee</h2>
            {assignee ? (
              <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm">
                <span><UserRound size={14} className="mr-1 inline" /><strong>{assignee.employee_code}</strong> · {assignee.full_name}</span>
                <button type="button" className="font-semibold text-primary" onClick={() => setAssignee(null)}>Change</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted">Defaults to you{me.employeeLabel ? ` (${me.employeeLabel})` : ""}. You can assign anyone in your permitted team.</p>
                <input className="input" placeholder="Search your team by name or employee ID" value={empQ} onChange={(e) => setEmpQ(e.target.value)} aria-label="Search employees" />
                <ul className="max-h-48 divide-y divide-border overflow-y-auto">
                  {emps.map((x) => (
                    <li key={x.id}><button type="button" className="w-full px-2 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setAssignee(x)}><strong>{x.employee_code}</strong> · {x.full_name} <span className="text-muted">{x.designation}</span></button></li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}
      </div>

      <aside>
        <Card className="sticky top-24 space-y-4 p-5 shadow-[var(--glow)]">
          <h2 className="flex items-center gap-2 font-bold"><CalendarCheck size={18} className="text-gold" />When</h2>
          <div>
            <label className="label" htmlFor="sv-when">Preferred date & time</label>
            <input id="sv-when" type="datetime-local" className="input" required value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" variant="gold" className="w-full" disabled={busy || !ventureId}>
            {busy && <Loader2 size={16} className="animate-spin" />}{isCustomer ? "Request site visit" : "Schedule visit"}
          </Button>
          <p className="text-[0.7rem] leading-relaxed text-muted">
            {isCustomer
              ? "Our sales team will confirm the time with you. You can cancel the request from your portal."
              : "The assigned employee is notified and gets reminders 24 hours and 2 hours before the visit."}
          </p>
        </Card>
      </aside>
    </form>
  );
}
