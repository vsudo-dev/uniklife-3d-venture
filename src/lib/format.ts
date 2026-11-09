export function inr(amount: number | string | null | undefined, opts: { compact?: boolean } = {}): string {
  const n = typeof amount === "number" ? amount : Number(amount ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (opts.compact) {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  }
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function num(v: number | string | null | undefined, digits = 2): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function date(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
}

export function relative(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(s);
  const fmt = (n: number, u: string) => (s >= 0 ? `${n}${u} ago` : `in ${n}${u}`);
  if (abs < 60) return s >= 0 ? "just now" : "in <1m";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  return fmt(Math.round(abs / 86400), "d");
}

export const PLOT_STATUS_LABEL: Record<string, string> = {
  available: "Available",
  held: "Temporarily Held",
  reserved: "Reserved",
  booked: "Booked",
  sold: "Sold",
  blocked: "Blocked",
};

export const PLOT_STATUS_COLOR: Record<string, string> = {
  available: "#16a34a",
  held: "#eab308",
  reserved: "#f97316",
  booked: "#2563eb",
  sold: "#dc2626",
  blocked: "#6b7280",
};

export const FACING_LABEL: Record<string, string> = {
  N: "North", S: "South", E: "East", W: "West", NE: "North-East", NW: "North-West", SE: "South-East", SW: "South-West",
};
