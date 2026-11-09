"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, PerformanceMonitor, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { FACING_LABEL, inr, PLOT_STATUS_COLOR, PLOT_STATUS_LABEL } from "@/lib/format";
import { boundsOf, centroid, toScene, type Bounds2D, type FeatureLike } from "./camera-math";
import { PlotLayer, type SceneFx } from "./plot-layer";
import { Environment, SKY_PRESETS } from "./environment";
import type { ViewerSettings } from "@/lib/viewer-settings";
import { CameraRig, type RigApi } from "./camera-rig";
import { useViewer, type ViewerStore } from "./store";
import type { ViewerData } from "./types";

export interface Scene3DProps {
  data: ViewerData;
  store: ViewerStore;
  apiRef: React.MutableRefObject<RigApi | null>;
  reducedMotion: boolean;
  initialQuality: "high" | "low";
  settings: ViewerSettings;
  onPick: (plotId: string, additive: boolean) => void;
}

/** Floating holographic info card over the focused plot (only in plot-intelligence mode). */
function FocusCard({ store, bounds, fx }: { store: ViewerStore; bounds: Bounds2D; fx: React.MutableRefObject<SceneFx> }) {
  const focused = useViewer(store, (s) => (s.focused ? s.plots[s.index.get(s.focused)!] : null));
  const intel = useViewer(store, (s) => s.mode === "intelligence" || s.mode === "top");
  const style = useViewer(store, (s) => s.style);
  if (!focused?.polygon || !intel) return null;
  const [x, y] = centroid(focused.polygon);
  const pos = toScene(bounds, x, y, 2.4);
  void fx;
  return (
    <Html position={pos} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div
        className={
          style === "hologram"
            ? "min-w-[150px] rounded-xl border border-cyan-300/50 bg-[#03122e]/80 px-3 py-2 text-xs text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)] backdrop-blur"
            : "min-w-[150px] rounded-xl border border-[#c9a227]/60 bg-[#0b1f5c]/90 px-3 py-2 text-xs text-white shadow-xl backdrop-blur"
        }
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-extrabold">Plot {focused.plotNumber}</span>
          <span className="flex items-center gap-1 font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ background: PLOT_STATUS_COLOR[focused.status] }} />
            {PLOT_STATUS_LABEL[focused.status]}
          </span>
        </div>
        <div className="mt-0.5 opacity-80">{focused.areaSqYards} sq yd · {focused.dimensions ?? "—"}</div>
        <div className="opacity-80">
          {focused.facing ? `${FACING_LABEL[focused.facing] ?? focused.facing} facing` : "Facing —"}
          {focused.roadWidthFt ? ` · ${focused.roadWidthFt} ft road` : ""}
        </div>
        <div className="font-bold text-[#f3dc8a]">{inr(focused.totalPrice, { compact: true })}</div>
      </div>
    </Html>
  );
}

/** GLB/glTF mode: colours & picks meshes whose node name matches plot_geometry.mesh_id. */
function GlbModel({ url, store, fx, onPick }: { url: string; store: ViewerStore; fx: React.MutableRefObject<SceneFx>; onPick: Scene3DProps["onPick"] }) {
  const gltf = useGLTF(url);
  const invalidate = useThree((s) => s.invalidate);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  useEffect(() => {
    const apply = () => {
      const s = store.get();
      const byMesh = new Map(s.plots.filter((p) => p.meshId).map((p) => [p.meshId!, p]));
      const sel = new Set(s.selected);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const plot = byMesh.get(m.name);
        if (!plot) return;
        m.userData.plotId = plot.id;
        const intel = fx.current.intel > 0.5;
        m.material = new THREE.MeshStandardMaterial({
          color: intel ? PLOT_STATUS_COLOR[plot.status] ?? "#999" : "#c9b48a",
          transparent: true,
          opacity: s.visibleStatuses.has(plot.status) ? 0.95 : 0.25,
          emissive: sel.has(plot.id) || s.focused === plot.id ? new THREE.Color("#c9a227") : new THREE.Color("#000"),
          emissiveIntensity: sel.has(plot.id) ? 0.45 : s.focused === plot.id ? 0.25 : 0,
        });
      });
      invalidate();
    };
    apply();
    return store.subscribe(apply);
  }, [scene, store, fx, invalidate]);
  return (
    <primitive
      object={scene}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        const id = e.object.userData.plotId as string | undefined;
        if (id) {
          e.stopPropagation();
          onPick(id, e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey);
        }
      }}
    />
  );
}

export default function Scene3D({ data, store, apiRef, reducedMotion, initialQuality, settings, onPick }: Scene3DProps) {
  const sky = SKY_PRESETS[settings.sky];
  const [quality, setQuality] = useState<"high" | "low">(initialQuality);
  const [dpr, setDpr] = useState(initialQuality === "high" ? 1.6 : 1);
  const fx = useRef<SceneFx>({ intel: 0, holo: 0, labels: 0, time: 0 });
  const bounds = useMemo(
    () => boundsOf([...data.plots.flatMap((p) => (p.polygon ? [p.polygon] : [])), ...data.features.map((f) => f.polygon)]),
    // Geometry only — live status updates must not rebuild the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.venture.id],
  );
  const features = data.features as FeatureLike[];
  const useGlb = data.venture.viewerMode === "glb" && !!data.venture.modelUrl;
  const sun = Math.max(bounds.width, bounds.depth);

  return (
    <Canvas
      frameloop="demand"
      dpr={dpr}
      shadows={quality === "high"}
      gl={{ antialias: quality === "high", powerPreference: "high-performance", preserveDrawingBuffer: false }}
      camera={{ fov: 45, near: 0.5, far: sun * 12, position: [0, sun, sun] }}
      aria-label={`Interactive 3D model of ${data.venture.name}`}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <PerformanceMonitor
        onDecline={() => {
          setQuality("low");
          setDpr(1);
        }}
        onIncline={() => setDpr((d) => Math.min(d + 0.2, initialQuality === "high" ? 1.75 : 1.25))}
        flipflops={3}
        onFallback={() => {
          setQuality("low");
          setDpr(1);
        }}
      />
      <hemisphereLight args={["#e9eefc", "#4a5a3a", sky.hemiI]} />
      <directionalLight
        position={[sun * 0.6, sun * 0.9, sun * 0.35]}
        intensity={sky.sunI}
        color={sky.sun}
        castShadow={quality === "high"}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-sun}
        shadow-camera-right={sun}
        shadow-camera-top={sun}
        shadow-camera-bottom={-sun}
        shadow-camera-far={sun * 4}
        shadow-bias={-0.0004}
      />
      <Environment bounds={bounds} features={features} ventureName={data.venture.name} fx={fx} quality={quality}
        sky={settings.sky} showTrees={settings.showTrees} showLamps={settings.showStreetLights} />
      {useGlb ? (
        <Suspense fallback={null}>
          <GlbModel url={data.venture.modelUrl!} store={store} fx={fx} onPick={onPick} />
        </Suspense>
      ) : (
        <PlotLayer store={store} bounds={bounds} fx={fx} onPick={onPick} landPattern={settings.landPattern} />
      )}
      <FocusCard store={store} bounds={bounds} fx={fx} />
      <CameraRig store={store} bounds={bounds} features={features} fx={fx} reducedMotion={reducedMotion} apiRef={apiRef}
        playIntro={settings.introAnimation} initialMode={settings.defaultMode} initialSpeed={settings.tourSpeed}
        customAerial={settings.customAerial} />
    </Canvas>
  );
}
