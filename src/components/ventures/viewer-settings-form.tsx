"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Box, Check, Clapperboard, Eye, Hand, Palette, RotateCcw, Sparkles, SunMedium, Trees } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { BRAND_THEMES, viewerSettingsSchema, type ViewerSettings } from "@/lib/viewer-settings";
import { Button, Card, LinkButton, Notice, cx } from "@/components/ui";

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = viewerSettingsSchema.parse({});

type Opt<T extends string> = { value: T; label: string; desc: string; swatch?: CSSProperties };

const DEFAULT_MODES: Opt<ViewerSettings["defaultMode"]>[] = [
  { value: "aerial", label: "Aerial overview", desc: "Opens on a cinematic bird's-eye view of the whole venture." },
  { value: "intelligence", label: "Live plot intelligence", desc: "Opens on the colour-coded live availability view with prices and status." },
  { value: "top", label: "Top view", desc: "Opens straight down on the layout, like a site plan." },
];

const RENDER_STYLES: Opt<ViewerSettings["renderStyle"]>[] = [
  {
    value: "realistic", label: "Realistic", desc: "Natural ground, roads, trees and lighting.",
    swatch: { background: "linear-gradient(160deg,#9cc6e8 0%,#cfe3f1 40%,#7a9a5a 41%,#5d7d43 100%)" },
  },
  {
    value: "hologram", label: "Hologram", desc: "Futuristic glowing wireframe over a dark stage — great for presentations.",
    swatch: {
      background: "radial-gradient(circle at 50% 70%,rgba(0,229,255,.45),transparent 60%),repeating-linear-gradient(0deg,rgba(0,229,255,.35) 0 1px,transparent 1px 10px),repeating-linear-gradient(90deg,rgba(0,229,255,.35) 0 1px,transparent 1px 10px),#04121f",
    },
  },
];

const SKIES: Opt<ViewerSettings["sky"]>[] = [
  { value: "day", label: "Day", desc: "Bright midday sky.", swatch: { background: "linear-gradient(180deg,#4f9be0,#bfe0fb)" } },
  { value: "golden", label: "Golden hour", desc: "Warm, low sun.", swatch: { background: "linear-gradient(180deg,#f7b267,#fde2a7 60%,#f4d58d)" } },
  { value: "dusk", label: "Dusk", desc: "Purple-orange twilight.", swatch: { background: "linear-gradient(180deg,#3a2f6b,#b55d7a 60%,#f2a65a)" } },
  { value: "night", label: "Night", desc: "Dark sky with street lights.", swatch: { background: "radial-gradient(circle at 75% 25%,#fff 0 2px,transparent 3px),linear-gradient(180deg,#050a1f,#1b2550)" } },
];

const LAND_PATTERNS: Opt<ViewerSettings["landPattern"]>[] = [
  {
    value: "earth", label: "Earth", desc: "Red-brown soil, typical of open plots.",
    swatch: { background: "radial-gradient(circle at 20% 30%,rgba(0,0,0,.15) 0 2px,transparent 3px),radial-gradient(circle at 70% 60%,rgba(255,255,255,.12) 0 2px,transparent 3px),#8b5a3c", backgroundSize: "14px 14px, 18px 18px, auto" },
  },
  {
    value: "sand", label: "Sand", desc: "Light levelled sand / murram.",
    swatch: { background: "radial-gradient(circle at 30% 40%,rgba(120,90,40,.25) 0 1px,transparent 2px),#e3cf9e", backgroundSize: "8px 8px, auto" },
  },
  {
    value: "lawn", label: "Lawn", desc: "Mown grass stripes — a finished, landscaped look.",
    swatch: { background: "repeating-linear-gradient(90deg,#5f9e45 0 10px,#6fb052 10px 20px)" },
  },
  {
    value: "blueprint", label: "Blueprint", desc: "Technical grid, ideal for planning discussions.",
    swatch: { background: "repeating-linear-gradient(0deg,rgba(255,255,255,.35) 0 1px,transparent 1px 8px),repeating-linear-gradient(90deg,rgba(255,255,255,.35) 0 1px,transparent 1px 8px),#1d4f91" },
  },
];

const TAP_ACTIONS: Opt<ViewerSettings["tapAction"]>[] = [
  { value: "details", label: "Show details first", desc: "Tapping a plot opens its details (size, facing, price); the buyer then chooses to add it." },
  { value: "cart", label: "Tap to add to cart", desc: "Tapping an available plot adds it straight to the booking selection. Faster for experienced sales teams." },
];

function Group({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border px-5 py-5 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-soft text-gold-strong" aria-hidden>{icon}</span>
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Choice<T extends string>({ name, legend, options, value, onChange, cols = "sm:grid-cols-3" }: {
  name: string; legend: string; options: Opt<T>[]; value: T; onChange: (v: T) => void; cols?: string;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className={cx("grid gap-2", cols)} role="radiogroup" aria-label={legend}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <label key={o.value} className={cx("flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-3 transition", active ? "border-gold bg-gold-soft/40" : "border-border hover:border-gold/60")}>
              <input type="radio" name={name} value={o.value} className="sr-only" checked={active} onChange={() => onChange(o.value)} />
              {o.swatch && <span className="block h-12 w-full rounded-lg border border-black/10" style={o.swatch} aria-hidden />}
              <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                {o.label}
                {active && <Check size={16} className="text-gold" aria-hidden />}
              </span>
              <span className="text-xs text-muted">{o.desc}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Toggle({ id, label, desc, checked, onChange, disabled }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cx("flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:border-gold", disabled && "cursor-not-allowed opacity-60")}>
      <input id={id} type="checkbox" role="switch" aria-checked={checked} className="mt-0.5 h-4 w-4 accent-[var(--gold)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
    </label>
  );
}

export function ViewerSettingsForm({ ventureId, initial, orgThemeName }: { ventureId: string; initial: ViewerSettings; orgThemeName?: string | null }) {
  const router = useRouter();
  const [s, setS] = useState<ViewerSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);
  const set = <K extends keyof ViewerSettings>(k: K, val: ViewerSettings[K]) => {
    setMsg(null);
    setS((p) => ({ ...p, [k]: val }));
  };
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ settings: ViewerSettings }>(`/api/ventures/${ventureId}/viewer-settings`, { method: "PUT", body: s });
      setS(r.settings);
      setMsg({ ok: true, text: "Viewer & presentation settings saved. Open the 3D view to see them." });
      router.refresh();
    } catch (e) {
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path?: string; message: string }[]).map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)) : undefined;
      setMsg({ ok: false, text: (e as Error).message, details });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="presentation" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-gradient-to-r from-gold-soft/60 to-transparent px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-strong" aria-hidden><Sparkles size={18} /></span>
          <div>
            <h2 className="text-base font-bold">Viewer &amp; presentation</h2>
            <p className="text-sm text-muted">How this venture looks and behaves in the 3D viewer for staff and customers.</p>
          </div>
        </div>
        <LinkButton href={`/ventures/${ventureId}`} variant="outline"><Box size={16} aria-hidden /> Preview in 3D</LinkButton>
      </div>

      <Group icon={<Eye size={16} />} title="Default opening view" subtitle="What viewers see first when they open the venture.">
        <Choice name="defaultMode" legend="Default opening view" options={DEFAULT_MODES} value={s.defaultMode} onChange={(v) => set("defaultMode", v)} />
      </Group>

      <Group icon={<Sparkles size={16} />} title="Render style">
        <Choice name="renderStyle" legend="Render style" options={RENDER_STYLES} value={s.renderStyle} onChange={(v) => set("renderStyle", v)} cols="sm:grid-cols-2" />
      </Group>

      <Group icon={<Clapperboard size={16} />} title="Motion & cinematic tour" subtitle="Animations are skipped automatically for users who prefer reduced motion.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle id="vs-auto" label="Auto zoom transition" desc="Switch automatically between aerial and live plot intelligence as the viewer zooms in and out." checked={s.autoTransition} onChange={(v) => set("autoTransition", v)} />
          <Toggle id="vs-intro" label="Intro animation" desc="A short camera descent into the aerial view when the venture opens." checked={s.introAnimation} onChange={(v) => set("introAnimation", v)} />
          <Toggle id="vs-tour" label="Cinematic tour" desc="Offer a guided fly-through of the venture with a single tap." checked={s.tourEnabled} onChange={(v) => set("tourEnabled", v)} />
          <div className={cx("rounded-xl border border-border p-3", !s.tourEnabled && "opacity-60")}>
            <label htmlFor="vs-speed" className="flex items-center justify-between text-sm font-semibold">
              Tour speed <span className="font-mono text-xs">{s.tourSpeed.toFixed(2)}×</span>
            </label>
            <input id="vs-speed" type="range" min={0.5} max={2} step={0.25} className="mt-2 w-full accent-[var(--gold)]" value={s.tourSpeed} disabled={!s.tourEnabled}
              onChange={(e) => set("tourSpeed", Number(e.target.value))} aria-valuetext={`${s.tourSpeed} times`} />
            <div className="flex justify-between text-[0.65rem] text-muted"><span>0.5× slow</span><span>1×</span><span>2× fast</span></div>
          </div>
        </div>
      </Group>

      <Group icon={<SunMedium size={16} />} title="Sky & lighting" subtitle="Illustrative only — not a representation of actual sun position, weather or views.">
        <Choice name="sky" legend="Sky preset" options={SKIES} value={s.sky} onChange={(v) => set("sky", v)} cols="grid-cols-2 sm:grid-cols-4" />
      </Group>

      <Group icon={<Palette size={16} />} title="Land pattern" subtitle="Surface used for plots in the cinematic view.">
        <Choice name="landPattern" legend="Land pattern" options={LAND_PATTERNS} value={s.landPattern} onChange={(v) => set("landPattern", v)} cols="grid-cols-2 sm:grid-cols-4" />
      </Group>

      <Group icon={<Trees size={16} />} title="Scene details">
        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle id="vs-trees" label="Show trees" desc="Avenue plantation and landscaping (illustrative)." checked={s.showTrees} onChange={(v) => set("showTrees", v)} />
          <Toggle id="vs-lights" label="Show street lights" desc="Light poles along roads; glow at dusk and night." checked={s.showStreetLights} onChange={(v) => set("showStreetLights", v)} />
          <Toggle id="vs-labels" label="Show plot labels" desc="Plot numbers floating over each plot." checked={s.showLabels} onChange={(v) => set("showLabels", v)} />
        </div>
      </Group>

      <Group icon={<Hand size={16} />} title="Tap action" subtitle="What happens when someone taps a plot.">
        <Choice name="tapAction" legend="Tap action" options={TAP_ACTIONS} value={s.tapAction} onChange={(v) => set("tapAction", v)} cols="sm:grid-cols-2" />
      </Group>

      <Group icon={<Palette size={16} />} title="Venture theme" subtitle="Optionally give this venture's pages their own brand colours.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-label="Venture theme override">
          <label className={cx("flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-3 transition", s.themeOverride === null ? "border-gold bg-gold-soft/40" : "border-border hover:border-gold/60")}>
            <input type="radio" name="themeOverride" className="sr-only" checked={s.themeOverride === null} onChange={() => set("themeOverride", null)} />
            <span className="grid h-10 place-items-center rounded-lg border border-dashed border-border text-xs text-muted" aria-hidden>Org theme</span>
            <span className="flex items-center justify-between gap-1 text-sm font-semibold">None{s.themeOverride === null && <Check size={16} className="text-gold" aria-hidden />}</span>
            <span className="text-xs text-muted">Use the organization theme{orgThemeName ? ` (${orgThemeName})` : ""}.</span>
          </label>
          {BRAND_THEMES.map((t) => {
            const active = s.themeOverride === t.id;
            return (
              <label key={t.id} className={cx("flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-3 transition", active ? "border-gold bg-gold-soft/40" : "border-border hover:border-gold/60")}>
                <input type="radio" name="themeOverride" value={t.id} className="sr-only" checked={active} onChange={() => set("themeOverride", t.id)} />
                <span className="flex h-10 overflow-hidden rounded-lg border border-black/10" aria-hidden>
                  <span className="flex-[2]" style={{ background: t.primary }} />
                  <span className="flex-1" style={{ background: t.accent }} />
                </span>
                <span className="flex items-center justify-between gap-1 text-sm font-semibold">{t.name}{active && <Check size={16} className="text-gold" aria-hidden />}</span>
                <span className="font-mono text-[0.65rem] text-muted">{t.primary} · {t.accent}</span>
              </label>
            );
          })}
        </div>
      </Group>

      <div className="space-y-3 border-t border-border bg-surface-2/60 px-5 py-4">
        {msg && (
          <Notice tone={msg.ok ? "success" : "danger"}>
            {msg.text}
            {msg.details && <ul className="mt-1 list-disc pl-5 text-xs">{msg.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { setS(DEFAULT_VIEWER_SETTINGS); setMsg(null); }} title="Fill the form with the default settings (not saved until you click Save)">
            <RotateCcw size={14} aria-hidden /> Restore defaults
          </Button>
          <Button type="button" variant="outline" disabled={!dirty || busy} onClick={() => { setS(initial); setMsg(null); }}>Discard changes</Button>
          <Button type="button" variant="gold" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save presentation settings"}</Button>
        </div>
      </div>
    </Card>
  );
}
