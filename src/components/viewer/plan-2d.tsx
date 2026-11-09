"use client";

import { useMemo, useRef, useState } from "react";
import { PLOT_STATUS_COLOR, PLOT_STATUS_LABEL } from "@/lib/format";
import { boundsOf, STATUS_SHORT } from "./camera-math";
import { FEATURE_COLORS, type ViewerData } from "./types";
import { useViewer, type ViewerStore } from "./store";

/**
 * Lightweight 2D SVG fallback for devices without WebGL or with low performance.
 * Reads the same live store as the 3D scene; keyboard-accessible plots.
 */
export default function Plan2D({ data, store, onPick }: { data: ViewerData; store: ViewerStore; onPick: (id: string, additive: boolean) => void }) {
  const plots = useViewer(store, (s) => s.plots);
  const selected = useViewer(store, (s) => s.selected);
  const focused = useViewer(store, (s) => s.focused);
  const visible = useViewer(store, (s) => s.visibleStatuses);
  const showLabels = useViewer(store, (s) => s.showLabels);
  const b = useMemo(() => boundsOf([...data.plots.flatMap((p) => (p.polygon ? [p.polygon] : [])), ...data.features.map((f) => f.polygon)]), [data]);
  const size = Math.max(b.width, b.depth);
  const pad = size * 0.04;
  const [zoom,setZoom]=useState(1);
  const [pan,setPan]=useState({x:0,y:0});
  const drag=useRef<{x:number;y:number}|null>(null);
  const w=(b.width+2*pad)/zoom,h=(b.depth+2*pad)/zoom;
  const vb = `${b.cx+pan.x-w/2} ${-b.cy+pan.y-h/2} ${w} ${h}`;
  const pts = (poly: [number, number][]) => poly.map(([x, y]) => `${x},${-y}`).join(" ");
  const sel = new Set(selected);
  return (
    <div className="relative h-full w-full">
    <div className="absolute right-3 top-14 z-10 flex gap-1 rounded-lg bg-white p-1 text-black shadow"><button aria-label="Zoom in layout" className="px-3 py-1 font-bold" onClick={()=>setZoom(z=>Math.min(12,z*1.5))}>+</button><button aria-label="Zoom out layout" className="px-3 py-1 font-bold" onClick={()=>setZoom(z=>Math.max(1,z/1.5))}>−</button><button className="px-2 text-xs" onClick={()=>{setZoom(1);setPan({x:0,y:0});}}>Fit</button></div>
    <svg viewBox={vb} className="h-full w-full touch-none bg-[#0a1430]" role="group" aria-label={`2D layout of ${data.venture.name}`}
      onPointerDown={e=>{if(e.target===e.currentTarget){drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}}
      onPointerMove={e=>{if(drag.current){const r=e.currentTarget.getBoundingClientRect(),scale=Math.min(r.width/w,r.height/h);const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;setPan(p=>({x:p.x-dx/scale,y:p.y-dy/scale}));drag.current={x:e.clientX,y:e.clientY};}}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      {data.venture.layoutImage && <image href={data.venture.layoutImage.url} x={0} y={0} width={data.venture.layoutImage.width*data.venture.layoutImage.unitsPerPixel} height={data.venture.layoutImage.height*data.venture.layoutImage.unitsPerPixel} pointerEvents="none" />}
      {!data.venture.layoutImage && data.features.map((f) => (
        <polygon key={f.id} points={pts(f.polygon)} fill={f.kind === "boundary" ? "none" : FEATURE_COLORS[f.kind] ?? "#555"}
          stroke={f.kind === "boundary" ? "#c9a227" : "none"} strokeDasharray={f.kind === "boundary" ? "2 2" : undefined} strokeWidth={0.4} opacity={0.9}>
          <title>{f.name ?? f.kind}</title>
        </polygon>
      ))}
      {plots.filter((p) => p.polygon).map((p) => {
        const isSel = sel.has(p.id);
        const dim = !visible.has(p.status);
        const xs = p.polygon!.map((q) => q[0]);
        const ys = p.polygon!.map((q) => q[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const w = Math.max(...xs) - Math.min(...xs);
        const fs = Math.min(3, w * 0.36);
        const short = STATUS_SHORT[p.status];
        return (
          <g key={p.id} onClick={(e) => onPick(p.id, e.shiftKey || e.ctrlKey || e.metaKey)} className="cursor-pointer"
            role="button" tabIndex={0} aria-pressed={isSel} aria-label={`Plot ${p.plotNumber}, ${PLOT_STATUS_LABEL[p.status]}${isSel ? ", selected" : ""}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p.id, e.shiftKey); } }}>
            <polygon points={pts(p.polygon!)} fill={PLOT_STATUS_COLOR[p.status] ?? "#999"} fillOpacity={data.venture.layoutImage?(dim ? .03 : .12):(dim ? 0.18 : 0.9)}
              stroke={isSel || focused === p.id ? "#f3dc8a" : "#0b1f5c"} strokeWidth={isSel ? 0.9 : 0.25} />
            {showLabels && !dim && !data.venture.layoutImage && (
              <>
                <text x={cx} y={-cy - (short ? fs * 0.25 : 0)} fontSize={fs} textAnchor="middle" dominantBaseline="central" fill="#fff" fontWeight={700} pointerEvents="none">{p.plotNumber}</text>
                {short && <text x={cx} y={-cy + fs * 0.75} fontSize={fs * 0.42} textAnchor="middle" dominantBaseline="central" fill="#fff5d6" fontWeight={800} pointerEvents="none">{short}</text>}
              </>
            )}
          </g>
        );
      })}
    </svg></div>
  );
}
