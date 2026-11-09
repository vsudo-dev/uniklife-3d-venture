"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, CalendarPlus, Eye, Focus, Layers, Maximize2, Minimize2, MessageSquare, Pause, Play, Radio, RotateCcw, Scale, ShoppingCart,
  SkipForward, Sparkles, Square, Tag, X, Plane, Grid2x2, Clapperboard, Wand2, Camera,
} from "lucide-react";
import { FACING_LABEL, inr, num, PLOT_STATUS_COLOR, PLOT_STATUS_LABEL } from "@/lib/format";
import { BrandMark, Button, PlotStatusBadge, cx } from "@/components/ui";
import type { ViewerData, ViewerPlotData } from "./types";
import { ALL_STATUSES, createViewerStore, shallowArray, useViewer, type ViewerStore } from "./store";
import type { RigApi } from "./camera-rig";
import Plan2D from "./plan-2d";
import { parseViewerSettings } from "@/lib/viewer-settings";
import { EnquiryDialog } from "./enquiry-dialog";

const Scene3D = dynamic(() => import("./scene-3d"), {
  ssr: false,
  loading: () => (
    <div className="premium-hero grid h-full place-items-center text-sm text-white/80">
      <div className="text-center"><div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[#c9a227] border-t-transparent" />Preparing aerial view…</div>
    </div>
  ),
});

export interface ViewerBrand {
  appName: string;
  logoUrl: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

function detectQuality(): "high" | "low" {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod/i.test(nav.userAgent);
  if ((nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4) return "low";
  return mobile ? "low" : "high";
}

/** Live status channel: SSE with automatic reconnect, falling back to polling. */
function useLiveStatus(store: ViewerStore, ventureId: string) {
  useEffect(() => {
    let es: EventSource | null = null;
    let poll: number | null = null;
    let failures = 0;
    let offlineTimer: number | null = null;
    let lastMessage = Date.now();
    const snapshot = async () => {
      try {
        const res = await fetch(`/api/live/ventures/${ventureId}`, { cache: "no-store" });
        if (res.ok) store.applyStatuses(((await res.json()) as { plots: { id: string; status: string }[] }).plots);
      } catch {
        /* offline */
      }
    };
    const connect = () => {
      if (typeof EventSource === "undefined") {
        poll = window.setInterval(snapshot, 15000);
        return;
      }
      es = new EventSource(`/api/live/ventures/${ventureId}`);
      es.addEventListener("ready", () => {
        lastMessage = Date.now();
        failures = 0;
        if (offlineTimer) window.clearTimeout(offlineTimer);
        offlineTimer = null;
        store.set({ liveConnected: true });
        snapshot();
      });
      es.addEventListener("status", (e) => {
        lastMessage = Date.now();
        try {
          store.applyStatuses(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed */
        }
      });
      es.addEventListener("ping", () => {
        lastMessage = Date.now();
      });
      es.onerror = () => {
        // Streams end every ~50 s by design and reconnect immediately; only flag a real outage.
        if (!offlineTimer) offlineTimer = window.setTimeout(() => store.set({ liveConnected: false }), 8000);
        failures++;
        if (failures > 5 && es) {
          es.close();
          es = null;
          poll = window.setInterval(snapshot, 15000);
        }
      };
    };
    connect();
    // Safety net: if the stream goes quiet (e.g. a host buffers SSE), fetch snapshots so
    // availability never drifts by more than ~15 s. Stops costing anything once events flow.
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastMessage > 15000) {
        lastMessage = Date.now();
        snapshot().then(() => store.set({ liveConnected: true }));
      }
    }, 5000);
    const onVis = () => document.visibilityState === "visible" && snapshot();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      es?.close();
      if (poll) window.clearInterval(poll);
      window.clearInterval(watchdog);
      if (offlineTimer) window.clearTimeout(offlineTimer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [store, ventureId]);
}

/** Current resolved colour mode of the document (for scoped venture theme overrides). */
function useDocumentMode() {
  const [mode, setMode] = useState("light");
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setMode(el.dataset.mode || "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["data-mode"] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

export function VentureViewer({ initial, bookHref, siteVisitHref, brand }: { initial: ViewerData; bookHref: string; siteVisitHref?: string; brand?: ViewerBrand }) {
  const router = useRouter();
  const settings = useMemo(() => parseViewerSettings(initial.venture.settings ?? {}), [initial.venture.settings]);
  const docMode = useDocumentMode();
  const store = useMemo(
    () => createViewerStore(initial.plots, {
      style: settings.renderStyle, autoTransition: settings.autoTransition, showLabels: settings.showLabels, tapToAdd: settings.tapAction === "cart",
    }),
    [initial.plots, settings],
  );
  const rig = useRef<RigApi | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [render, setRender] = useState<"3d" | "2d" | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [enquiryFor, setEnquiryFor] = useState<string | null | undefined>(undefined);
  const [compareOpen, setCompareOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [checking, setChecking] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useLiveStatus(store, initial.venture.id);

  useEffect(() => {
    const ok = webglAvailable();
    setWebgl(ok);
    const q = detectQuality();
    setQuality(q);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onMq = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onMq);
    setRender(initial.venture.layoutImage?.url ? "2d" : ok ? "3d" : "2d");
    if (!ok) store.set({ mode: "intelligence" });
    return () => mq.removeEventListener("change", onMq);
  }, [store, initial.venture.layoutImage?.url]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const mode = useViewer(store, (s) => s.mode);
  const style = useViewer(store, (s) => s.style);
  const auto = useViewer(store, (s) => s.autoTransition);
  const tour = useViewer(store, (s) => s.tour);
  const selected = useViewer(store, (s) => s.selected, shallowArray);
  const compare = useViewer(store, (s) => s.compare, shallowArray);
  const focusedPlot = useViewer(store, (s) => (s.focused ? s.plots[s.index.get(s.focused)!] : null));
  const visible = useViewer(store, (s) => s.visibleStatuses);
  const plots = useViewer(store, (s) => s.plots);
  const live = useViewer(store, (s) => s.liveConnected);
  const messages = useViewer(store, (s) => s.messages);
  const showLabels = useViewer(store, (s) => s.showLabels);
  const tapToAdd = useViewer(store, (s) => s.tapToAdd);
  const introPlaying = useViewer(store, (s) => s.introPlaying);
  const [savedAerial, setSavedAerial] = useState(settings.customAerial);

  async function saveOpeningView(reset = false) {
    const pose = reset ? null : rig.current?.getPose() ?? null;
    if (!reset && !pose) return;
    const res = await fetch(`/api/ventures/${initial.venture.id}/viewer-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, customAerial: pose }),
    }).catch(() => null);
    if (res?.ok) {
      setSavedAerial(pose);
      store.notify(reset ? "Opening view reset to automatic framing." : "Saved: customers will now open this venture from this view.");
    } else {
      store.notify("Could not save the opening view.", "warning");
    }
  }

  const byId = useMemo(() => new Map(plots.map((p) => [p.id, p])), [plots]);
  // A newly tapped plot always starts with the slim bar on phones.
  useEffect(() => setDrawerOpen(false), [focusedPlot?.id]);
  const selection = selected.map((id) => byId.get(id)).filter(Boolean) as ViewerPlotData[];
  const totals = selection.reduce((s, p) => ({ area: s.area + p.areaSqYards, price: s.price + p.totalPrice }), { area: 0, price: 0 });
  const counts = useMemo(() => Object.fromEntries(ALL_STATUSES.map((s) => [s, plots.filter((p) => p.status === s).length])), [plots]);
  const intelligence = mode === "intelligence" || mode === "top" || render === "2d";

  /** Adds/removes a plot from the cart with clear feedback. */
  const cartToggle = useCallback(
    (id: string) => {
      const before = store.get();
      const plot = before.plots[before.index.get(id) ?? -1];
      if (!plot) return;
      const wasIn = before.selected.includes(id);
      const r = store.toggleSelect(id);
      if (!r.ok) {
        if (r.reason) store.notify(r.reason, "warning");
        return;
      }
      const n = store.get().selected.length;
      store.notify(wasIn ? `Plot ${plot.plotNumber} removed · ${n} in cart` : `Plot ${plot.plotNumber} added to cart · ${n} plot${n === 1 ? "" : "s"} in cart`);
    },
    [store],
  );

  const onPick = useCallback(
    (id: string, additive: boolean) => {
      const s = store.get();
      store.set({ focused: id });
      if (additive || s.tapToAdd) cartToggle(id);
      // Bring the plot into readable focus only when arriving from the aerial view, so
      // building a multi-plot cart never makes the camera jump around.
      if (render === "3d" && s.mode === "aerial") rig.current?.focusPlots([id]);
      // Retrieve current plot data from the server (source of truth).
      fetch(`/api/live/ventures/${initial.venture.id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && store.applyStatuses(d.plots))
        .catch(() => undefined);
    },
    [store, render, initial.venture.id, cartToggle],
  );

  const toggleSelect = cartToggle;

  async function proceed(to: "book" | "visit") {
    setChecking(true);
    try {
      // Revalidate availability with the server before creating any hold.
      const res = await fetch(`/api/live/ventures/${initial.venture.id}`, { cache: "no-store" });
      if (res.ok) store.applyStatuses(((await res.json()) as { plots: { id: string; status: string }[] }).plots);
      const ids = store.get().selected;
      if (to === "book" && ids.length === 0) {
        store.notify("Your selected plots are no longer available. Please choose again.", "warning");
        return;
      }
      if (to === "book" && ids.length !== selected.length) return; // removed plots were announced by the store
      const base = to === "book" ? bookHref : siteVisitHref!;
      router.push(`${base}${base.includes("?") ? "&" : "?"}venture=${initial.venture.id}&plots=${ids.join(",")}`);
    } finally {
      setChecking(false);
    }
  }

  async function toggleFullscreen() {
    const el = wrapper.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (el.requestFullscreen) {
      await el.requestFullscreen().catch(() => setFullscreen((f) => !f));
    } else {
      setFullscreen((f) => !f); // iOS Safari: CSS immersive fallback
    }
  }

  const modeButton = (key: string, label: string, Icon: typeof Plane, active: boolean, onClick: () => void, testid?: string) => (
    <button key={key} onClick={onClick} aria-pressed={active} data-testid={testid} aria-label={label} title={label}
      className={cx("inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-bold transition sm:px-2.5", active ? "bg-gradient-to-br from-[#f3dc8a] to-[#c9a227] text-[#1b1400] shadow" : "text-white/85 hover:bg-white/10")}>
      <Icon size={15} aria-hidden /><span className="hidden sm:inline">{label}</span>
    </button>
  );

  const immersive = fullscreen && !document.fullscreenElement;

  return (
    <div
      className="grid gap-4 lg:grid-cols-[1fr_340px]"
      // Venture-specific brand theme override (re-applies the colour-mode tokens inside this subtree).
      data-brand={settings.themeOverride ?? undefined}
      data-mode={settings.themeOverride ? docMode : undefined}
    >
      <div ref={wrapper} className={cx("card relative overflow-hidden bg-[#0a1430]", (fullscreen || immersive) && "!fixed inset-0 z-[70] rounded-none")} data-testid="viewer-root">
        {/* Top overlay: brand + venture + mode */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 bg-gradient-to-b from-black/55 to-transparent p-3 safe-top">
          <div className="pointer-events-auto min-w-0">
            {brand && <div className="mb-1 hidden text-white sm:block"><BrandMark name={brand.appName} logoUrl={brand.logoUrl} logoWidth={brand.logoWidth} logoHeight={brand.logoHeight} compact /></div>}
            <div className="hidden truncate text-sm font-extrabold text-white drop-shadow sm:block sm:text-base">{initial.venture.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[0.6rem] font-bold uppercase tracking-wider sm:gap-1.5 sm:text-[0.68rem]">
              <span className={cx("rounded-md px-1.5 py-0.5", intelligence ? "bg-[#16a34a]/80 text-white" : "bg-black/50 text-[#f3dc8a]")} data-testid="mode-indicator">
                {mode === "tour" ? "Cinematic tour" : intelligence ? "Live plot intelligence" : "Aerial overview"}
              </span>
              {initial.venture.isDemo && <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[#f3dc8a]" data-testid="demo-label" title="Demonstration layout — not a legally approved venture"><span className="sm:hidden">Demo layout</span><span className="hidden sm:inline">Demonstration layout — not a legally approved venture</span></span>}
              <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5", live ? "bg-black/50 text-emerald-300" : "bg-black/50 text-white/60")} title={live ? "Live availability connected" : "Reconnecting to live availability"}>
                <Radio size={10} />{live ? "Live" : "Sync…"}
              </span>
            </div>
          </div>
          <div className="pointer-events-auto flex shrink-0 gap-1.5">
            <button onClick={toggleFullscreen} className="rounded-lg bg-black/50 p-2 text-white hover:bg-black/70" aria-label={fullscreen ? "Exit full screen" : "Full screen"}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className={cx(fullscreen ? "h-dvh" : "h-[calc(100dvh-170px)] min-h-[400px] sm:h-[62vh] lg:h-[calc(100dvh-220px)]")} data-testid="viewer-canvas">
          {render === "3d" && webgl ? (
            <Scene3D data={initial} store={store} apiRef={rig} reducedMotion={reducedMotion} initialQuality={quality} settings={settings} onPick={onPick} />
          ) : render === "2d" ? (
            <Plan2D data={initial} store={store} onPick={onPick} />
          ) : null}
        </div>

        {/* Skippable opening animation */}
        {render === "3d" && introPlaying && (
          <button
            onClick={() => rig.current?.skipIntro()}
            className="absolute right-3 top-16 z-20 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white backdrop-blur hover:bg-black/80"
            data-testid="skip-intro"
          >
            Skip intro ›
          </button>
        )}

        {/* Aerial CTAs */}
        {render === "3d" && mode === "aerial" && (
          <div className="absolute inset-x-0 bottom-16 z-10 flex justify-center px-2 sm:bottom-24 sm:px-3" data-testid="aerial-ctas">
            <div className="flex justify-center gap-1.5 rounded-2xl border border-[#c9a227]/40 bg-[#0b1f5c]/75 p-1.5 shadow-[0_10px_40px_rgba(201,162,39,0.25)] backdrop-blur sm:flex-wrap sm:gap-2 sm:p-2">
              {settings.tourEnabled && (
                <button onClick={() => rig.current?.startTour()} className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-br from-[#f3dc8a] via-[#c9a227] to-[#a8841a] px-3 py-2 text-xs font-bold text-[#1b1400] sm:gap-2 sm:px-4 sm:text-sm" data-testid="start-tour">
                  <Clapperboard size={16} /><span className="sm:hidden">Cinematic tour</span><span className="hidden sm:inline">Start Cinematic Tour</span>
                </button>
              )}
              <button onClick={() => rig.current?.goTo("top")} className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/25 px-3 py-2 text-xs font-bold text-white hover:bg-white/10 sm:gap-2 sm:px-4 sm:text-sm" data-testid="view-all-plots">
                <Grid2x2 size={16} />View All Plots
              </button>
              <button onClick={() => rig.current?.goTo("intelligence")} className="hidden items-center gap-2 rounded-xl border border-white/25 px-4 py-2 text-sm font-bold text-white hover:bg-white/10 sm:inline-flex">
                <Eye size={16} />Explore Venture
              </button>
            </div>
          </div>
        )}

        {/* Tour controls */}
        {tour.running && (
          <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center px-3" role="region" aria-label="Cinematic tour controls" data-testid="tour-controls">
            <div className="flex items-center gap-2 rounded-2xl border border-[#c9a227]/40 bg-black/70 px-3 py-2 text-white backdrop-blur">
              <div className="min-w-0 pr-1">
                <div className="truncate text-xs font-bold text-[#f3dc8a]">{tour.label}</div>
                <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-[#c9a227] transition-all" style={{ width: `${(tour.step / Math.max(tour.total, 1)) * 100}%` }} /></div>
              </div>
              {tour.paused ? (
                <button onClick={() => rig.current?.resumeTour()} className="rounded-lg p-2 hover:bg-white/10" aria-label="Resume tour"><Play size={16} /></button>
              ) : (
                <button onClick={() => rig.current?.pauseTour()} className="rounded-lg p-2 hover:bg-white/10" aria-label="Pause tour"><Pause size={16} /></button>
              )}
              <button onClick={() => rig.current?.skipStep()} className="rounded-lg p-2 hover:bg-white/10" aria-label="Skip to next stop"><SkipForward size={16} /></button>
              <select value={speed} onChange={(e) => { const v = Number(e.target.value); setSpeed(v); rig.current?.setSpeed(v); }} className="rounded-md bg-white/10 px-1.5 py-1 text-xs" aria-label="Tour speed">
                <option value={0.6} className="text-black">0.6×</option><option value={1} className="text-black">1×</option><option value={1.5} className="text-black">1.5×</option>
              </select>
              <button onClick={() => rig.current?.exitTour()} className="rounded-lg px-2 py-1 text-xs font-bold hover:bg-white/10" data-testid="exit-tour">Exit tour</button>
            </div>
          </div>
        )}

        {/* Bottom toolbar */}
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 safe-bottom">
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-black/45 p-1 backdrop-blur [scrollbar-width:none]" role="toolbar" aria-label="Viewing modes">
            {render === "3d" && (
              <>
                {modeButton("aerial", "Aerial", Plane, mode === "aerial", () => rig.current?.goTo("aerial"), "mode-aerial")}
                {settings.tourEnabled && modeButton("tour", "Tour", Clapperboard, mode === "tour", () => (tour.running ? rig.current?.exitTour() : rig.current?.startTour()), "mode-tour")}
                {modeButton("top", "Top", Grid2x2, mode === "top", () => rig.current?.goTo("top"), "mode-top")}
                {modeButton("intel", "Live plots", Eye, mode === "intelligence", () => rig.current?.goTo("intelligence"), "mode-intel")}
                {modeButton("holo", "Hologram", Wand2, style === "hologram", () => store.set({ style: style === "hologram" ? "realistic" : "hologram" }), "mode-holo")}
                <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
                <button onClick={() => store.set({ autoTransition: !auto })} aria-pressed={auto} className={cx("whitespace-nowrap rounded-lg px-2 py-1.5 text-[0.7rem] font-bold", auto ? "text-emerald-300" : "text-white/60")} title="Switch automatically between aerial and live plot intelligence as you zoom">
                  <Sparkles size={13} className="inline sm:mr-1" /><span className="hidden sm:inline">Auto {auto ? "on" : "off"}</span>
                </button>
                <button onClick={() => rig.current?.reset()} className="rounded-lg p-1.5 text-white/85 hover:bg-white/10" aria-label="Reset camera"><RotateCcw size={15} /></button>
                {selected.length > 0 && <button onClick={() => rig.current?.focusPlots(selected)} className="rounded-lg p-1.5 text-white/85 hover:bg-white/10" aria-label="Focus selected plots"><Focus size={15} /></button>}
                {initial.canEditPresentation && (
                  <>
                    <button onClick={() => saveOpeningView()} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-[0.7rem] font-bold text-[#f3dc8a] hover:bg-white/10" title="Save the current camera as this venture's opening view" data-testid="save-view">
                      <Camera size={13} className="mr-1 inline" />Save view
                    </button>
                    {savedAerial && (
                      <button onClick={() => saveOpeningView(true)} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-[0.7rem] font-bold text-white/60 hover:bg-white/10" title="Use automatic framing again">
                        Auto view
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {initial.canBook && (
              <button
                onClick={() => { const next = !tapToAdd; store.set({ tapToAdd: next }); store.notify(next ? "Tap-to-add on: tap available plots to add them to your cart." : "Tap-to-add off: tap a plot to see its details."); }}
                aria-pressed={tapToAdd}
                className={cx("whitespace-nowrap rounded-lg px-2 py-1.5 text-[0.7rem] font-bold", tapToAdd ? "bg-emerald-500/25 text-emerald-200" : "text-white/70")}
                data-testid="tap-to-add"
                title="Tap plots to add them straight to the cart"
              >
                <ShoppingCart size={13} className="mr-1 inline" />{tapToAdd ? "Tap-add on" : "Tap-add"}
              </button>
            )}
            <button onClick={() => store.set({ showLabels: !showLabels })} className="rounded-lg p-1.5 text-white/85 hover:bg-white/10" aria-pressed={showLabels} aria-label="Toggle plot labels"><Layers size={15} /></button>
            <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
            <button onClick={() => setRender("3d")} disabled={!webgl} aria-pressed={render === "3d"} className={cx("rounded-lg px-2 py-1.5 text-[0.7rem] font-bold", render === "3d" ? "text-[#f3dc8a]" : "text-white/70 disabled:opacity-40")}><Box size={13} className="mr-1 inline" />3D</button>
            <button onClick={() => setRender("2d")} aria-pressed={render === "2d"} className={cx("rounded-lg px-2 py-1.5 text-[0.7rem] font-bold", render === "2d" ? "text-[#f3dc8a]" : "text-white/70")} data-testid="mode-2d"><Square size={13} className="mr-1 inline" />2D</button>
          </div>
        </div>

        {/* Live messages */}
        <div className="pointer-events-none absolute left-1/2 top-20 z-20 w-[min(92%,420px)] -translate-x-1/2 space-y-2" aria-live="polite" role="status">
          {messages.map((m) => (
            <div key={m.id} className={cx("rounded-xl px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur", m.tone === "warning" ? "bg-amber-500/90 text-black" : "bg-[#0b1f5c]/90 text-white")}>{m.text}</div>
          ))}
        </div>

        {/* Mobile plot bar: slim by default so the layout stays tappable for multi-plot selection. */}
        {focusedPlot && (
          <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 lg:hidden" data-testid="plot-drawer">
            <div className="pointer-events-auto mx-2 rounded-2xl border border-border bg-surface/95 p-2.5 shadow-2xl backdrop-blur">
              {drawerOpen ? (
                <>
                  <PlotDetails plot={focusedPlot} store={store} canBook={initial.canBook} selected={selected.includes(focusedPlot.id)} compared={compare.includes(focusedPlot.id)}
                    onToggle={() => { toggleSelect(focusedPlot.id); setDrawerOpen(false); }} onEnquire={() => setEnquiryFor(focusedPlot.id)} compact />
                  <button onClick={() => setDrawerOpen(false)} className="mt-2 w-full text-center text-xs font-semibold text-muted">Show less</button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: PLOT_STATUS_COLOR[focusedPlot.status] }} aria-hidden />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setDrawerOpen(true)} aria-label={`Show details for plot ${focusedPlot.plotNumber}`}>
                    <div className="truncate text-sm font-extrabold">Plot {focusedPlot.plotNumber} · {PLOT_STATUS_LABEL[focusedPlot.status]}</div>
                    <div className="truncate text-[0.7rem] text-muted">{num(focusedPlot.areaSqYards)} sq yd · {inr(focusedPlot.totalPrice, { compact: true })} · tap for details</div>
                  </button>
                  {initial.canBook && focusedPlot.status === "available" && (
                    <Button
                      variant={selected.includes(focusedPlot.id) ? "outline" : "gold"}
                      className="shrink-0 px-3 py-1.5 text-xs"
                      onClick={() => toggleSelect(focusedPlot.id)}
                      data-testid="toggle-select"
                    >
                      <ShoppingCart size={14} />{selected.includes(focusedPlot.id) ? "In cart ✓" : "Add to cart"}
                    </Button>
                  )}
                  <button onClick={() => store.set({ focused: null })} aria-label="Close plot bar" className="shrink-0 p-1 text-muted"><X size={16} /></button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Side panel (desktop) */}
      <aside className="space-y-4">
        <div className="card hidden p-4 lg:block" data-testid="plot-panel">
          {focusedPlot ? (
            <PlotDetails plot={focusedPlot} store={store} canBook={initial.canBook} selected={selected.includes(focusedPlot.id)} compared={compare.includes(focusedPlot.id)}
              onToggle={() => toggleSelect(focusedPlot.id)} onEnquire={() => setEnquiryFor(focusedPlot.id)} />
          ) : (
            <div className="py-6 text-center text-sm text-muted">
              Zoom in or tap a plot to see live details.<br />
              <span className="text-xs">Desktop: Shift/Ctrl-click to select several plots.</span>
            </div>
          )}
        </div>

        {/* Accessible legend & filters */}
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">Availability</h3>
            <button onClick={() => store.set({ visibleStatuses: new Set(["available"]) })} className="text-xs font-semibold text-primary">Only available</button>
          </div>
          <ul className="grid grid-cols-2 gap-1.5" aria-label="Plot status legend and filters">
            {ALL_STATUSES.map((s) => (
              <li key={s}>
                <button
                  onClick={() => store.set((st) => { const n = new Set(st.visibleStatuses); if (n.has(s)) n.delete(s); else n.add(s); return { visibleStatuses: n.size ? n : new Set(ALL_STATUSES) }; })}
                  aria-pressed={visible.has(s)}
                  className={cx("flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs font-semibold", visible.has(s) ? "border-border bg-surface" : "border-transparent bg-surface-2 opacity-50")}
                >
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: PLOT_STATUS_COLOR[s] }} aria-hidden />{PLOT_STATUS_LABEL[s]}</span>
                  <span className="tabular-nums text-muted">{counts[s]}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.68rem] text-muted">Non-available plots also carry a text label (HELD, RSVD, BOOKED, SOLD, BLOCKED) in the 3D and 2D views.</p>
        </div>

        {initial.venture.amenities.length > 0 && (
          <div className="card p-4 text-sm">
            <h3 className="mb-2 font-bold">Amenities</h3>
            <ul className="flex flex-wrap gap-1.5">{initial.venture.amenities.map((a) => <li key={a} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">{a}</li>)}</ul>
          </div>
        )}
      </aside>

      {/* Floating selection summary */}
      {(selection.length > 0 || compare.length > 0) && (
        <div className="fixed inset-x-0 bottom-16 z-[75] flex justify-center px-3 lg:bottom-6" data-testid="selection-panel">
          <div className="flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-2xl border border-[#c9a227]/50 bg-surface/95 p-3 shadow-[var(--glow)] backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                <ShoppingCart size={13} className="text-gold-strong" />Cart · {selection.length} plot{selection.length === 1 ? "" : "s"}
              </div>
              <div className="flex flex-wrap gap-1">
                {selection.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">
                    {p.plotNumber}<button onClick={() => toggleSelect(p.id)} aria-label={`Remove plot ${p.plotNumber}`}><X size={11} /></button>
                  </span>
                ))}
              </div>
            </div>
            {selection.length > 0 && (
              <div className="text-right text-xs">
                <div><span className="text-muted">Area </span><strong>{num(totals.area)} sq yd</strong></div>
                <div><span className="text-muted">Base </span><strong className="text-sm">{inr(totals.price, { compact: true })}</strong></div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {compare.length > 0 && <Button variant="outline" onClick={() => setCompareOpen(true)} data-testid="open-compare"><Scale size={15} />Compare ({compare.length})</Button>}
              {siteVisitHref && selection.length > 0 && <Button variant="outline" onClick={() => proceed("visit")} disabled={checking}><CalendarPlus size={15} />Site visit</Button>}
              {initial.canBook && selection.length > 0 && (
                <Button variant="gold" onClick={() => proceed("book")} disabled={checking} data-testid="proceed-booking"><ShoppingCart size={15} />{checking ? "Checking…" : "Proceed to booking"}</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {compareOpen && <CompareDrawer plots={compare.map((id) => byId.get(id)!).filter(Boolean)} onClose={() => setCompareOpen(false)} onRemove={(id) => store.toggleCompare(id)} />}
      {enquiryFor !== undefined && (
        <EnquiryDialog ventureId={initial.venture.id} plotId={enquiryFor} plotNumber={enquiryFor ? byId.get(enquiryFor)?.plotNumber ?? null : null} onClose={() => setEnquiryFor(undefined)} />
      )}
    </div>
  );
}

function PlotDetails({ plot, store, canBook, selected, compared, onToggle, onEnquire, compact }: {
  plot: ViewerPlotData; store: ViewerStore; canBook: boolean; selected: boolean; compared: boolean;
  onToggle: () => void; onEnquire: () => void; compact?: boolean;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[0.68rem] font-bold uppercase tracking-wider text-muted">{plot.phase ? `Block ${plot.phase}` : "Plot"}{plot.isCorner ? " · Corner" : ""}</div>
          <h3 className={cx("font-extrabold", compact ? "text-lg" : "text-2xl")}>Plot {plot.plotNumber}</h3>
        </div>
        <div className="flex items-center gap-1">
          <PlotStatusBadge status={plot.status} />
          {plot.isMortgaged && <span className="text-xs text-warning">Mortgage blocked{plot.mortgageReference ? ` · ${plot.mortgageReference}` : ""}</span>}
          {compact && <button onClick={() => store.set({ focused: null })} aria-label="Close details" className="p-1 text-muted"><X size={16} /></button>}
        </div>
      </div>
      <dl className={cx("mt-2 grid gap-x-3 gap-y-1.5 text-sm", compact ? "grid-cols-3" : "grid-cols-2")}>
        <div><dt className="text-[0.68rem] text-muted">Area</dt><dd className="font-semibold">{num(plot.areaSqYards)} sq yd</dd></div>
        <div><dt className="text-[0.68rem] text-muted">Dimensions</dt><dd className="font-semibold">{plot.dimensions ?? "—"}</dd></div>
        <div><dt className="text-[0.68rem] text-muted">Facing</dt><dd className="font-semibold">{plot.facing ? FACING_LABEL[plot.facing] : "—"}</dd></div>
        <div><dt className="text-[0.68rem] text-muted">Road width</dt><dd className="font-semibold">{plot.roadWidthFt ? `${plot.roadWidthFt} ft` : "—"}</dd></div>
        <div><dt className="text-[0.68rem] text-muted">Price / sq yd</dt><dd className="font-semibold">{inr(plot.pricePerSqYard)}</dd></div>
        <div><dt className="text-[0.68rem] text-muted">Base price</dt><dd className="font-bold text-primary">{inr(plot.totalPrice)}</dd></div>
      </dl>
      {!compact && <p className="mt-2 text-[0.68rem] text-muted">Base price before discounts. The final amount is calculated and verified by the server at booking. Booking eligibility: {plot.status === "available" ? "available to book" : `not bookable (${PLOT_STATUS_LABEL[plot.status]?.toLowerCase()})`}.</p>}
      <div className={cx("mt-3 grid gap-2", compact && "grid-cols-3")}>
        {canBook && plot.status === "available" && (
          <Button onClick={onToggle} variant={selected ? "outline" : "gold"} data-testid="toggle-select" className={compact ? "px-2 text-xs" : ""}>
            <ShoppingCart size={15} />{selected ? (compact ? "In cart ✓" : "In cart ✓ — remove") : "Add to cart"}
          </Button>
        )}
        <Button variant="outline" onClick={() => store.toggleCompare(plot.id)} className={compact ? "px-2 text-xs" : ""} data-testid="toggle-compare">
          <Scale size={15} />{compared ? "Uncompare" : "Compare"}
        </Button>
        <Button variant="outline" onClick={onEnquire} className={compact ? "px-2 text-xs" : ""}><MessageSquare size={15} />{compact ? "Enquire" : "Enquire about this plot"}</Button>
      </div>
      {plot.isCorner && !compact && <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold-strong"><Tag size={12} />Corner plot</div>}
    </div>
  );
}

function CompareDrawer({ plots, onClose, onRemove }: { plots: ViewerPlotData[]; onClose: () => void; onRemove: (id: string) => void }) {
  const rows: [string, (p: ViewerPlotData) => React.ReactNode][] = [
    ["Status", (p) => <PlotStatusBadge status={p.status} />],
    ["Block", (p) => p.phase ?? "—"],
    ["Area", (p) => `${num(p.areaSqYards)} sq yd`],
    ["Dimensions", (p) => p.dimensions ?? "—"],
    ["Facing", (p) => (p.facing ? FACING_LABEL[p.facing] : "—")],
    ["Road width", (p) => (p.roadWidthFt ? `${p.roadWidthFt} ft` : "—")],
    ["Corner", (p) => (p.isCorner ? "Yes" : "No")],
    ["Price / sq yd", (p) => inr(p.pricePerSqYard)],
    ["Base price", (p) => <strong>{inr(p.totalPrice)}</strong>],
  ];
  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-black/50 sm:place-items-center" role="dialog" aria-modal="true" aria-label="Compare plots">
      <div className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:max-w-2xl sm:rounded-2xl safe-bottom" data-testid="compare-drawer">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold">Compare plots</h2><button onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        {plots.length === 0 ? <p className="text-sm text-muted">Add plots to compare from the plot details panel.</p> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th />{plots.map((p) => <th key={p.id}>Plot {p.plotNumber} <button onClick={() => onRemove(p.id)} aria-label={`Remove plot ${p.plotNumber} from comparison`} className="ml-1 align-middle"><X size={12} /></button></th>)}</tr></thead>
              <tbody>{rows.map(([label, f]) => <tr key={label}><td className="font-semibold text-muted">{label}</td>{plots.map((p) => <td key={p.id}>{f(p)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
