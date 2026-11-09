"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState({ fullName: "", email: "", phone: "", password: "", confirm: "", website: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const pwOk = f.password.length >= 10 && /[A-Za-z]/.test(f.password) && /[0-9]/.test(f.password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pwOk) return setError("Password must be at least 10 characters and contain letters and numbers");
    if (f.password !== f.confirm) return setError("Passwords do not match");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: f.fullName, email: f.email, phone: f.phone, password: f.password, website: f.website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(data?.error?.details) ? data.error.details.map((d: { message?: string }) => d.message).filter(Boolean).join("; ") : "";
        setError(details || data?.error?.message || "Registration failed");
        return;
      }
      router.replace(data.redirectTo ?? "/portal");
      router.refresh();
    } catch {
      setError("Network error — check your connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "signup-error" : undefined}>
      <div>
        <label htmlFor="su-name" className="label">Full name</label>
        <input id="su-name" required autoComplete="name" className="input" value={f.fullName} onChange={set("fullName")} />
      </div>
      <div>
        <label htmlFor="su-email" className="label">Email</label>
        <input id="su-email" type="email" required autoComplete="email" className="input" value={f.email} onChange={set("email")} />
      </div>
      <div>
        <label htmlFor="su-phone" className="label">Mobile number</label>
        <input id="su-phone" type="tel" inputMode="tel" required autoComplete="tel" className="input" placeholder="+91 98xxx xxxxx" value={f.phone} onChange={set("phone")} />
      </div>
      <div>
        <label htmlFor="su-pw" className="label">Password</label>
        <div className="relative">
          <input id="su-pw" type={show ? "text" : "password"} required autoComplete="new-password" className="input pr-10" value={f.password} onChange={set("password")} aria-describedby="su-pw-hint" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted" aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p id="su-pw-hint" className={`mt-1 text-xs ${f.password && !pwOk ? "text-warning" : "text-muted"}`}>At least 10 characters, with letters and numbers.</p>
      </div>
      <div>
        <label htmlFor="su-confirm" className="label">Confirm password</label>
        <input id="su-confirm" type={show ? "text" : "password"} required autoComplete="new-password" className="input" value={f.confirm} onChange={set("confirm")} />
      </div>
      {/* Honeypot: hidden from people, bots tend to fill it */}
      <div className="hidden" aria-hidden>
        <label htmlFor="su-website">Website</label>
        <input id="su-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
      </div>
      {error && <p id="signup-error" role="alert" className="rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#e9cf73] via-[#c9a227] to-[#a8841a] py-2.5 text-sm font-bold text-[#1b1400] shadow-[0_8px_24px_rgba(201,162,39,0.35)] transition hover:brightness-105 disabled:opacity-60">
        {busy && <Loader2 size={16} className="animate-spin" />} Create account
      </button>
      <p className="text-center text-[0.7rem] text-muted">By registering you agree to be contacted by the developer&apos;s sales team about your enquiries and bookings.</p>
    </form>
  );
}
