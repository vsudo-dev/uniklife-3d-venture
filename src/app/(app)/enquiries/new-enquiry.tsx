"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";

/** Staff "New enquiry" form → POST /api/enquiries (assigned to the creator by default). */
export function NewEnquiry({ ventures }: { ventures: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ventureId: ventures[0]?.id ?? "", plotId: "", name: "", phone: "", email: "", message: "" });
  const [plots, setPlots] = useState<{ id: string; plotNumber: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !f.ventureId) return setPlots([]);
    api<{ plots: { id: string; plotNumber: string; status: string }[] }>(`/api/ventures/${f.ventureId}/viewer`).then((r) => setPlots(r.plots)).catch(() => setPlots([]));
  }, [f.ventureId, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/api/enquiries", {
        body: { ventureId: f.ventureId, plotId: f.plotId || null, name: f.name, phone: f.phone, email: f.email || null, message: f.message || null, source: "staff" },
      });
      setOpen(false);
      setF({ ...f, plotId: "", name: "", phone: "", email: "", message: "" });
      router.push(`/enquiries?focus=${r.id}`);
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button variant="gold" onClick={() => setOpen(true)} disabled={ventures.length === 0}><Plus size={16} />New enquiry</Button>;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="ne-title">
      <Card className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="ne-title" className="text-lg font-bold">New enquiry</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ne-v">Venture</label>
            <select id="ne-v" className="input" required value={f.ventureId} onChange={(e) => setF({ ...f, ventureId: e.target.value, plotId: "" })}>
              {ventures.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ne-p">Plot (optional)</label>
            <select id="ne-p" className="input" value={f.plotId} onChange={(e) => setF({ ...f, plotId: e.target.value })}>
              <option value="">Any / not specified</option>
              {plots.map((p) => <option key={p.id} value={p.id}>Plot {p.plotNumber} · {p.status}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ne-n">Contact name</label>
            <input id="ne-n" className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ne-ph">Mobile</label>
            <input id="ne-ph" className="input" required inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ne-e">Email (optional)</label>
            <input id="ne-e" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ne-m">Notes / requirement</label>
            <textarea id="ne-m" className="input" rows={3} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
          </div>
          {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="gold" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />}Save enquiry</Button>
          </div>
          <p className="text-xs text-muted sm:col-span-2">The enquiry is assigned to you; you can reassign it to a member of your team afterwards.</p>
        </form>
      </Card>
    </div>
  );
}
