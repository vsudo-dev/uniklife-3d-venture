"use client";

import { useRef, useSyncExternalStore } from "react";
import type { ViewerPlotData } from "./types";

/**
 * Tiny external store for the viewer. The 3D layers subscribe imperatively and
 * update GPU buffers directly, so selection/status/mode changes never trigger a
 * React re-render of the WebGL scene graph. UI panels read slices via useViewer().
 */
export type ViewMode = "aerial" | "tour" | "top" | "intelligence";
export type RenderStyle = "realistic" | "hologram";

export interface TourState {
  running: boolean;
  paused: boolean;
  step: number;
  total: number;
  label: string;
}

export interface ViewerState {
  plots: ViewerPlotData[];
  index: Map<string, number>;
  statusVersion: number; // bumps when any plot status changes
  selected: string[];
  focused: string | null;
  hovered: string | null;
  compare: string[];
  mode: ViewMode;
  style: RenderStyle;
  autoTransition: boolean;
  intelligence: boolean; // gate state (coarse — flips only at thresholds)
  visibleStatuses: Set<string>;
  showLabels: boolean;
  /** When on, tapping an available plot adds/removes it from the cart directly. */
  tapToAdd: boolean;
  /** Opening camera animation is playing (shows a Skip button). */
  introPlaying: boolean;
  tour: TourState;
  liveConnected: boolean;
  messages: { id: number; text: string; tone: "info" | "warning" }[];
}

type Listener = () => void;

export interface ViewerStore {
  get: () => ViewerState;
  set: (patch: Partial<ViewerState> | ((s: ViewerState) => Partial<ViewerState>)) => void;
  subscribe: (l: Listener) => () => void;
  /** Applies live status deltas from the server (source of truth). Returns plots that changed. */
  applyStatuses: (updates: { id: string; status: string }[]) => ViewerPlotData[];
  toggleSelect: (id: string) => { ok: boolean; reason?: string };
  toggleCompare: (id: string) => void;
  notify: (text: string, tone?: "info" | "warning") => void;
}

export const MAX_SELECTION = 10;
export const MAX_COMPARE = 3;
export const ALL_STATUSES = ["available", "held", "reserved", "booked", "sold", "blocked"] as const;

let msgId = 0;

export function createViewerStore(
  plots: ViewerPlotData[],
  opts: { reducedMotion?: boolean; style?: RenderStyle; autoTransition?: boolean; showLabels?: boolean; tapToAdd?: boolean } = {},
): ViewerStore {
  let state: ViewerState = {
    plots,
    index: new Map(plots.map((p, i) => [p.id, i])),
    statusVersion: 0,
    selected: [],
    focused: null,
    hovered: null,
    compare: [],
    mode: "aerial",
    style: opts.style ?? "realistic",
    autoTransition: opts.autoTransition ?? true,
    intelligence: false,
    visibleStatuses: new Set(ALL_STATUSES),
    showLabels: opts.showLabels ?? true,
    tapToAdd: opts.tapToAdd ?? false,
    introPlaying: false,
    tour: { running: false, paused: false, step: 0, total: 0, label: "" },
    liveConnected: false,
    messages: [],
  };
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  const store: ViewerStore = {
    get: () => state,
    set: (patch) => {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      emit();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    applyStatuses: (updates) => {
      const changed: ViewerPlotData[] = [];
      const next = state.plots.slice();
      for (const u of updates) {
        const i = state.index.get(u.id);
        if (i === undefined || next[i].status === u.status) continue;
        next[i] = { ...next[i], status: u.status };
        changed.push(next[i]);
      }
      if (changed.length === 0) return changed;
      const unavailable = new Set(changed.filter((p) => p.status !== "available").map((p) => p.id));
      const droppedSel = state.selected.filter((id) => unavailable.has(id));
      state = {
        ...state,
        plots: next,
        statusVersion: state.statusVersion + 1,
        selected: state.selected.filter((id) => !unavailable.has(id)),
      };
      for (const p of changed) {
        if (droppedSel.includes(p.id)) {
          store.notify(`Plot ${p.plotNumber} was just ${p.status === "held" ? "put on hold" : p.status} by someone else and was removed from your selection.`, "warning");
        } else if (state.focused === p.id) {
          store.notify(`Plot ${p.plotNumber} is now ${p.status}.`, p.status === "available" ? "info" : "warning");
        }
      }
      emit();
      return changed;
    },
    toggleSelect: (id) => {
      const i = state.index.get(id);
      if (i === undefined) return { ok: false, reason: "Unknown plot" };
      const plot = state.plots[i];
      if (state.selected.includes(id)) {
        store.set({ selected: state.selected.filter((x) => x !== id) });
        return { ok: true };
      }
      if (plot.status !== "available") return { ok: false, reason: `Plot ${plot.plotNumber} is ${plot.status} and cannot be selected.` };
      if (state.selected.length >= MAX_SELECTION) return { ok: false, reason: `You can select up to ${MAX_SELECTION} plots per booking.` };
      store.set({ selected: [...state.selected, id] });
      return { ok: true };
    },
    toggleCompare: (id) => {
      if (state.compare.includes(id)) store.set({ compare: state.compare.filter((x) => x !== id) });
      else if (state.compare.length >= MAX_COMPARE) store.notify(`Compare up to ${MAX_COMPARE} plots at a time.`, "warning");
      else store.set({ compare: [...state.compare, id] });
    },
    notify: (text, tone = "info") => {
      const id = ++msgId;
      state = { ...state, messages: [...state.messages.slice(-2), { id, text, tone }] };
      emit();
      window.setTimeout(() => store.set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })), 6000);
    },
  };
  return store;
}

/** Subscribe a component to a slice of the store (re-renders only when the slice changes). */
export function useViewer<T>(store: ViewerStore, selector: (s: ViewerState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ value: T } | null>(null);
  const getSnapshot = () => {
    const next = selector(store.get());
    if (cache.current && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export const shallowArray = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
