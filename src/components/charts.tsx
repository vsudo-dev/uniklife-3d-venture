import { PLOT_STATUS_COLOR, PLOT_STATUS_LABEL } from "@/lib/format";

/** Accessible inline SVG bar chart (no external chart library). */
export function BarTrend({ data, label, format }: { data: { day: string; value: number }[]; label: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 600;
  const h = 140;
  const bw = w / data.length;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="h-40 w-full" role="img" aria-label={`${label}: total ${format ? format(total) : total} over ${data.length} days`}>
        <defs>
          <linearGradient id="barGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--gold)" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1="0" x2={w} y1={h - h * t} y2={h - h * t} stroke="var(--border)" strokeDasharray="3 4" />
        ))}
        {data.map((d, i) => {
          const bh = (d.value / max) * (h - 6);
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${format ? format(d.value) : d.value}`}</title>
              <rect x={i * bw + bw * 0.18} y={h - bh} width={bw * 0.64} height={Math.max(bh, d.value > 0 ? 2 : 0)} rx={3} fill="url(#barGold)" />
            </g>
          );
        })}
        <text x="0" y={h + 14} fontSize="11" fill="var(--muted)">{data[0]?.day.slice(5)}</text>
        <text x={w} y={h + 14} fontSize="11" fill="var(--muted)" textAnchor="end">{data[data.length - 1]?.day.slice(5)}</text>
      </svg>
    </figure>
  );
}

/** Stacked horizontal bar of plot statuses with a legend. */
export function StatusBar({ counts }: { counts: Record<string, number> }) {
  const order = ["available", "held", "reserved", "booked", "sold", "blocked"];
  const total = order.reduce((s, k) => s + (counts[k] ?? 0), 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={order.map((k) => `${PLOT_STATUS_LABEL[k]} ${counts[k] ?? 0}`).join(", ")}>
        {total > 0 &&
          order.map((k) => (counts[k] ?? 0) > 0 && <div key={k} style={{ width: `${((counts[k] ?? 0) / total) * 100}%`, background: PLOT_STATUS_COLOR[k] }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {order.map((k) => (
          <li key={k} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PLOT_STATUS_COLOR[k] }} />{PLOT_STATUS_LABEL[k]}</span>
            <span className="font-bold tabular-nums">{counts[k] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
