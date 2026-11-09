"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { PLOT_STATUS_COLOR } from "@/lib/format";
import { STATUS_SHORT, type Bounds2D } from "./camera-math";
import type { ViewerStore } from "./store";
import type { ViewerPlotData } from "./types";

export interface SceneFx {
  intel: number; // 0 cinematic … 1 live plot intelligence (smoothed)
  holo: number; // 0 realistic … 1 hologram (smoothed)
  labels: number; // label legibility factor (projected size based)
  time: number;
}

const SLAB_H = 0.35;
const LIFT_SELECTED = 0.9;
const LIFT_HOVER = 0.3;
const CELL_W = 128;
const CELL_H = 64;
const COLS = 16;

const statusRgb = (s: string) => new THREE.Color(PLOT_STATUS_COLOR[s] ?? "#999999");

interface Built {
  slab: THREE.BufferGeometry;
  lines: THREE.BufferGeometry;
  labels: THREE.BufferGeometry;
  triToPlot: Uint32Array;
  slabRanges: [number, number][]; // vertex range per plot
  lineRanges: [number, number][];
  labelRanges: [number, number][];
  plotIdx: number[]; // plot indices that have geometry
}

/** Builds merged geometry for all plots once. Status/selection live in per-vertex attributes. */
function buildGeometry(plots: ViewerPlotData[], b: Bounds2D): Built {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], flg: number[] = [];
  const lpos: number[] = [], lcol: number[] = [], lflg: number[] = [];
  const qpos: number[] = [], quv: number[] = [], qflg: number[] = [];
  const tri: number[] = [];
  const slabRanges: [number, number][] = [], lineRanges: [number, number][] = [], labelRanges: [number, number][] = [];
  const plotIdx: number[] = [];
  const rows = Math.ceil(plots.length / COLS) || 1;

  plots.forEach((p, i) => {
    slabRanges[i] = [0, 0];
    lineRanges[i] = [0, 0];
    labelRanges[i] = [0, 0];
    if (!p.polygon || p.polygon.length < 3) return;
    plotIdx.push(i);
    const c = statusRgb(p.status);
    let poly = p.polygon.map(([x, y]) => new THREE.Vector2(x - b.cx, -(y - b.cy)));
    if (THREE.ShapeUtils.isClockWise(poly)) poly = poly.reverse();
    const startV = pos.length / 3;
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      pos.push(x, y, z);
      nor.push(nx, ny, nz);
      col.push(c.r, c.g, c.b);
      flg.push(0, 0, 0, 1); // selected, hover, focused, visible
    };
    // Top face (scene XZ plane; polygon in (x, z))
    const faces = THREE.ShapeUtils.triangulateShape(poly, []);
    const topStart = pos.length / 3;
    poly.forEach((v) => push(v.x, SLAB_H, v.y, 0, 1, 0));
    for (const f of faces) {
      // Winding: polygon CCW in (x, z-flipped) → reverse for upward normal.
      tri.push(i);
      // indices handled via non-indexed expansion below
      void f;
    }
    // Expand top triangles to non-indexed vertices for simple attribute ranges.
    const topVerts = poly.map((v) => [v.x, v.y]);
    pos.length = topStart * 3; nor.length = topStart * 3; col.length = topStart * 3; flg.length = topStart * 4;
    tri.length -= faces.length;
    for (const [a, bb, cc] of faces) {
      for (const k of [a, cc, bb]) push(topVerts[k][0], SLAB_H, topVerts[k][1], 0, 1, 0);
      tri.push(i);
    }
    // Side walls
    for (let k = 0; k < poly.length; k++) {
      const v0 = poly[k], v1 = poly[(k + 1) % poly.length];
      const n = new THREE.Vector3(v1.y - v0.y, 0, -(v1.x - v0.x)).normalize();
      const quad = [[v0.x, 0, v0.y], [v1.x, 0, v1.y], [v1.x, SLAB_H, v1.y], [v0.x, 0, v0.y], [v1.x, SLAB_H, v1.y], [v0.x, SLAB_H, v0.y]];
      for (const q of quad) push(q[0], q[1], q[2], -n.x, 0, -n.z);
      tri.push(i, i);
    }
    slabRanges[i] = [startV, pos.length / 3 - startV];

    // Boundary lines (top outline)
    const ls = lpos.length / 3;
    for (let k = 0; k < poly.length; k++) {
      const v0 = poly[k], v1 = poly[(k + 1) % poly.length];
      lpos.push(v0.x, SLAB_H + 0.03, v0.y, v1.x, SLAB_H + 0.03, v1.y);
      lcol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      lflg.push(0, 0, 0, 1, 0, 0, 0, 1);
    }
    lineRanges[i] = [ls, lpos.length / 3 - ls];

    // Label quad (flat, centred, sized to the plot)
    const xs = poly.map((v) => v.x), zs = poly.map((v) => v.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
    const qw = Math.min(w * 0.85, d * 1.6, 9), qh = qw / 2;
    const col_ = i % COLS, row = Math.floor(i / COLS);
    const u0 = col_ / COLS, u1 = (col_ + 1) / COLS, v1_ = 1 - row / rows, v0_ = 1 - (row + 1) / rows;
    const y = SLAB_H + 0.05;
    const qs = qpos.length / 3;
    const corners = [[cx - qw / 2, cz + qh / 2, u0, v0_], [cx + qw / 2, cz + qh / 2, u1, v0_], [cx + qw / 2, cz - qh / 2, u1, v1_], [cx - qw / 2, cz - qh / 2, u0, v1_]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      qpos.push(corners[k][0], y, corners[k][1]);
      quv.push(corners[k][2], corners[k][3]);
      qflg.push(0, 0, 0, 1);
    }
    labelRanges[i] = [qs, 6];
  });

  const slab = new THREE.BufferGeometry();
  slab.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  slab.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  slab.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
  slab.setAttribute("aFlags", new THREE.Float32BufferAttribute(flg, 4));
  slab.computeBoundingSphere();
  slab.computeBoundingBox();

  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(lpos, 3));
  lines.setAttribute("aColor", new THREE.Float32BufferAttribute(lcol, 3));
  lines.setAttribute("aFlags", new THREE.Float32BufferAttribute(lflg, 4));
  lines.computeBoundingSphere();

  const labels = new THREE.BufferGeometry();
  labels.setAttribute("position", new THREE.Float32BufferAttribute(qpos, 3));
  labels.setAttribute("uv", new THREE.Float32BufferAttribute(quv, 2));
  labels.setAttribute("aFlags", new THREE.Float32BufferAttribute(qflg, 4));
  labels.computeBoundingSphere();

  return { slab, lines, labels, triToPlot: Uint32Array.from(tri), slabRanges, lineRanges, labelRanges, plotIdx };
}

function drawCell(ctx: CanvasRenderingContext2D, i: number, p: ViewerPlotData) {
  const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H;
  ctx.clearRect(x, y, CELL_W, CELL_H);
  const short = STATUS_SHORT[p.status] ?? "";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.font = `800 ${short ? 30 : 38}px Urbanist, system-ui, Arial`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(4,10,30,0.75)";
  ctx.fillStyle = "#ffffff";
  const ty = y + (short ? 24 : CELL_H / 2 + 1);
  ctx.strokeText(p.plotNumber, x + CELL_W / 2, ty);
  ctx.fillText(p.plotNumber, x + CELL_W / 2, ty);
  if (short) {
    ctx.font = "800 15px system-ui, Arial";
    ctx.lineWidth = 4;
    ctx.strokeText(short, x + CELL_W / 2, y + 50);
    ctx.fillStyle = "#fff5d6";
    ctx.fillText(short, x + CELL_W / 2, y + 50);
  }
}

const slabVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aFlags;
  uniform float uIntel;
  uniform float uLiftSel;
  uniform float uLiftHover;
  varying vec3 vColor;
  varying vec4 vFlags;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vFog;
  void main() {
    vColor = aColor;
    vFlags = aFlags;
    vec3 p = position;
    p.y += (aFlags.x * uLiftSel + aFlags.y * uLiftHover) * uIntel;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const slabFragment = /* glsl */ `
  uniform float uIntel;
  uniform float uHolo;
  uniform float uTime;
  uniform vec3 uLand;
  uniform vec3 uLight;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying vec4 vFlags;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vFog;
  void main() {
    float visible = vFlags.w;
    float sel = vFlags.x;
    float hover = vFlags.y;
    float focus = vFlags.z;
    // Aerial view keeps a soft status tint so the layout reads at a glance; full colour in plot intelligence.
    vec3 base = mix(uLand, vColor, max(uIntel, 0.32) * mix(0.25, 1.0, visible));
    float diff = max(dot(vNormal, normalize(uLight)), 0.0);
    vec3 lit = base * (0.55 + 0.6 * diff);
    vec3 gold = vec3(0.95, 0.78, 0.30);
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
    lit = mix(lit, gold, (sel * (0.35 + 0.15 * pulse * uHolo) + focus * 0.25 + hover * 0.12) * uIntel);
    // Hologram: translucent, cyan/royal tint, fresnel rim.
    float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.0);
    // Hologram keeps live status readable at every zoom level.
    vec3 holoCol = mix(vec3(0.08, 0.25, 0.75), vColor, 0.6 * max(uIntel, 0.65)) + vec3(0.1, 0.8, 1.0) * rim * 0.6;
    vec3 col = mix(lit, holoCol, uHolo);
    float alpha = mix(1.0, 0.42 + 0.4 * sel + 0.25 * rim, uHolo) * mix(1.0, 0.55, (1.0 - visible) * uIntel);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
  }`;

const lineVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aFlags;
  uniform float uIntel;
  uniform float uLiftSel;
  uniform float uLiftHover;
  varying vec3 vColor;
  varying vec4 vFlags;
  void main() {
    vColor = aColor;
    vFlags = aFlags;
    vec3 p = position;
    p.y += (aFlags.x * uLiftSel + aFlags.y * uLiftHover) * uIntel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const lineFragment = /* glsl */ `
  uniform float uIntel;
  uniform float uHolo;
  varying vec3 vColor;
  varying vec4 vFlags;
  void main() {
    vec3 gold = vec3(0.98, 0.82, 0.36);
    vec3 base = mix(vec3(0.95, 0.93, 0.85), mix(vec3(0.05, 0.12, 0.36), vColor * 0.6, 0.4), uIntel);
    vec3 col = mix(base, gold, max(vFlags.x, vFlags.z));
    col = mix(col, gold, uHolo * 0.85);
    float a = mix(0.18, 0.95, uIntel) * mix(0.35, 1.0, vFlags.w);
    a = max(a, max(vFlags.x, vFlags.z));
    gl_FragColor = vec4(col, a);
  }`;

const labelVertex = /* glsl */ `
  attribute vec4 aFlags;
  uniform float uIntel;
  uniform float uLiftSel;
  uniform float uLiftHover;
  varying vec2 vUv;
  varying vec4 vFlags;
  void main() {
    vUv = uv;
    vFlags = aFlags;
    vec3 p = position;
    p.y += (aFlags.x * uLiftSel + aFlags.y * uLiftHover) * uIntel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const labelFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec4 vFlags;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * uOpacity * mix(0.25, 1.0, vFlags.w);
    if (a < 0.04) discard;
    gl_FragColor = vec4(t.rgb, a);
  }`;

export const LAND_PATTERNS: Record<string, string> = { earth: "#c9b48a", sand: "#e3d2a4", lawn: "#86b862", blueprint: "#25407f" };

export function PlotLayer({ store, bounds, fx, onPick, onHover, landPattern = "earth" }: {
  store: ViewerStore;
  bounds: Bounds2D;
  fx: React.MutableRefObject<SceneFx>;
  onPick: (plotId: string, additive: boolean) => void;
  onHover?: (plotId: string | null) => void;
  landPattern?: string;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const plots = store.get().plots;
  // Geometry depends only on plot shapes; status/selection updates touch attributes only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildGeometry(plots, bounds), [bounds]);

  const atlas = useMemo(() => {
    const rows = Math.ceil(plots.length / COLS) || 1;
    const canvas = document.createElement("canvas");
    canvas.width = COLS * CELL_W;
    canvas.height = rows * CELL_H;
    const ctx = canvas.getContext("2d")!;
    plots.forEach((p, i) => drawCell(ctx, i, p));
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return { canvas, ctx, tex };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  const uniforms = useMemo(() => {
    const shared = { uIntel: { value: 0 }, uLiftSel: { value: LIFT_SELECTED }, uLiftHover: { value: LIFT_HOVER } };
    return {
      slab: {
        ...shared, uHolo: { value: 0 }, uTime: { value: 0 }, uLand: { value: new THREE.Color("#c9b48a") },
        uLight: { value: new THREE.Vector3(0.5, 1, 0.35) }, uFogColor: { value: new THREE.Color("#cfd9ef") }, uFogDensity: { value: 0 },
      },
      lines: { ...shared, uHolo: { value: 0 } },
      labels: { ...shared, uMap: { value: atlas.tex }, uOpacity: { value: 0 } },
    };
  }, [atlas.tex]);

  const slabMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: slabVertex, fragmentShader: slabFragment, uniforms: uniforms.slab, transparent: true }), [uniforms]);
  const lineMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: lineVertex, fragmentShader: lineFragment, uniforms: uniforms.lines, transparent: true, depthWrite: false }), [uniforms]);
  const labelMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: labelVertex, fragmentShader: labelFragment, uniforms: uniforms.labels, transparent: true, depthWrite: false }), [uniforms]);

  useEffect(() => {
    uniforms.slab.uLand.value.set(LAND_PATTERNS[landPattern] ?? LAND_PATTERNS.earth);
    invalidate();
  }, [landPattern, uniforms, invalidate]);

  useEffect(() => () => {
    built.slab.dispose(); built.lines.dispose(); built.labels.dispose();
    atlas.tex.dispose(); slabMat.dispose(); lineMat.dispose(); labelMat.dispose();
  }, [built, atlas, slabMat, lineMat, labelMat]);

  // Imperative attribute updates from the store (status colours, flags, atlas cells).
  useEffect(() => {
    let lastStatus = -1;
    let last: { selected: string[]; focused: string | null; hovered: string | null; vis: Set<string> } | null = null;
    const apply = () => {
      const s = store.get();
      const statusChanged = s.statusVersion !== lastStatus;
      const flagsChanged = !last || last.selected !== s.selected || last.focused !== s.focused || last.hovered !== s.hovered || last.vis !== s.visibleStatuses;
      if (!statusChanged && !flagsChanged) return;
      const col = built.slab.getAttribute("aColor") as THREE.BufferAttribute;
      const flg = built.slab.getAttribute("aFlags") as THREE.BufferAttribute;
      const lcol = built.lines.getAttribute("aColor") as THREE.BufferAttribute;
      const lflg = built.lines.getAttribute("aFlags") as THREE.BufferAttribute;
      const qflg = built.labels.getAttribute("aFlags") as THREE.BufferAttribute;
      const sel = new Set(s.selected);
      for (const i of built.plotIdx) {
        const p = s.plots[i];
        const f = [sel.has(p.id) ? 1 : 0, s.hovered === p.id ? 1 : 0, s.focused === p.id ? 1 : 0, s.visibleStatuses.has(p.status) ? 1 : 0];
        const c = statusRgb(p.status);
        const [ss, sn] = built.slabRanges[i];
        for (let v = ss; v < ss + sn; v++) {
          if (statusChanged) col.setXYZ(v, c.r, c.g, c.b);
          flg.setXYZW(v, f[0], f[1], f[2], f[3]);
        }
        const [ls, ln] = built.lineRanges[i];
        for (let v = ls; v < ls + ln; v++) {
          if (statusChanged) lcol.setXYZ(v, c.r, c.g, c.b);
          lflg.setXYZW(v, f[0], f[1], f[2], f[3]);
        }
        const [qs, qn] = built.labelRanges[i];
        for (let v = qs; v < qs + qn; v++) qflg.setXYZW(v, f[0], f[1], f[2], f[3]);
      }
      if (statusChanged && lastStatus !== -1) {
        s.plots.forEach((p, i) => drawCell(atlas.ctx, i, p));
        atlas.tex.needsUpdate = true;
      }
      col.needsUpdate = statusChanged || col.needsUpdate;
      flg.needsUpdate = true;
      lcol.needsUpdate = statusChanged || lcol.needsUpdate;
      lflg.needsUpdate = true;
      qflg.needsUpdate = true;
      lastStatus = s.statusVersion;
      last = { selected: s.selected, focused: s.focused, hovered: s.hovered, vis: s.visibleStatuses };
      invalidate();
    };
    apply();
    return store.subscribe(apply);
  }, [store, built, atlas, invalidate]);

  useFrame(() => {
    const f = fx.current;
    uniforms.slab.uIntel.value = f.intel;
    uniforms.slab.uHolo.value = f.holo;
    uniforms.slab.uTime.value = f.time;
    uniforms.slab.uFogDensity.value = 0.0009 * (1 - f.intel) * (1 - f.holo);
    uniforms.lines.uIntel.value = f.intel;
    uniforms.lines.uHolo.value = f.holo;
    uniforms.labels.uIntel.value = f.intel;
    uniforms.labels.uOpacity.value = f.labels * f.intel * (store.get().showLabels ? 1 : 0);
  });

  const pointer = useRef<{ x: number; y: number } | null>(null);
  const plotFromEvent = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (e.faceIndex === undefined || e.faceIndex === null) return null;
    const i = built.triToPlot[e.faceIndex];
    return i === undefined ? null : store.get().plots[i];
  };

  return (
    <group>
      <mesh
        geometry={built.slab}
        material={slabMat}
        frustumCulled
        onPointerDown={(e) => { pointer.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }; }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return;
          const p = plotFromEvent(e);
          const id = p?.id ?? null;
          if (store.get().hovered !== id) {
            store.set({ hovered: id });
            onHover?.(id);
            document.body.style.cursor = id && fx.current.intel > 0.5 ? "pointer" : "";
          }
        }}
        onPointerOut={() => {
          if (store.get().hovered) store.set({ hovered: null });
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          // Ignore clicks that ended a drag (orbit/pan) — measured in screen pixels.
          const start = pointer.current;
          if (start && Math.hypot(e.nativeEvent.clientX - start.x, e.nativeEvent.clientY - start.y) > 6) return;
          const p = plotFromEvent(e);
          if (!p) return;
          e.stopPropagation();
          onPick(p.id, e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey);
        }}
      />
      <lineSegments geometry={built.lines} material={lineMat} raycast={() => null} />
      <mesh geometry={built.labels} material={labelMat} raycast={() => null} renderOrder={2} />
    </group>
  );
}
