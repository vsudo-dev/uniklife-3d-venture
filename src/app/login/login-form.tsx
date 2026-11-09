"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export function LoginForm({ demoAccounts, demoPassword = "Demo@12345", testEnvironment = false }: {
  demoAccounts: { label: string; email: string }[] | null;
  demoPassword?: string;
  testEnvironment?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Sign-in failed");
        return;
      }
      router.replace(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Network error — check your connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <div className="relative">
          <input id="password" type={show ? "text" : "password"} autoComplete="current-password" required className="input pr-10" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted" aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      {error && <p id="login-error" role="alert" className="rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn-holo btn-gold-holo flex min-h-11 w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold disabled:opacity-60">
        {busy && <Loader2 size={16} className="animate-spin" />} Sign in
      </button>
      {demoAccounts && (
        <div className="rounded-xl border border-dashed border-gold bg-gold-soft/40 p-3 text-xs" data-testid="test-accounts">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-bold">{testEnvironment ? "TEST environment accounts" : "Local demo accounts"}</span>
            <span className="rounded bg-surface px-1.5 py-0.5 font-mono font-semibold">{demoPassword}</span>
          </div>
          <p className="mb-2 text-[0.7rem] text-muted">Fictional demo data. Tap an account to fill the form, then Sign in.</p>
          <div className="grid gap-1">
            {demoAccounts.map((a) => (
              <button
                key={a.email}
                type="button"
                className="flex min-h-9 items-center justify-between gap-2 rounded-md bg-surface/70 px-2 py-1.5 text-left hover:bg-surface"
                onClick={() => { setEmail(a.email); setPassword(demoPassword); }}
              >
                <span className="font-semibold">{a.label}</span>
                <span className="truncate text-muted">{a.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
