import { createHash, timingSafeEqual } from "node:crypto";
import { requireSecret } from "@/lib/env";
import { withTx } from "@/lib/services/common";
import { expireStale } from "@/lib/services/bookings";
import { processDueReminders } from "@/lib/services/notifications";
import { processPushQueue } from "@/lib/push";
import { processOutbox } from "./dispatcher";
import { sanitizeText } from "./sanitize";

// Scheduler entry point (GET/POST /api/cron/run, or `npm run outbox:process`).
//
// Vercel Cron (vercel.json is a shared file, not created here) would be:
//   { "crons": [{ "path": "/api/cron/run", "schedule": "*/5 * * * *" }] }
// Vercel sends `Authorization: Bearer $CRON_SECRET` (GET) automatically when CRON_SECRET is set.
// Note: Vercel Hobby plans only allow daily crons; use an external scheduler for 5-minute runs there.
export function cronAuthorized(authHeader: string | null): { ok: true } | { ok: false; status: number; error: string } {
  let secret: string;
  try {
    secret = requireSecret("CRON_SECRET");
  } catch {
    return { ok: false, status: 503, error: "Scheduler not configured" };
  }
  if (!authHeader) return { ok: false, status: 401, error: "Unauthorized" };
  // Compare fixed-length digests so the comparison is constant-time regardless of input length.
  const a = createHash("sha256").update(authHeader).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401, error: "Unauthorized" };
}

type JobResult = { ok: true; result: unknown } | { ok: false; error: string };

async function job(fn: () => Promise<unknown>): Promise<JobResult> {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    const error = sanitizeText(e, { max: 300 });
    console.error("[cron] job failed:", error);
    return { ok: false, error };
  }
}

export async function runScheduledJobs() {
  const startedAt = new Date().toISOString();
  // Each job is independent: one failing never blocks the others.
  const expire = await job(() => withTx((q) => expireStale(q)));
  const reminders = await job(() => processDueReminders());
  const outbox = await job(async () => {
    const s = await processOutbox({ limit: 100 });
    return { claimed: s.claimed, delivered: s.delivered, failed: s.failed, deadLettered: s.deadLettered };
  });
  const push = await job(() => processPushQueue());
  return { startedAt, finishedAt: new Date().toISOString(), jobs: { expireStale: expire, reminders, outbox, push } };
}
