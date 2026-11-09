"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, IndianRupee } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Notice, PlotStatusBadge } from "@/components/ui";
import { inr, num } from "@/lib/format";
import type { PlotListRow } from "@/lib/services/plots";
import { propertyTypeLabel } from "./property-type-filter";

type Action = "block" | "unblock" | "price" | null;

export function PlotTable({ rows, header, canManage, canBook, showCustomer, showVenture }: {
  rows: PlotListRow[];
  header: ReactNode;
  canManage: boolean;
  canBook: boolean;
  showCustomer: boolean;
  showVenture: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState({ mode: "set" as "set" | "percent" | "delta", value: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const chosen = rows.filter((r) => selected.has(r.id));
  const blockable = chosen.filter((r) => r.status === "available" && !r.has_active_hold && !r.has_live_booking);
  const unblockable = chosen.filter((r) => r.status === "blocked" && !r.is_mortgaged && r.base_price_per_sq_yard > 0 && !r.has_active_hold && !r.has_live_booking);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  async function submit() {
    if (!action) return;
    setBusy(true);
    setMsg(null);
    try {
      const plotIds = action === "block" ? blockable.map((r) => r.id) : action === "unblock" ? unblockable.map((r) => r.id) : chosen.map((r) => r.id);
      const bodyData = action === "price"
        ? { action, plotIds, mode: price.mode, value: Number(price.value), reason }
        : { action, plotIds, reason };
      const res = await api<{ updated: number; unchanged?: number }>("/api/plots/bulk", { method: "POST", body: bodyData });
      setMsg({ ok: true, text: `${res.updated} plot(s) updated${res.unchanged ? `, ${res.unchanged} unchanged` : ""}.` });
      setAction(null);
      setReason("");
      setPrice({ mode: "set", value: "" });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const targetCount = action === "block" ? blockable.length : action === "unblock" ? unblockable.length : chosen.length;
  const priceValid = price.value.trim() !== "" && Number.isFinite(Number(price.value)) && (price.mode !== "set" || Number(price.value) >= 0);

  return (
    <div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-sm text-muted">{selected.size ? `${selected.size} selected` : "Select plots for bulk actions"}</span>
          <Button variant="outline" disabled={!blockable.length} onClick={() => setAction("block")} title="Only available plots without an active hold or live booking">
            <Lock size={14} /> Block{blockable.length ? ` (${blockable.length})` : ""}
          </Button>
          <Button variant="outline" disabled={!unblockable.length} onClick={() => setAction("unblock")}>
            <LockOpen size={14} /> Unblock{unblockable.length ? ` (${unblockable.length})` : ""}
          </Button>
          <Button variant="outline" disabled={!chosen.length} onClick={() => setAction("price")}>
            <IndianRupee size={14} /> Update price
          </Button>
          {selected.size > 0 && <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>}
        </div>
      )}
      {action && (
        <div className="space-y-3 border-b border-border bg-surface-2 px-4 py-4">
          <div className="font-semibold">
            {action === "block" ? `Block ${targetCount} plot(s)` : action === "unblock" ? `Unblock ${targetCount} plot(s)` : `Update price of ${targetCount} plot(s)`}
          </div>
          {action === "block" && blockable.length < chosen.length && (
            <Notice tone="warning">{chosen.length - blockable.length} selected plot(s) are not available or have an active hold / live booking and will be skipped.</Notice>
          )}
          {action === "price" && (
            <>
              <div className="flex flex-wrap gap-2">
                <select className="input max-w-[220px]" aria-label="Price change type" value={price.mode} onChange={(e) => setPrice({ ...price, mode: e.target.value as typeof price.mode })}>
                  <option value="set">Set price per sq yd to</option>
                  <option value="percent">Change by % (e.g. 5 or -3)</option>
                  <option value="delta">Change by ₹ per sq yd</option>
                </select>
                <input className="input max-w-[180px]" inputMode="decimal" aria-label="Value" placeholder={price.mode === "percent" ? "%" : "₹ / sq yd"} value={price.value} onChange={(e) => setPrice({ ...price, value: e.target.value })} />
              </div>
              <p className="text-xs text-muted">Writes price history and an audit entry. Existing bookings and holds keep the price captured in their own snapshot.</p>
            </>
          )}
          <textarea className="input" rows={2} placeholder="Reason (required, audited)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || targetCount === 0 || reason.trim().length < (action === "price" ? 3 : 5) || (action === "price" && !priceValid)} onClick={submit}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`px-4 py-2 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {canManage && (
                <th className="w-8">
                  <input type="checkbox" aria-label="Select all plots on this page" checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              )}
              {header}
              <th>Mortgage</th><th>Mortgage key / reference</th><th>Action</th>
              <th>Property type</th>
              {showCustomer && <th>Current customer</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-gold-soft/40" : undefined}>
                {canManage && (
                  <td><input type="checkbox" aria-label={`Select plot ${r.plot_number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                )}
                <td>
                  <Link href={`/plots/${r.id}`} className="font-semibold text-primary hover:underline">{r.plot_number}</Link>
                  {r.is_corner && <Badge tone="gold" className="ml-1">corner</Badge>}
                  {showVenture && <div className="text-xs text-muted">{r.venture_code}</div>}
                </td>
                <td>{r.phase_code ?? "—"}</td>
                <td className="text-right">{num(r.area_sq_yards)}</td>
                <td>{r.is_mortgaged ? <Badge tone="gold">Mortgage · blocked</Badge> : "No"}</td>
                <td className="text-xs"><Link href={`/plots/${r.id}#mortgage`} className="text-primary hover:underline">{r.mortgage_reference || (canManage ? "Add reference" : "—")}</Link></td>
                <td><Link href={`/plots/${r.id}`} className="text-primary underline">View plot</Link>{canBook && r.status==="available" && !r.is_mortgaged && r.base_price_per_sq_yard>0 && <Link className="ml-3 text-primary underline" href={`/bookings/new?plots=${r.id}`}>Book</Link>}</td>
                <td className="whitespace-nowrap text-xs">{r.dimensions_text ?? (r.width_ft && r.length_ft ? `${r.width_ft} × ${r.length_ft} ft` : "—")}</td>
                <td>{r.facing ?? "—"}</td>
                <td className="text-right">{r.road_width_ft ? `${num(r.road_width_ft)} ft` : "—"}</td>
                <td className="text-right">{inr(r.base_price_per_sq_yard)}</td>
                <td className="text-right font-semibold">{inr(r.total_base_price)}</td>
                <td>
                  <PlotStatusBadge status={r.status} />
                  {r.status === "blocked" && r.blocked_reason && <div className="mt-0.5 max-w-[180px] truncate text-xs text-muted" title={r.blocked_reason}>{r.blocked_reason}</div>}
                </td>
                <td>{r.is_mortgaged ? <Badge tone="gold">Mortgage · blocked</Badge> : "No"}</td>
                <td className="text-xs"><Link href={`/plots/${r.id}#mortgage`} className="text-primary hover:underline">{r.mortgage_reference || (canManage ? "Add reference" : "—")}</Link></td>
                <td><Link href={`/plots/${r.id}`} className="text-primary underline">View plot</Link>{canBook && r.status==="available" && !r.is_mortgaged && r.base_price_per_sq_yard>0 && <Link className="ml-3 text-primary underline" href={`/bookings/new?plots=${r.id}`}>Book</Link>}</td>
                <td className="whitespace-nowrap text-xs">
                  {r.property_type ? (
                    <span className="font-semibold">{propertyTypeLabel(r.property_type)}</span>
                  ) : (
                    <span className="text-muted" title="Inherited from the venture">{propertyTypeLabel(r.effective_property_type)} <span className="italic">(venture)</span></span>
                  )}
                </td>
                {showCustomer && (
                  <td className="text-xs">
                    {r.current_customer ? (
                      <Link href={`/bookings/${r.current_booking_id}`} className="hover:underline">{r.current_customer}<div className="text-muted">{r.current_booking_number}</div></Link>
                    ) : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
