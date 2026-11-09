"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";

export function EnquiryDialog({ ventureId, plotId, plotNumber, onClose }: { ventureId: string; plotId: string | null; plotNumber: string | null; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: plotNumber ? `I am interested in Plot ${plotNumber}.` : "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ventureId, plotId, source: "3d_viewer", ...form, website: "" }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Network error");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data?.error?.message ?? "Could not submit enquiry");
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Enquiry">
      <div className="w-full rounded-t-2xl bg-surface p-5 shadow-2xl sm:max-w-md sm:rounded-2xl safe-bottom">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{plotNumber ? `Enquire about Plot ${plotNumber}` : "Send an enquiry"}</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {done ? (
          <div className="py-6 text-center">
            <div className="text-base font-bold">Thank you!</div>
            <p className="mt-1 text-sm text-muted">Our sales team will contact you shortly.</p>
            <Button className="mt-4" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div><label className="label" htmlFor="enq-name">Name</label><input id="enq-name" className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label" htmlFor="enq-phone">Mobile</label><input id="enq-phone" className="input" required inputMode="tel" pattern="^\+?[0-9 \-]{7,20}$" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label className="label" htmlFor="enq-email">Email (optional)</label><input id="enq-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label" htmlFor="enq-msg">Message</label><textarea id="enq-msg" className="input" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Sending…" : "Submit enquiry"}</Button>
            <p className="text-[0.7rem] text-muted">Your details are used only to respond to this enquiry.</p>
          </form>
        )}
      </div>
    </div>
  );
}
