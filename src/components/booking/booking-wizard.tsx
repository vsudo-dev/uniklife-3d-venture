"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, Search, Tag, UserRound, X } from "lucide-react";
import { api, ApiError, newIdempotencyKey } from "@/lib/client/api";
import { Button, Card, Notice, cx } from "@/components/ui";
import { inr, num } from "@/lib/format";
import type { PricingResult } from "@/lib/pricing/engine";

interface Props {
  plotIds: string[];
  isCustomer: boolean;
  canCreditOthers: boolean;
  me: { employeeCode: string | null; employeeName: string | null; customerName: string | null };
}

type Customer = { id: string; full_name: string; phone: string | null; email: string | null };
type Employee = { id: string; employee_code: string; full_name: string; designation: string | null };
type Offer = { id: string; name: string; valueType: string; value: number; expiresAt: string | null };

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BookingWizard({ plotIds, isCustomer, canCreditOthers, me }: Props) {
  const router = useRouter();
  const [quote, setQuote] = useState<PricingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Customer (staff flow)
  const [custMode, setCustMode] = useState<"search" | "new">("search");
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newCust, setNewCust] = useState({ fullName: "", phone: "", email: "" });

  // Attribution (staff flow)
  const [empQuery, setEmpQuery] = useState("");
  const [empResults, setEmpResults] = useState<Employee[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);

  // Hold / discounts / booking
  const [hold, setHold] = useState<{ holdGroupId: string; expiresAt: string } | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [refs, setRefs] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const holdKey = useRef(newIdempotencyKey("hold"));
  const bookingKey = useRef(newIdempotencyKey("booking"));
  const countdown = useCountdown(hold?.expiresAt ?? null);

  const customerId = isCustomer ? null : customer?.id ?? null;

  const preview = useCallback(
    async (nextRefs: string[]) => {
      try {
        const q = await api<PricingResult>("/api/discounts/validate", { body: { plotIds, discountRefs: nextRefs, customerId } });
        setQuote(q);
        return q;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [plotIds, customerId],
  );

  useEffect(() => {
    preview(refs);
    api<Offer[]>(`/api/discounts/offers?plots=${plotIds.join(",")}${customerId ? `&customer=${customerId}` : ""}`).then(setOffers).catch(() => setOffers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    if (isCustomer || custMode !== "search" || custQuery.trim().length < 2) return setCustResults([]);
    const t = window.setTimeout(() => api<Customer[]>(`/api/customers/search?q=${encodeURIComponent(custQuery)}`).then(setCustResults).catch(() => undefined), 250);
    return () => window.clearTimeout(t);
  }, [custQuery, custMode, isCustomer]);

  useEffect(() => {
    if (isCustomer || !canCreditOthers) return;
    const t = window.setTimeout(() => api<Employee[]>(`/api/employees/search?q=${encodeURIComponent(empQuery)}`).then(setEmpResults).catch(() => undefined), 250);
    return () => window.clearTimeout(t);
  }, [empQuery, isCustomer, canCreditOthers]);

  const customerReady = isCustomer || !!customer || (custMode === "new" && newCust.fullName.trim().length >= 2 && /^\+?[0-9 -]{7,20}$/.test(newCust.phone));

  async function placeHold() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ holdGroupId: string; expiresAt: string }>("/api/bookings/hold", {
        body: {
          plotIds,
          idempotencyKey: holdKey.current,
          customerId: isCustomer ? undefined : customer?.id,
          customer: !isCustomer && !customer ? { fullName: newCust.fullName, phone: newCust.phone, email: newCust.email || null } : undefined,
          employeeCode: employee?.employee_code ?? undefined,
        },
      });
      setHold(res);
    } catch (e) {
      setError((e as Error).message);
      holdKey.current = newIdempotencyKey("hold");
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold() {
    if (!hold) return;
    await api(`/api/bookings/hold/${hold.holdGroupId}`, { method: "DELETE" }).catch(() => undefined);
    setHold(null);
    holdKey.current = newIdempotencyKey("hold");
  }

  async function applyCode(ref: string) {
    const r = ref.trim();
    if (!r || refs.includes(r)) return;
    const next = [...refs, r];
    const q = await preview(next);
    const line = q?.lines.find((l) => l.ref === r);
    if (line && !line.ok) {
      setError(line.reason ?? "Discount cannot be applied");
      await preview(refs);
      return;
    }
    setError(null);
    setRefs(next);
    setCode("");
  }

  async function removeRef(r: string) {
    const next = refs.filter((x) => x !== r);
    setRefs(next);
    await preview(next);
  }

  async function submitBooking() {
    if (!hold) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api<{ bookingId: string }>("/api/bookings", {
        body: { holdGroupId: hold.holdGroupId, discountRefs: refs, idempotencyKey: bookingKey.current, employeeCode: employee?.employee_code ?? undefined },
      });
      const pay = await api<{ checkoutUrl: string }>(`/api/bookings/${b.bookingId}/pay`, { body: { idempotencyKey: newIdempotencyKey("pay") } }).catch(() => null);
      if (isCustomer) router.push(pay ? `${pay.checkoutUrl}` : `/portal/bookings/${b.bookingId}`);
      else router.push(`/bookings/${b.bookingId}?created=1`);
    } catch (e) {
      const err = e as ApiError;
      const details = Array.isArray(err.details) ? (err.details as { ref?: string; reason?: string }[]).map((d) => `${d.ref}: ${d.reason}`).join("; ") : "";
      setError(details ? `${err.message} — ${details}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  const s = quote?.snapshot;
  const expired = countdown === "expired";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        {error && <Notice tone="danger" title="Action needed">{error}</Notice>}

        <Card className="p-5">
          <h2 className="mb-3 font-bold">1 · Selected plots</h2>
          {!s ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />Loading live prices…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Plot</th><th>Area (sq yd)</th><th>Rate / sq yd</th><th className="text-right">Base price</th></tr></thead>
                <tbody>
                  {s.plots.map((p) => (
                    <tr key={p.plotId}><td className="font-semibold">Plot {p.plotNumber}</td><td>{num(p.areaSqYards)}</td><td>{inr(p.pricePerSqYard)}</td><td className="text-right">{inr(p.baseAmount)}</td></tr>
                  ))}
                  <tr><td className="font-bold">Combined</td><td className="font-bold">{num(s.totalAreaSqYards)}</td><td /><td className="text-right font-bold">{inr(s.baseAmount)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {!isCustomer && (
          <Card className="p-5">
            <h2 className="mb-3 font-bold">2 · Customer</h2>
            {customer ? (
              <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
                <div><div className="font-semibold">{customer.full_name}</div><div className="text-xs text-muted">{customer.phone} {customer.email ? `· ${customer.email}` : ""}</div></div>
                {!hold && <button className="text-sm font-semibold text-primary" onClick={() => setCustomer(null)}>Change</button>}
              </div>
            ) : (
              <>
                <div className="mb-3 flex gap-2">
                  <button className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", custMode === "search" ? "bg-primary text-white" : "bg-surface-2")} onClick={() => setCustMode("search")}>Existing customer</button>
                  <button className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", custMode === "new" ? "bg-primary text-white" : "bg-surface-2")} onClick={() => setCustMode("new")}>New customer</button>
                </div>
                {custMode === "search" ? (
                  <div>
                    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Search by name or phone" value={custQuery} onChange={(e) => setCustQuery(e.target.value)} aria-label="Search customers" /></div>
                    <ul className="mt-2 divide-y divide-border">
                      {custResults.map((c) => (
                        <li key={c.id}><button className="w-full px-2 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setCustomer(c)}><strong>{c.full_name}</strong> <span className="text-muted">{c.phone}</span></button></li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><label className="label" htmlFor="nc-name">Full name</label><input id="nc-name" className="input" value={newCust.fullName} onChange={(e) => setNewCust({ ...newCust, fullName: e.target.value })} /></div>
                    <div><label className="label" htmlFor="nc-phone">Mobile</label><input id="nc-phone" className="input" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
                    <div><label className="label" htmlFor="nc-email">Email</label><input id="nc-email" type="email" className="input" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></div>
                  </div>
                )}
              </>
            )}

            <h3 className="mb-2 mt-5 text-sm font-bold">Selling employee (sales attribution)</h3>
            {employee ? (
              <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm">
                <span><UserRound size={14} className="mr-1 inline" /><strong>{employee.employee_code}</strong> · {employee.full_name}{employee.designation ? ` · ${employee.designation}` : ""}</span>
                {!hold && <button className="font-semibold text-primary" onClick={() => setEmployee(null)}>Change</button>}
              </div>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted">
                  Defaults to you{me.employeeCode ? ` (${me.employeeCode} · ${me.employeeName})` : ""}. {canCreditOthers ? "You may credit a member of your own team." : "You can only credit yourself."}
                </p>
                {canCreditOthers && (
                  <>
                    <input className="input" placeholder="Search your team by name or employee ID" value={empQuery} onChange={(e) => setEmpQuery(e.target.value)} disabled={!!hold} aria-label="Search employees" />
                    <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto">
                      {empResults.map((e) => (
                        <li key={e.id}><button className="w-full px-2 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setEmployee(e)}><strong>{e.employee_code}</strong> · {e.full_name} <span className="text-muted">{e.designation}</span></button></li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </Card>
        )}

        <Card className="p-5">
          <h2 className="mb-1 font-bold">{isCustomer ? "2" : "3"} · Hold the plots</h2>
          <p className="mb-3 text-sm text-muted">A temporary hold reserves the plots for you while you complete the booking. Holds expire automatically.</p>
          {hold ? (
            <div className={cx("flex items-center justify-between rounded-xl px-4 py-3", expired ? "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]" : "bg-gold-soft")} data-testid="hold-active">
              <span className="flex items-center gap-2 font-semibold"><Clock size={16} />{expired ? "Hold expired — please start again" : `Held for you · ${countdown} remaining`}</span>
              <button className="text-sm font-semibold text-muted" onClick={releaseHold}>Release</button>
            </div>
          ) : (
            <Button onClick={placeHold} disabled={busy || !customerReady || !s} data-testid="place-hold">{busy ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}Place temporary hold</Button>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-bold">{isCustomer ? "3" : "4"} · Discounts</h2>
          {offers.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-xs font-semibold text-muted">Eligible offers</div>
              <div className="flex flex-wrap gap-2">
                {offers.map((o) => (
                  <button key={o.id} disabled={refs.includes(o.id)} onClick={() => applyCode(o.id)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-gold disabled:opacity-50">
                    <Tag size={12} className="text-gold" />{o.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); applyCode(code); }} className="flex gap-2">
            <input className="input uppercase" placeholder="Discount code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Discount code" data-testid="discount-code" />
            <Button type="submit" variant="outline" disabled={!code.trim()}>Apply</Button>
          </form>
          {quote && quote.lines.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {quote.lines.map((l) => (
                <li key={l.ref} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">{l.ok ? <CheckCircle2 size={14} className="text-success" /> : <X size={14} className="text-danger" />}{l.name ?? l.ref}{!l.ok && <span className="text-xs text-danger">{l.reason}</span>}</span>
                  <span className="flex items-center gap-3">{l.ok && <strong>-{inr(l.amount)}</strong>}<button onClick={() => removeRef(l.ref)} aria-label="Remove discount"><X size={14} /></button></span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Discounts are validated on the server and re-validated when your payment is confirmed. Stacking rules are set by the developer.</p>
        </Card>
      </div>

      <aside>
        <Card className="sticky top-24 p-5 shadow-[var(--glow)]">
          <h2 className="font-bold">Booking summary</h2>
          {s ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Plots</dt><dd className="font-semibold">{s.plots.map((p) => p.plotNumber).join(", ")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Combined area</dt><dd>{num(s.totalAreaSqYards)} sq yd</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Base price</dt><dd>{inr(s.baseAmount)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Discounts</dt><dd className="text-success">-{inr(s.discountTotal)}</dd></div>
              {s.cappedByOrganizationLimit && <div className="text-xs text-warning">Total discount capped at the permitted limit.</div>}
              <div className="flex justify-between border-t border-border pt-2 text-base"><dt className="font-bold">Net price</dt><dd className="font-extrabold">{inr(s.netAmount)}</dd></div>
              <div className="flex justify-between rounded-xl bg-gold-soft px-3 py-2"><dt className="font-semibold">Advance due now ({s.bookingAmountPercent}%)</dt><dd className="font-extrabold" data-testid="advance-amount">{inr(s.bookingAmount)}</dd></div>
            </dl>
          ) : (
            <div className="mt-3 text-sm text-muted">Calculating…</div>
          )}
          <Button className="mt-4 w-full" variant="gold" disabled={!hold || expired || busy || (quote ? !quote.ok : true)} onClick={submitBooking} data-testid="submit-booking">
            {busy && <Loader2 size={16} className="animate-spin" />}{isCustomer ? "Confirm & pay advance" : "Create booking"}
          </Button>
          <p className="mt-2 text-[0.7rem] leading-relaxed text-muted">
            The booking is confirmed only after the advance payment is verified by the server. Amounts are calculated on the server; the figures above are a live preview.
          </p>
        </Card>
      </aside>
    </div>
  );
}
