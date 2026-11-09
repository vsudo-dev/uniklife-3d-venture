import { makeProjector, type LatLng } from "@/lib/geo";

/**
 * Tile-free route sketch: the recorded fixes as a normalized polyline with start,
 * site and end markers and the geofence circle drawn to scale. North is up.
 */
export function RouteSketch({
  path, centre, radiusM, start, end, last, height = 240,
}: {
  path: LatLng[];
  centre: LatLng | null;
  radiusM: number;
  start: LatLng | null;
  end: LatLng | null;
  last?: LatLng | null;
  height?: number;
}) {
  const W = 360;
  const H = height;
  const all = [...path, ...(centre ? [centre] : []), ...(start ? [start] : []), ...(end ? [end] : [])];
  const proj = makeProjector(all, W, H, 22, centre ? radiusM : 0);
  if (!proj || all.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted" style={{ minHeight: 120 }}>
        No locations recorded for this trip yet{centre ? "" : " (and the venture has no map coordinates)"}.
      </div>
    );
  }
  const pts = path.map(proj.project);
  const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const c = centre ? proj.project(centre) : null;
  const s = start ? proj.project(start) : null;
  const e = end ? proj.project(end) : null;
  const l = last && !end ? proj.project(last) : null;
  const scaleM = niceScale(80 / proj.pxPerM);
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
        aria-label={`Route sketch with ${path.length} recorded point(s)${centre ? ", site geofence" : ""}${start ? ", start" : ""}${end ? ", end" : ""}`}>
        <defs>
          <pattern id="rs-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--border)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#rs-grid)" />
        {c && (
          <circle cx={c.x} cy={c.y} r={Math.max(4, radiusM * proj.pxPerM)} fill="color-mix(in srgb, var(--gold) 14%, transparent)"
            stroke="var(--gold)" strokeWidth="1.2" strokeDasharray="4 3" />
        )}
        {pts.length > 1 && <polyline points={poly} fill="none" stroke="var(--primary)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.6" fill="var(--primary)" opacity="0.6" />)}
        {c && (
          <g>
            <rect x={c.x - 6} y={c.y - 6} width="12" height="12" rx="2" fill="var(--gold)" stroke="var(--surface)" strokeWidth="1.5" />
            <text x={c.x + 9} y={c.y + 4} fontSize="10" fontWeight="700" fill="var(--text)">Site</text>
          </g>
        )}
        {s && <Marker x={s.x} y={s.y} label="S" color="var(--success)" title="Start" />}
        {e && <Marker x={e.x} y={e.y} label="E" color="var(--info)" title="End" />}
        {l && <Marker x={l.x} y={l.y} label="•" color="var(--danger)" title="Last known" />}
        <g transform={`translate(${12}, ${H - 12})`}>
          <line x1="0" y1="0" x2={scaleM * proj.pxPerM} y2="0" stroke="var(--text)" strokeWidth="1.5" />
          <text x="0" y="-4" fontSize="9" fill="var(--muted)">{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</text>
        </g>
        <text x={W - 14} y="18" fontSize="10" fontWeight="700" fill="var(--muted)" textAnchor="middle">N↑</text>
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[0.7rem] text-muted">
        <span><span className="text-success">●</span> Start</span>
        <span><span className="text-gold">■</span> Site{centre ? ` (geofence ${radiusM} m)` : ""}</span>
        <span><span className="text-info">●</span> End</span>
        {l && <span><span className="text-danger">●</span> Last known</span>}
        <span>Sketch only — not a map</span>
      </figcaption>
    </figure>
  );
}

function Marker({ x, y, label, color, title }: { x: number; y: number; label: string; color: string; title: string }) {
  return (
    <g>
      <title>{title}</title>
      <circle cx={x} cy={y} r="8" fill={color} stroke="var(--surface)" strokeWidth="2" />
      <text x={x} y={y + 3.5} fontSize="9" fontWeight="800" fill="#fff" textAnchor="middle">{label}</text>
    </g>
  );
}

function niceScale(m: number): number {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  return steps.reduce((best, s) => (s <= m ? s : best), steps[0]);
}
