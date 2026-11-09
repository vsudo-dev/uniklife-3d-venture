"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, ImageUp, Monitor, Moon, MoonStar, Star, Sun, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { BRAND_THEMES, COLOR_MODES, type BrandThemeId, type ColorMode } from "@/lib/viewer-settings";
import { Badge, Button, Card, CardHeader, Field, Notice, cx } from "@/components/ui";
import { MessageLine, useAction, type Msg } from "./use-action";

type Theme = BrandThemeId;

export interface BrandingValues {
  organizationId: string;
  companyName: string;
  appName: string;
  shortName: string;
  theme: Theme;
  defaultColorMode?: ColorMode;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  logoMime: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  brandingVersion: number;
}

const COLOR_MODE_INFO: Record<ColorMode, { label: string; desc: string; Icon: typeof Sun }> = {
  system: { label: "System (follow device)", desc: "Light or dark automatically, matching each user's phone or computer setting.", Icon: Monitor },
  light: { label: "Light", desc: "Bright backgrounds — best in offices and outdoors.", Icon: Sun },
  dark: { label: "Dark", desc: "Dark backgrounds that make the 3D venture and gold accents stand out.", Icon: Moon },
  night: { label: "Night", desc: "Extra-dim, low-glare palette for late-evening use and presentations in dark rooms.", Icon: MoonStar },
};

type PreviewMode = "light" | "dark" | "night";
const PREVIEW_PALETTE: Record<PreviewMode, { bg: string; surface: string; border: string; text: string; muted: string; header: string }> = {
  light: { bg: "#f4f6fb", surface: "#ffffff", border: "#e3e7f0", text: "#111827", muted: "#6b7280", header: "" },
  dark: { bg: "#0b1020", surface: "#151b30", border: "#252d48", text: "#e8ebf5", muted: "#9aa3bd", header: "#10162a" },
  night: { bg: "#030409", surface: "#0b0d16", border: "#171a28", text: "#c9ccd8", muted: "#7a7f93", header: "#07080f" },
};

/** Tiny app mock-up for a theme, built entirely with inline styles (independent of the active page theme). */
function ThemeMini({ primary, accent, mode, label }: { primary: string; accent: string; mode: PreviewMode; label: string }) {
  const p = PREVIEW_PALETTE[mode];
  const header: CSSProperties = mode === "light" ? { background: primary, color: "#fff" } : { background: p.header, color: p.text, borderBottom: `2px solid ${accent}` };
  return (
    <div aria-hidden className="overflow-hidden rounded-lg" style={{ background: p.bg, border: `1px solid ${p.border}` }} title={label}>
      <div className="flex items-center gap-1 px-1.5 py-1" style={header}>
        <span className="h-2 w-2 rounded-sm" style={{ background: accent }} />
        <span className="h-1 w-8 rounded-full" style={{ background: mode === "light" ? "rgba(255,255,255,.8)" : p.text, opacity: 0.8 }} />
      </div>
      <div className="space-y-1 p-1.5">
        <div className="rounded p-1" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
          <span className="block h-1 w-6 rounded-full" style={{ background: accent }} />
          <span className="mt-0.5 block h-1 w-10 rounded-full" style={{ background: p.text, opacity: 0.85 }} />
          <span className="mt-0.5 block h-1 w-7 rounded-full" style={{ background: p.muted, opacity: 0.7 }} />
        </div>
        <div className="flex gap-1">
          <span className="h-2 flex-1 rounded-sm" style={{ background: primary, filter: mode === "light" ? undefined : "brightness(1.35)" }} />
          <span className="h-2 flex-1 rounded-sm" style={{ background: accent }} />
        </div>
      </div>
      <div className="px-1.5 pb-1 text-[0.55rem] font-semibold uppercase tracking-wide" style={{ color: p.muted }}>{mode}</div>
    </div>
  );
}

export function BrandingForm({ initial }: { initial: BrandingValues; themes?: unknown }) {
  const [f, setF] = useState({
    companyName: initial.companyName, appName: initial.appName, shortName: initial.shortName, theme: initial.theme,
    defaultColorMode: (initial.defaultColorMode ?? "system") as ColorMode,
    website: initial.website ?? "", contactEmail: initial.contactEmail ?? "", contactPhone: initial.contactPhone ?? "",
  });
  const { busy, msg, run } = useAction();
  const shortLen = [...f.shortName].length;
  const selected = BRAND_THEMES.find((t) => t.id === f.theme) ?? BRAND_THEMES[0];
  const previewMode: PreviewMode = f.defaultColorMode === "system" ? "light" : f.defaultColorMode;
  const pal = PREVIEW_PALETTE[previewMode];

  return (
    <Card>
      <CardHeader title="Company branding" subtitle="Used for this organization's app name, home-screen label, theme, colour mode and contact details." />
      <form
        className="grid gap-6 p-5 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save", () => api<{ brandingVersion: number }>("/api/branding", { method: "PUT", body: { ...f, website: f.website || null, contactEmail: f.contactEmail || null, contactPhone: f.contactPhone || null } }), (r) => `Branding saved (version ${r.brandingVersion})`);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-3">
          <Field label="Company name" htmlFor="br-company"><input id="br-company" className="input" required minLength={2} maxLength={160} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} /></Field>
          <Field label="Application name" htmlFor="br-app" hint="Shown in the install prompt and app switcher."><input id="br-app" className="input" required minLength={2} maxLength={60} value={f.appName} onChange={(e) => setF({ ...f, appName: e.target.value })} /></Field>
          <Field label="Short name" htmlFor="br-short" hint={`Home-screen label · ${shortLen}/12`} error={shortLen > 12 ? "Short name must be 12 characters or fewer" : null}>
            <input id="br-short" className="input" required value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} />
          </Field>
          <Field label="Website" htmlFor="br-web"><input id="br-web" type="url" className="input" placeholder="https://" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
          <Field label="Contact email" htmlFor="br-email"><input id="br-email" type="email" className="input" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
          <Field label="Contact phone" htmlFor="br-phone"><input id="br-phone" className="input" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Default colour mode for users" htmlFor="br-mode" hint={`${COLOR_MODE_INFO[f.defaultColorMode].desc} Users can still pick their own mode; this applies to anyone who has not.`}>
              <select id="br-mode" className="input" value={f.defaultColorMode} onChange={(e) => setF({ ...f, defaultColorMode: e.target.value as ColorMode })}>
                {COLOR_MODES.map((m) => <option key={m} value={m}>{COLOR_MODE_INFO[m].label}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="label">Live preview · {selected.name} · {COLOR_MODE_INFO[f.defaultColorMode].label}</div>
          <div className="overflow-hidden rounded-2xl" style={{ background: pal.bg, color: pal.text, border: `1px solid ${pal.border}` }}>
            <div className="flex items-center gap-2 px-4 py-3" style={previewMode === "light" ? { background: selected.primary, color: "#fff" } : { background: pal.header, color: pal.text, borderBottom: `2px solid ${selected.accent}` }}>
              {initial.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- logo shown exactly as uploaded
                <img src={initial.logoUrl} alt="" style={{ height: 24, width: "auto", maxWidth: 120, objectFit: "contain" }} />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-extrabold" style={{ background: selected.accent, color: "#1b1400" }}>{(f.shortName || f.appName || "U").slice(0, 1).toUpperCase()}</span>
              )}
              <span className="truncate text-sm font-bold">{f.appName || "Application name"}</span>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-xl p-3" style={{ background: pal.surface, border: `1px solid ${pal.border}` }}>
                <div className="text-[0.65rem] font-bold uppercase tracking-widest" style={{ color: selected.accent }}>{f.companyName || "Company"}</div>
                <div className="text-base font-extrabold">Sunrise Meadows</div>
                <div className="text-xs" style={{ color: pal.muted }}>142 plots · 38 available</div>
              </div>
              <div className="flex gap-2">
                <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: selected.primary, filter: previewMode === "light" ? undefined : "brightness(1.35)" }}>Book plot</span>
                <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#1b1400]" style={{ background: selected.accent }}>Open 3D</span>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs" style={{ color: pal.muted }}>
                <span className="grid h-9 w-9 place-items-center rounded-xl text-[0.6rem] font-bold" style={{ background: selected.primary, color: selected.accent }}>{(f.shortName || "U").slice(0, 1).toUpperCase()}</span>
                Home screen: <strong style={{ color: pal.text }}>{f.shortName || "Short name"}</strong>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Preview is approximate. The theme applies across the app after saving and reloading.</p>
        </div>
        <fieldset className="lg:col-span-5">
          <legend className="label">Brand theme · {BRAND_THEMES.length} options</legend>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Brand theme">
            {BRAND_THEMES.map((t) => {
              const active = f.theme === t.id;
              return (
                <label key={t.id} className={cx("cursor-pointer rounded-xl border-2 p-3 transition", active ? "border-gold shadow-[var(--glow)]" : "border-border hover:border-gold/60")}>
                  <input type="radio" name="theme" value={t.id} className="sr-only" checked={active} onChange={() => setF({ ...f, theme: t.id })} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{t.name}</span>
                    {active && <Check size={16} className="shrink-0 text-gold" aria-hidden />}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[0.65rem] text-muted">
                    <span className="inline-flex items-center gap-1"><span className="h-4 w-4 rounded border border-black/10" style={{ background: t.primary }} aria-hidden /> {t.primary}</span>
                    <span className="inline-flex items-center gap-1"><span className="h-4 w-4 rounded border border-black/10" style={{ background: t.accent }} aria-hidden /> {t.accent}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <ThemeMini primary={t.primary} accent={t.accent} mode="light" label={`${t.name} light`} />
                    <ThemeMini primary={t.primary} accent={t.accent} mode="dark" label={`${t.name} dark`} />
                  </div>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 lg:col-span-5">
          <Button type="submit" variant="gold" disabled={!!busy || shortLen > 12 || shortLen === 0}>{busy ? "Saving…" : "Save branding"}</Button>
          <MessageLine msg={msg} />
        </div>
      </form>
    </Card>
  );
}

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

export function LogoUpload({ logoUrl, logoMime, logoWidth, logoHeight, version }: { logoUrl: string | null; logoMime: string | null; logoWidth: number | null; logoHeight: number | null; version: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    if (!ACCEPT.includes(file.type)) return setMsg({ tone: "err", text: "Logo must be a PNG, JPEG or WebP image (SVG and GIF are not accepted)." });
    if (file.size > 5 * 1024 * 1024) return setMsg({ tone: "err", text: "Logo must be 5 MB or smaller." });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/branding/logo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Upload failed (${res.status})`);
      setMsg({ tone: "ok", text: `Logo uploaded (${data.width}×${data.height}). Stored exactly as uploaded; icons regenerate automatically.` });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader title="Logo & app icons" subtitle="PNG, JPEG or WebP · at least 64×64 px · up to 5 MB. Your file is never altered; icons are generated from it with its proportions preserved." />
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div>
          <div className="label">Current logo</div>
          <div className="grid min-h-[120px] place-items-center rounded-xl border border-dashed border-border bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface)_0%_50%)] bg-[length:16px_16px] p-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- original file, natural proportions
              <img src={logoUrl} alt="Organization logo" style={{ maxHeight: 96, maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain" }} />
            ) : (
              <span className="text-sm text-muted">No logo uploaded — a text brand mark is used.</span>
            )}
          </div>
          {logoUrl && <p className="mt-1 text-xs text-muted">{logoMime} · {logoWidth}×{logoHeight}px · branding version {version}</p>}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="logo-file" onChange={(e) => upload(e.target.files?.[0])} />
          <Button variant="outline" className="mt-3" disabled={busy} onClick={() => input.current?.click()}>
            <ImageUp size={16} aria-hidden /> {busy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          <div className="mt-2"><MessageLine msg={msg} /></div>
        </div>
        <div>
          <div className="label">Generated PWA icons</div>
          <div className="flex flex-wrap items-end gap-4">
            <figure className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/pwa/icon/192?v=${version}`} alt="192px app icon preview" width={96} height={96} className="rounded-2xl border border-border shadow" />
              <figcaption className="mt-1 text-xs text-muted">192 px</figcaption>
            </figure>
            <figure className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/pwa/icon/512?maskable=1&v=${version}`} alt="Maskable 512px app icon preview" width={96} height={96} className="rounded-full border border-border shadow" />
              <figcaption className="mt-1 text-xs text-muted">512 px maskable</figcaption>
            </figure>
          </div>
          <p className="mt-3 text-xs text-muted">
            Icon previews render for the organization bound to the domain you are browsing (the host&apos;s tenant). On the platform domain you will see the platform icon; open this page on your own verified domain to preview your icons.
          </p>
        </div>
      </div>
    </Card>
  );
}

export interface DomainItem { id: string; domain: string; is_primary: boolean; verified: boolean }

export function DomainManager({ domains }: { domains: DomainItem[] }) {
  const [domain, setDomain] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const { busy, msg, run } = useAction();

  return (
    <Card>
      <CardHeader title="Domains" subtitle="White-label domains and subdomains for this organization." />
      <div className="space-y-4 p-5">
        <Notice tone="info" title="One domain per white-label app">
          Each white-label PWA needs its own domain or subdomain so that phones treat it as a distinct installable app (the install identity is tied to the origin). Point the domain&apos;s DNS (CNAME/A record) at this platform, then confirm below.
          Already-installed home-screen icons may not update after a branding change until the platform refreshes the app or it is reinstalled.
        </Notice>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run("add", () => api("/api/branding/domains", { body: { domain } }), "Domain added — configure DNS, then confirm it");
            if (r) setDomain("");
          }}
        >
          <label htmlFor="dom-new" className="sr-only">Domain or subdomain</label>
          <input id="dom-new" className="input max-w-sm flex-1" placeholder="app.yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!!busy || domain.trim().length < 3}><Globe size={16} aria-hidden /> Add domain</Button>
        </form>
        <MessageLine msg={msg} />
        {domains.length === 0 ? (
          <p className="text-sm text-muted">No domains yet. Users can still sign in on the platform domain.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {domains.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{d.domain}</span>
                    {d.is_primary && <Badge tone="gold"><Star size={11} aria-hidden /> primary</Badge>}
                    {d.verified ? <Badge tone="success">DNS confirmed</Badge> : <Badge tone="warning">awaiting DNS</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!d.is_primary && (
                      <button className="rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:border-gold disabled:opacity-50" disabled={!!busy}
                        onClick={() => run("primary", () => api(`/api/branding/domains/${d.id}`, { method: "PATCH", body: { action: "set_primary" } }), `${d.domain} is now primary`)}>
                        Set primary
                      </button>
                    )}
                    {!d.verified ? (
                      <button className="rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:border-gold" onClick={() => { setConfirming(confirming === d.id ? null : d.id); setAck(false); }}>
                        I have configured DNS…
                      </button>
                    ) : (
                      <button className="rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:border-gold disabled:opacity-50" disabled={!!busy}
                        onClick={() => run("unverify", () => api(`/api/branding/domains/${d.id}`, { method: "PATCH", body: { action: "unverify" } }), `${d.domain} marked unconfirmed`)}>
                        Mark unconfirmed
                      </button>
                    )}
                    <button className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-danger hover:border-danger disabled:opacity-50" disabled={!!busy}
                      onClick={() => { if (window.confirm(`Remove ${d.domain}? Users on that domain will no longer reach this organization.`)) void run("remove", () => api(`/api/branding/domains/${d.id}`, { method: "DELETE" }), `${d.domain} removed`); }}>
                      <Trash2 size={12} aria-hidden /> Remove
                    </button>
                  </div>
                </div>
                {confirming === d.id && !d.verified && (
                  <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface-2 p-3 text-sm">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--gold)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                      <span>I confirm that DNS for <strong>{d.domain}</strong> points to this platform and that this organization controls the domain. The platform does not check DNS automatically.</span>
                    </label>
                    <Button variant="gold" disabled={!ack || !!busy}
                      onClick={async () => { const r = await run("confirm", () => api(`/api/branding/domains/${d.id}`, { method: "PATCH", body: { action: "confirm_dns", confirmed: true } }), `${d.domain} confirmed`); if (r) setConfirming(null); }}>
                      Confirm domain
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
