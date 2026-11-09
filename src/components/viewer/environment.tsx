"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { boundsOf, polygonExtent, type Bounds2D, type FeatureLike } from "./camera-math";
import type { SceneFx } from "./plot-layer";

/** Deterministic PRNG so the decorative layout is stable between renders. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function grassTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4f7a3a";
  g.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 2600; i++) {
    const shade = 60 + Math.floor(r() * 50);
    g.fillStyle = `rgba(${shade - 20},${shade + 60},${shade - 30},${0.25 + r() * 0.35})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2.5, 1 + r() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function nameplateTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, "#0b1f5c");
  grad.addColorStop(1, "#13308f");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = "#c9a227";
  g.lineWidth = 6;
  g.strokeRect(6, 6, 1012, 116);
  g.font = "800 64px Urbanist, system-ui, Arial";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const tg = g.createLinearGradient(0, 30, 0, 100);
  tg.addColorStop(0, "#f3dc8a");
  tg.addColorStop(1, "#c9a227");
  g.fillStyle = tg;
  g.fillText(text.slice(0, 32), 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function extrude(poly: [number, number][], b: Bounds2D, height: number) {
  const s = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x - b.cx, y - b.cy)));
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

export type SkyPreset = "day" | "golden" | "dusk" | "night";

/** Illustrative lighting presets (not a simulation of real site conditions). */
export const SKY_PRESETS: Record<SkyPreset, { zen: string; hor: string; low: string; fog: string; sun: string; sunI: number; hemiI: number; lampI: number }> = {
  day: { zen: "#2b6cd4", hor: "#cfe3ff", low: "#dfe8f5", fog: "#d7e4f7", sun: "#ffffff", sunI: 1.7, hemiI: 0.95, lampI: 0.2 },
  golden: { zen: "#12296e", hor: "#fbdba8", low: "#ccd5e6", fog: "#e6dccd", sun: "#ffe2b0", sunI: 1.6, hemiI: 0.85, lampI: 0.6 },
  dusk: { zen: "#1a1446", hor: "#f29a6b", low: "#6f5a7d", fog: "#7a6a86", sun: "#ffb27a", sunI: 1.0, hemiI: 0.55, lampI: 1.4 },
  night: { zen: "#02040d", hor: "#13214a", low: "#0a0f22", fog: "#0b1226", sun: "#9db4ff", sunI: 0.35, hemiI: 0.28, lampI: 2.6 },
};

interface Props {
  bounds: Bounds2D;
  features: FeatureLike[];
  ventureName: string;
  fx: React.MutableRefObject<SceneFx>;
  quality: "high" | "low";
  sky?: SkyPreset;
  showTrees?: boolean;
  showLamps?: boolean;
}

/**
 * Cinematic surroundings. Fully procedural (no external assets) and instanced for
 * performance. Decorative elements fade as live plot intelligence takes over so they
 * never hide plot boundaries; hologram style swaps to a translucent blueprint look.
 */
export function Environment({ bounds: b, features, ventureName, fx, quality, sky = "golden", showTrees = true, showLamps = true }: Props) {
  const preset = SKY_PRESETS[sky];
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const fogRef = useRef<THREE.FogExp2 | null>(null);
  const skyMat = useRef<THREE.ShaderMaterial>(null);
  const decor = useRef<THREE.Group>(null);
  const solid = useRef<THREE.MeshStandardMaterial[]>([]);
  const grid = useRef<THREE.GridHelper>(null);

  const span = Math.max(b.width, b.depth);
  const groundSize = span * 6;

  const grass = useMemo(() => {
    const t = grassTexture();
    t.repeat.set(groundSize / 12, groundSize / 12);
    return t;
  }, [groundSize]);

  const roads = useMemo(() => features.filter((f) => f.kind === "road"), [features]);
  const parks = useMemo(() => features.filter((f) => f.kind === "park"), [features]);
  const amenities = useMemo(() => features.filter((f) => f.kind === "amenity"), [features]);
  const entrance = useMemo(() => features.find((f) => f.kind === "entrance"), [features]);
  const boundary = useMemo(() => features.find((f) => f.kind === "boundary"), [features]);
  const water = useMemo(() => features.filter((f) => f.kind === "water"), [features]);

  const roadGeo = useMemo(() => roads.map((r) => extrude(r.polygon, b, 0.08)), [roads, b]);
  const parkGeo = useMemo(() => parks.map((p) => extrude(p.polygon, b, 0.12)), [parks, b]);
  const waterGeo = useMemo(() => water.map((p) => extrude(p.polygon, b, 0.05)), [water, b]);

  // Dashed centre lines along each road's long axis.
  const dashes = useMemo(() => {
    const m = new THREE.Matrix4();
    const items: THREE.Matrix4[] = [];
    for (const r of roads) {
      const rb = boundsOf([r.polygon]);
      const horizontal = rb.width >= rb.depth;
      const len = horizontal ? rb.width : rb.depth;
      for (let d = 2; d < len - 2; d += 6) {
        const x = horizontal ? rb.minX + d : rb.cx;
        const y = horizontal ? rb.cy : rb.minY + d;
        m.compose(new THREE.Vector3(x - b.cx, 0.1, -(y - b.cy)), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, horizontal ? 0 : Math.PI / 2)), new THREE.Vector3(3, 0.22, 1));
        items.push(m.clone());
      }
    }
    return items;
  }, [roads, b]);

  // Trees: along road edges and inside parks.
  const trees = useMemo(() => {
    const r = rng(42);
    const out: { x: number; z: number; s: number }[] = [];
    const max = quality === "high" ? 700 : 220; // instanced: 2 draw calls regardless of count
    for (const p of parks) {
      const pb = boundsOf([p.polygon]);
      const n = Math.min(80, Math.floor((pb.width * pb.depth) / 60));
      for (let i = 0; i < n && out.length < max; i++) {
        const x = pb.minX + r() * pb.width, y = pb.minY + r() * pb.depth;
        if (pointInPolygon(x, y, p.polygon)) out.push({ x: x - b.cx, z: -(y - b.cy), s: 0.7 + r() * 0.7 });
      }
    }
    // Avenue trees along both edges of every road (skipping crossings with other roads).
    for (const road of roads) {
      const rb = boundsOf([road.polygon]);
      const horizontal = rb.width >= rb.depth;
      const len = horizontal ? rb.width : rb.depth;
      const half = (horizontal ? rb.depth : rb.width) / 2;
      for (let d = 6; d < len - 4 && out.length < max; d += 11) {
        for (const side of [-1, 1]) {
          const x = horizontal ? rb.minX + d : rb.cx + side * (half - 0.9);
          const y = horizontal ? rb.cy + side * (half - 0.9) : rb.minY + d;
          const onCrossing = roads.some((o) => o !== road && pointInPolygon(x, y, o.polygon));
          if (!onCrossing) out.push({ x: x - b.cx, z: -(y - b.cy), s: 0.55 + r() * 0.25 });
        }
      }
    }
    if (boundary) {
      const poly = boundary.polygon;
      for (let i = 0; i < poly.length && out.length < max; i++) {
        const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (let d = 4; d < len; d += 9) {
          const t = d / len;
          const ox = (x0 + (x1 - x0) * t) + (r() - 0.5) * 2;
          const oy = (y0 + (y1 - y0) * t) + (r() - 0.5) * 2;
          out.push({ x: ox - b.cx, z: -(oy - b.cy), s: 0.8 + r() * 0.6 });
          if (out.length >= max) break;
        }
      }
    }
    return out;
  }, [parks, boundary, roads, b, quality]);

  // Street lamps along the widest road.
  const lamps = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    const main = [...roads].sort((a, c) => Math.min(polygonExtent(c.polygon).w, polygonExtent(c.polygon).d) - Math.min(polygonExtent(a.polygon).w, polygonExtent(a.polygon).d))[0];
    if (!main) return out;
    const rb = boundsOf([main.polygon]);
    const horizontal = rb.width >= rb.depth;
    const len = horizontal ? rb.width : rb.depth;
    for (let d = 5; d < len; d += 16) {
      for (const side of [-1, 1]) {
        const x = horizontal ? rb.minX + d : rb.cx + side * (rb.width / 2 + 0.6);
        const y = horizontal ? rb.cy + side * (rb.depth / 2 + 0.6) : rb.minY + d;
        out.push({ x: x - b.cx, z: -(y - b.cy) });
      }
    }
    return out;
  }, [roads, b]);

  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const dashRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, 1.1 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s));
      trunkRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(t.x, 3.2 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s * 1.1, t.s));
      crownRef.current?.setMatrixAt(i, m);
    });
    lamps.forEach((l, i) => {
      m.compose(new THREE.Vector3(l.x, 2.5, l.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      poleRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(l.x, 5.1, l.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      headRef.current?.setMatrixAt(i, m);
    });
    dashes.forEach((d, i) => dashRef.current?.setMatrixAt(i, d));
    for (const r of [trunkRef, crownRef, poleRef, headRef, dashRef]) {
      if (r.current) {
        r.current.instanceMatrix.needsUpdate = true;
        r.current.computeBoundingSphere();
      }
    }
    invalidate();
  }, [trees, lamps, dashes, invalidate]);

  // Compound wall segments along the boundary.
  const walls = useMemo(() => {
    if (!boundary) return [];
    const poly = boundary.polygon;
    return poly.map(([x0, y0], i) => {
      const [x1, y1] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ang = Math.atan2(-(y1 - y0), x1 - x0);
      return { x: (x0 + x1) / 2 - b.cx, z: -((y0 + y1) / 2 - b.cy), len, ang };
    });
  }, [boundary, b]);

  const gate = useMemo(() => {
    if (!entrance) return null;
    const eb = boundsOf([entrance.polygon]);
    const horizontal = eb.width >= eb.depth;
    return { x: eb.cx - b.cx, z: -(eb.cy - b.cy), span: (horizontal ? eb.width : eb.depth) + 4, rot: horizontal ? 0 : Math.PI / 2 };
  }, [entrance, b]);
  const plate = useMemo(() => nameplateTexture(ventureName), [ventureName]);

  useEffect(() => {
    const fog = new THREE.FogExp2(preset.fog, 0.0016);
    fogRef.current = fog;
    scene.fog = fog;
    lastFx.current = { intel: -1, holo: -1 };
    invalidate();
    return () => {
      scene.fog = null;
    };
  }, [scene, preset.fog, invalidate]);

  useEffect(() => () => {
    grass.dispose();
    plate.dispose();
    roadGeo.forEach((g) => g.dispose());
    parkGeo.forEach((g) => g.dispose());
    waterGeo.forEach((g) => g.dispose());
  }, [grass, plate, roadGeo, parkGeo, waterGeo]);

  const register = (m: THREE.MeshStandardMaterial | null) => {
    if (m && !solid.current.includes(m)) {
      m.userData.baseColor = m.color.clone();
      solid.current.push(m);
    }
  };

  const lastFx = useRef({ intel: -1, holo: -1 });
  const holoColor = useMemo(() => new THREE.Color("#0a2a6e"), []);
  useFrame(() => {
    const { intel, holo } = fx.current;
    if (Math.abs(intel - lastFx.current.intel) < 0.002 && Math.abs(holo - lastFx.current.holo) < 0.002) return;
    lastFx.current = { intel, holo };
    if (fogRef.current) {
      fogRef.current.density = 0.0009 * (1 - intel * 0.85) * (1 - holo);
      fogRef.current.color.set(holo > 0.5 ? "#050b22" : preset.fog);
    }
    if (skyMat.current) skyMat.current.uniforms.uHolo.value = holo;
    if (decor.current) {
      // Decorative clutter recedes for plot readability / hologram.
      const s = Math.max(0.0001, 1 - Math.max(intel * 0.85, holo));
      decor.current.scale.set(1, s, 1);
      decor.current.visible = s > 0.02;
    }
    for (const m of solid.current) {
      const base = m.userData.baseColor as THREE.Color;
      m.color.copy(base).lerp(holoColor, holo * 0.85);
      m.emissive.setRGB(0.02 * holo, 0.25 * holo, 0.6 * holo);
      m.opacity = 1 - 0.55 * holo;
      m.transparent = holo > 0.01;
      m.wireframe = holo > 0.6 && m.userData.wire === true;
    }
    if (grid.current) {
      (grid.current.material as THREE.Material).opacity = 0.65 * holo;
      grid.current.visible = holo > 0.02;
    }
  });

  return (
    <group>
      {/* Sky dome */}
      <mesh scale={groundSize * 0.9} raycast={() => null}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial
          ref={skyMat}
          side={THREE.BackSide}
          depthWrite={false}
          key={sky}
          uniforms={{ uHolo: { value: 0 }, uZen: { value: new THREE.Color(preset.zen) }, uHor: { value: new THREE.Color(preset.hor) }, uLow: { value: new THREE.Color(preset.low) } }}
          vertexShader={`varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
          fragmentShader={`uniform float uHolo; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uLow; varying vec3 vP;
            void main(){
              float h = clamp(vP.y, -0.1, 1.0);
              vec3 day = h > 0.0 ? mix(uHor, uZen, pow(h, 0.55)) : uLow;
              vec3 holo = mix(vec3(0.01,0.03,0.10), vec3(0.02,0.08,0.22), h);
              gl_FragColor = vec4(mix(day, holo, uHolo), 1.0);
            }`}
        />
      </mesh>

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial ref={register} map={grass} roughness={1} />
      </mesh>
      <gridHelper ref={grid} args={[groundSize / 2, 80, "#38bdf8", "#1e3a8a"]} position={[0, 0.02, 0]} visible={false}
        onUpdate={(g) => { const m = g.material as THREE.Material; m.transparent = true; m.opacity = 0; }} />

      {/* Roads + markings */}
      {roadGeo.map((g, i) => (
        <mesh key={`r${i}`} geometry={g} receiveShadow raycast={() => null}>
          <meshStandardMaterial ref={(m) => { if (m) { m.userData.wire = true; register(m); } }} color="#2f333c" roughness={0.92} />
        </mesh>
      ))}
      {dashes.length > 0 && (
        <instancedMesh ref={dashRef} args={[undefined, undefined, dashes.length]} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="#f1e4b5" />
        </instancedMesh>
      )}

      {/* Parks & water */}
      {parkGeo.map((g, i) => (
        <mesh key={`p${i}`} geometry={g} receiveShadow raycast={() => null}>
          <meshStandardMaterial ref={register} color="#3f8a43" roughness={1} />
        </mesh>
      ))}
      {waterGeo.map((g, i) => (
        <mesh key={`w${i}`} geometry={g} raycast={() => null}>
          <meshStandardMaterial ref={register} color="#2a6fb0" roughness={0.2} metalness={0.3} />
        </mesh>
      ))}

      {/* Amenity buildings (clubhouse etc.) */}
      {amenities.map((a, i) => {
        const ab = boundsOf([a.polygon]);
        const w = ab.width * 0.8, d = ab.depth * 0.7, h = Math.min(9, Math.max(4, Math.min(w, d) * 0.35));
        return (
          <group key={`a${i}`} position={[ab.cx - b.cx, 0, -(ab.cy - b.cy)]}>
            <mesh position={[0, h / 2, 0]} castShadow={quality === "high"} receiveShadow raycast={() => null}>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial ref={(m) => { if (m) { m.userData.wire = true; register(m); } }} color="#ece6d8" roughness={0.6} />
            </mesh>
            <mesh position={[0, h * 0.55, d / 2 + 0.02]} raycast={() => null}>
              <planeGeometry args={[w * 0.9, h * 0.35]} />
              <meshStandardMaterial ref={register} color="#7fb3e0" metalness={0.6} roughness={0.15} />
            </mesh>
            <mesh position={[0, h + 0.3, 0]} castShadow={quality === "high"} raycast={() => null}>
              <boxGeometry args={[w * 1.06, 0.6, d * 1.06]} />
              <meshStandardMaterial ref={register} color="#b8901f" metalness={0.7} roughness={0.35} />
            </mesh>
          </group>
        );
      })}

      {/* Entrance gate with venture nameplate */}
      {gate && (
        <group position={[gate.x, 0, gate.z]} rotation={[0, gate.rot, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[(s * gate.span) / 2, 3.2, 0]} castShadow={quality === "high"} raycast={() => null}>
              <boxGeometry args={[1.4, 6.4, 1.4]} />
              <meshStandardMaterial ref={register} color="#e8e0cc" roughness={0.5} />
            </mesh>
          ))}
          <mesh position={[0, 6.8, 0]} raycast={() => null}>
            <boxGeometry args={[gate.span + 1.6, 1.6, 0.8]} />
            <meshStandardMaterial ref={register} color="#b8901f" metalness={0.75} roughness={0.3} />
          </mesh>
          <mesh position={[0, 6.8, 0.42]} raycast={() => null}>
            <planeGeometry args={[gate.span * 0.92, (gate.span * 0.92) / 8]} />
            <meshBasicMaterial map={plate} toneMapped={false} />
          </mesh>
        </group>
      )}

      {/* Compound wall */}
      {walls.map((w, i) => (
        <mesh key={`wall${i}`} position={[w.x, 0.9, w.z]} rotation={[0, w.ang, 0]} castShadow={quality === "high"} raycast={() => null}>
          <boxGeometry args={[w.len, 1.8, 0.3]} />
          <meshStandardMaterial ref={register} color="#d9cfb8" roughness={0.9} />
        </mesh>
      ))}

      {/* Decorative layer (fades in intelligence / hologram mode) */}
      <group ref={decor}>
        {showTrees && trees.length > 0 && (
          <>
            <instancedMesh ref={trunkRef} args={[undefined, undefined, trees.length]} castShadow={quality === "high"} raycast={() => null}>
              <cylinderGeometry args={[0.18, 0.26, 2.2, 6]} />
              <meshStandardMaterial color="#6b4a2f" roughness={1} />
            </instancedMesh>
            <instancedMesh ref={crownRef} args={[undefined, undefined, trees.length]} castShadow={quality === "high"} raycast={() => null}>
              <icosahedronGeometry args={[1.6, 0]} />
              <meshStandardMaterial color="#2f6b34" roughness={0.95} flatShading />
            </instancedMesh>
          </>
        )}
        {showLamps && lamps.length > 0 && (
          <>
            <instancedMesh ref={poleRef} args={[undefined, undefined, lamps.length]} raycast={() => null}>
              <cylinderGeometry args={[0.07, 0.1, 5, 6]} />
              <meshStandardMaterial color="#2b2f3a" metalness={0.6} roughness={0.4} />
            </instancedMesh>
            <instancedMesh ref={headRef} args={[undefined, undefined, lamps.length]} raycast={() => null}>
              <sphereGeometry args={[0.28, 8, 6]} />
              <meshStandardMaterial color="#fff3c4" emissive="#ffd772" emissiveIntensity={preset.lampI} />
            </instancedMesh>
          </>
        )}
      </group>
    </group>
  );
}
