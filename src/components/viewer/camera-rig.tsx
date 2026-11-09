"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import {
  buildTour, computePresets, damp, focusPose, IntelligenceGate, polygonExtent, projectedPixels,
  type Bounds2D, type CameraPose, type FeatureLike, type Presets,
} from "./camera-math";
import type { SceneFx } from "./plot-layer";
import type { ViewMode, ViewerStore } from "./store";

export interface RigApi {
  goTo: (mode: "aerial" | "top" | "intelligence" | "angled") => void;
  focusPlots: (ids: string[]) => void;
  startTour: () => void;
  pauseTour: () => void;
  resumeTour: () => void;
  skipStep: () => void;
  exitTour: () => void;
  reset: () => void;
  setSpeed: (s: number) => void;
  skipIntro: () => void;
  /** Current camera pose (used to save a venture's custom opening view). */
  getPose: () => CameraPose | null;
}

const FOV = 45;

export function CameraRig({ store, bounds, features, fx, reducedMotion, apiRef, playIntro, initialMode = "aerial", initialSpeed = 1, customAerial = null }: {
  store: ViewerStore;
  bounds: Bounds2D;
  features: FeatureLike[];
  fx: React.MutableRefObject<SceneFx>;
  reducedMotion: boolean;
  apiRef: React.MutableRefObject<RigApi | null>;
  playIntro: boolean;
  initialMode?: "aerial" | "intelligence" | "top";
  initialSpeed?: number;
  /** Venture-specific saved opening view; replaces the computed aerial framing. */
  customAerial?: CameraPose | null;
}) {
  const controls = useRef<CameraControls>(null);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const gate = useRef(new IntelligenceGate());
  const speed = useRef(initialSpeed);
  const tourToken = useRef(0);
  const tourIndex = useRef(0);
  const holdTimer = useRef<number | null>(null);
  const userInteracting = useRef(false);
  /** After a manual mode choice, automatic zoom transitions wait until the user moves the camera. */
  const holdManualMode = useRef(false);
  const correctedOrientation = useRef(false);

  const plotSizes = useMemo(
    () => store.get().plots.filter((p) => p.polygon).map((p) => { const e = polygonExtent(p.polygon!); return Math.min(e.w, e.d); }),
    [store],
  );
  const aspect = size.width / Math.max(size.height, 1);
  const presets: Presets = useMemo(() => {
    const p = computePresets(bounds, { fovDeg: FOV, aspect, plotSizes });
    return customAerial ? { ...p, aerial: customAerial } : p;
  }, [bounds, aspect, plotSizes, customAerial]);
  const plotPolys = useMemo(() => store.get().plots.flatMap((p) => (p.polygon ? [p.polygon] : [])), [store]);

  const smooth = () => (reducedMotion ? 0 : 0.9 / speed.current);

  const move = (pose: CameraPose, animate = true) => {
    const c = controls.current;
    if (!c) return Promise.resolve();
    c.smoothTime = smooth();
    return c.setLookAt(...pose.position, ...pose.target, animate && !reducedMotion);
  };

  // Limits: keep the camera within sensible venture bounds and above ground.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.minDistance = presets.minDistance;
    c.maxDistance = presets.maxDistance;
    c.maxPolarAngle = (80 * Math.PI) / 180;
    c.dollyToCursor = true;
    c.draggingSmoothTime = 0.12;
    // Gentler wheel / pinch so zooming feels controlled on trackpads and phones.
    c.dollySpeed = 0.55;
    c.azimuthRotateSpeed = 0.8;
    c.polarRotateSpeed = 0.8;
    const pad = Math.max(bounds.width, bounds.depth) * 0.25;
    c.setBoundary(new THREE.Box3(
      new THREE.Vector3(-bounds.width / 2 - pad, -1, -bounds.depth / 2 - pad),
      new THREE.Vector3(bounds.width / 2 + pad, 40, bounds.depth / 2 + pad),
    ));
    c.boundaryFriction = 0.15;
  }, [presets, bounds]);

  // Opening: short, skippable descent into the aerial overview (or a direct cut).
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const target = initialMode === "top" ? presets.top : initialMode === "intelligence" ? presets.angled : presets.aerial;
    if (initialMode !== "aerial") store.set({ mode: initialMode });
    if (playIntro && !reducedMotion) {
      c.setLookAt(...presets.highAltitude.position, ...presets.highAltitude.target, false);
      store.set({ introPlaying: true });
      const t = window.setTimeout(() => {
        c.smoothTime = 1.6; // slow, cinematic descent
        c.setLookAt(...target.position, ...target.target, true).finally(() => store.set({ introPlaying: false }));
      }, 120);
      return () => {
        window.clearTimeout(t);
        store.set({ introPlaying: false });
      };
    }
    move(target, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets.aerial]);

  const stopTour = (reason: "exit" | "interrupt" | "done") => {
    tourToken.current++;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    const s = store.get();
    if (s.tour.running) {
      store.set({ tour: { ...s.tour, running: false, paused: false }, mode: s.intelligence ? "intelligence" : "aerial" });
      if (reason === "interrupt") store.notify("Tour stopped — you're in control.");
    }
  };

  const runTour = async (fromStep: number) => {
    const token = ++tourToken.current;
    const s = store.get();
    const focusPolys = s.selected.map((id) => s.plots[s.index.get(id)!]?.polygon).filter(Boolean) as [number, number][][];
    const steps = buildTour(bounds, features, presets, { fovDeg: FOV, aspect, focusPolys, plotPolys });
    for (let i = fromStep; i < steps.length; i++) {
      if (token !== tourToken.current) return;
      tourIndex.current = i;
      store.set((st) => ({ tour: { ...st.tour, running: true, paused: false, step: i + 1, total: steps.length, label: steps[i].label } }));
      await move(steps[i].pose);
      if (token !== tourToken.current) return;
      const hold = reducedMotion ? Math.max(steps[i].holdMs, 2200) : steps[i].holdMs / speed.current;
      await new Promise<void>((resolve) => {
        holdTimer.current = window.setTimeout(resolve, hold);
      });
    }
    if (token === tourToken.current) stopTour("done");
  };

  // User input interrupts the tour immediately (wheel does not emit controlstart, so listen to the DOM too).
  useEffect(() => {
    const el = gl.domElement;
    const onInput = () => {
      userInteracting.current = true;
      holdManualMode.current = false; // the user is steering again: zoom-based transitions resume
      if (store.get().introPlaying) store.set({ introPlaying: false }); // any input takes over from the intro
      if (store.get().tour.running && !store.get().tour.paused) {
        controls.current?.stop?.();
        stopTour("interrupt");
      }
    };
    const onEnd = () => {
      userInteracting.current = false;
    };
    el.addEventListener("wheel", onInput, { passive: true });
    el.addEventListener("pointerdown", onInput);
    el.addEventListener("touchstart", onInput, { passive: true });
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("wheel", onInput);
      el.removeEventListener("pointerdown", onInput);
      el.removeEventListener("touchstart", onInput);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("touchend", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  // Imperative API used by the toolbar.
  useEffect(() => {
    apiRef.current = {
      goTo: (m) => {
        stopTour("exit");
        const pose = m === "aerial" ? presets.aerial : m === "top" ? presets.top : presets.angled;
        const mode: ViewMode = m === "aerial" ? "aerial" : m === "top" ? "top" : "intelligence";
        store.set({ mode });
        holdManualMode.current = true;
        correctedOrientation.current = true;
        move(pose);
      },
      focusPlots: (ids) => {
        const s = store.get();
        const polys = ids.map((id) => s.plots[s.index.get(id) ?? -1]?.polygon).filter(Boolean) as [number, number][][];
        if (!polys.length) return;
        stopTour("exit");
        correctedOrientation.current = true;
        move(focusPose(bounds, polys, { fovDeg: FOV, aspect }));
      },
      startTour: () => {
        store.set({ mode: "tour" });
        runTour(0);
      },
      pauseTour: () => {
        tourToken.current++;
        if (holdTimer.current) window.clearTimeout(holdTimer.current);
        controls.current?.stop?.();
        store.set((s) => ({ tour: { ...s.tour, paused: true } }));
      },
      resumeTour: () => runTour(tourIndex.current),
      skipStep: () => {
        if (holdTimer.current) window.clearTimeout(holdTimer.current);
        runTour(Math.min(tourIndex.current + 1, Number.MAX_SAFE_INTEGER));
      },
      exitTour: () => {
        stopTour("exit");
        move(presets.aerial);
      },
      reset: () => {
        stopTour("exit");
        holdManualMode.current = true;
        store.set({ mode: "aerial" });
        move(presets.aerial);
      },
      setSpeed: (v) => {
        speed.current = v;
      },
      skipIntro: () => {
        const c = controls.current;
        if (!c) return;
        c.stop?.();
        const s = store.get();
        const pose = s.mode === "top" ? presets.top : s.mode === "intelligence" ? presets.angled : presets.aerial;
        c.setLookAt(...pose.position, ...pose.target, false);
        store.set({ introPlaying: false });
        invalidate();
      },
      getPose: () => {
        const c = controls.current;
        if (!c) return null;
        const p = c.getPosition(new THREE.Vector3());
        const t = c.getTarget(new THREE.Vector3());
        const r = (v: number) => Math.round(v * 100) / 100;
        return { position: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)] };
      },
    };
  });

  const last = useRef(performance.now());
  useFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    const c = controls.current;
    const s = store.get();
    if (!c) return;

    // Zoom-based gate: projected size of a typical plot on screen (viewport-relative thresholds, hysteresis).
    const px = projectedPixels(presets.medianPlotSize, c.distance, FOV, size.height);
    const prev = gate.current.active;
    const active = gate.current.update(px, size.width, size.height);
    if (active !== prev) {
      const patch: Partial<ReturnType<typeof store.get>> = { intelligence: active };
      if (s.autoTransition && !s.tour.running && !holdManualMode.current && (s.mode === "aerial" || s.mode === "intelligence" || s.mode === "top")) {
        patch.mode = active ? (s.mode === "top" ? "top" : "intelligence") : "aerial";
        if (active) correctedOrientation.current = false;
      }
      store.set(patch);
    }

    const mode = store.get().mode;
    const tourSel = s.tour.running && /Selected/.test(s.tour.label);
    const targetIntel = mode === "intelligence" || mode === "top" || tourSel ? 1 : 0;
    const targetHolo = s.style === "hologram" ? 1 : 0;
    const f = fx.current;
    const lambda = reducedMotion ? 60 : 5;
    f.intel = damp(f.intel, targetIntel, lambda, dt);
    f.holo = damp(f.holo, targetHolo, lambda, dt);
    const labelTarget = px >= 16 ? 1 : px <= 10 ? 0 : (px - 10) / 6;
    f.labels = damp(f.labels, labelTarget, lambda, dt);
    f.time += dt;

    // Readable orientation: once the user stops interacting after entering intelligence, ease to ≤ 50° polar.
    if (mode === "intelligence" && !correctedOrientation.current && !userInteracting.current && !s.tour.running) {
      correctedOrientation.current = true;
      if (c.polarAngle > (55 * Math.PI) / 180 && !reducedMotion) {
        c.smoothTime = 0.8;
        c.rotatePolarTo((45 * Math.PI) / 180, true);
      }
    }

    const animating =
      Math.abs(f.intel - targetIntel) > 0.002 || Math.abs(f.holo - targetHolo) > 0.002 || Math.abs(f.labels - labelTarget) > 0.01 ||
      (s.style === "hologram" && s.selected.length > 0);
    if (animating) invalidate();
  });

  return <CameraControls ref={controls} makeDefault />;
}
