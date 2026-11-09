import { NextResponse } from "next/server";
import { cronAuthorized, runScheduledJobs } from "@/lib/integration/cron";

/**
 * GET/POST /api/cron/run — scheduler entry point, protected by `Authorization: Bearer $CRON_SECRET`.
 * Runs: expire stale holds/bookings, due reminders, the UNIKLIFE.AI outbox, the push queue.
 *
 * vercel.json (shared file — add there): { "crons": [{ "path": "/api/cron/run", "schedule": "*\/5 * * * *" }] }
 * (without the backslash). Vercel Cron issues a GET with the Bearer header automatically.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(body: unknown, status: number) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function handleCron(req: Request) {
  const auth = cronAuthorized(req.headers.get("authorization"));
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  try {
    return reply(await runScheduledJobs(), 200);
  } catch (e) {
    console.error("[cron] unhandled:", e instanceof Error ? e.name : "error");
    return reply({ error: "Internal error" }, 500);
  }
}

export const GET = handleCron;
export const POST = handleCron;
