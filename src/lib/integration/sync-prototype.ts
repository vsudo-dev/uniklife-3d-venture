/** In-memory demonstration only. No external connector or production data access. */
export type Side = "app" | "crm";
export interface DemoRecord { id: string; name: string; status: string }
export interface SyncDemo {
  app: DemoRecord[]; crm: DemoRecord[]; baseline: DemoRecord[];
  sequence: Record<Side, number>; checkpoint: Record<Side, number>;
  conflicts: string[]; online: boolean; running: boolean; cycles: number; retries: number;
  lastSync: number | null; lastReconcile: number | null; log: string[];
}
const equal = (a?: DemoRecord, b?: DemoRecord) => JSON.stringify(a) === JSON.stringify(b);
export function initialSyncDemo(): SyncDemo {
  const rows = [{ id: "EMP-008", name: "Anil Varma", status: "Active" }, { id: "PLOT-042", name: "Green Valley · Plot 42", status: "Available" }, { id: "LEAD-012", name: "Sample customer enquiry", status: "New" }];
  return { app: structuredClone(rows), crm: structuredClone(rows), baseline: structuredClone(rows), sequence: { app: 0, crm: 0 }, checkpoint: { app: 0, crm: 0 }, conflicts: [], online: true, running: true, cycles: 0, retries: 0, lastSync: null, lastReconcile: null, log: ["Demo connection authorized. Waiting for the first 15-second check."] };
}
export function editDemo(s: SyncDemo, side: Side, id: string, status: string): SyncDemo {
  return { ...s, [side]: s[side].map(r => r.id === id ? { ...r, status } : r), sequence: { ...s.sequence, [side]: s.sequence[side] + 1 }, log: [`${side === "app" ? "UNIKLIFE" : "CRM"} changed ${id} to ${status}. Queued.`, ...s.log].slice(0, 30) };
}
export function pendingDemo(s: SyncDemo) {
  return s.baseline.filter(b => !equal(s.app.find(r => r.id === b.id), b) || !equal(s.crm.find(r => r.id === b.id), b)).length;
}
export function syncDemo(s: SyncDemo, now: number, reconcile = false): SyncDemo {
  if (!s.online) return { ...s, retries: s.retries + 1, log: ["CRM unavailable. Changes retained; checkpoints unchanged. Retry on the next check.", ...s.log].slice(0, 30) };
  const next = structuredClone(s);
  next.conflicts = [];
  let applied = 0;
  for (let i = 0; i < s.baseline.length; i++) {
    const base = s.baseline[i], a = s.app[i], b = s.crm[i];
    const aChanged = !equal(a, base), bChanged = !equal(b, base);
    if (aChanged && bChanged && !equal(a, b)) { next.conflicts.push(base.id); continue; }
    if (aChanged || bChanged) {
      const winner = aChanged ? a : b;
      next.app[i] = { ...winner }; next.crm[i] = { ...winner }; next.baseline[i] = { ...winner }; applied++;
    }
  }
  if (!next.conflicts.length) next.checkpoint = { ...s.sequence };
  next.cycles++; next.lastSync = now;
  if (reconcile) next.lastReconcile = now;
  next.log = [`${reconcile ? "Full reconciliation" : "15-second delta check"}: ${applied} record(s) synced, ${next.conflicts.length} conflict(s).${next.conflicts.length ? " Manual review required." : " Checkpoints saved."}`, ...s.log].slice(0, 30);
  return next;
}
export function resolveDemo(s: SyncDemo, id: string, winner: Side): SyncDemo {
  if (!s.online || !s.conflicts.includes(id)) return s;
  const chosen = s[winner].find(r => r.id === id)!;
  const replace = (rows: DemoRecord[]) => rows.map(r => r.id === id ? { ...chosen } : r);
  return { ...s, app: replace(s.app), crm: replace(s.crm), baseline: replace(s.baseline), conflicts: s.conflicts.filter(x => x !== id), log: [`Resolved ${id}: kept ${winner === "app" ? "UNIKLIFE" : "CRM"} value.`, ...s.log].slice(0, 30) };
}
