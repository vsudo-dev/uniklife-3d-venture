/**
 * `npm run outbox:process` — runs the scheduled jobs once (expire stale holds/bookings,
 * due reminders, UNIKLIFE.AI outbox dispatch, push queue) and prints a summary.
 *   --outbox-only   only dispatch the outbox
 *   --limit=N       outbox batch size (default 100)
 *
 * WARNING (local PGlite): do not run this against the same PGLITE_DATA_DIR as a running
 * dev server — PGlite is single-process. Use the authenticated /api/cron/run endpoint instead.
 */
import { spawnSync } from "node:child_process";

// Server modules import "server-only", which only resolves to a no-op under the
// "react-server" export condition. Re-run this script with that condition.
if (!process.execArgv.some((a) => a.includes("react-server")) && !process.env.__OUTBOX_CHILD) {
  const r = spawnSync(process.execPath, [...process.execArgv, "--conditions=react-server", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, __OUTBOX_CHILD: "1" },
  });
  process.exit(r.status ?? 1);
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 100) : 100;
  if (args.includes("--outbox-only")) {
    const { processOutbox } = await import("../src/lib/integration/dispatcher");
    const s = await processOutbox({ limit });
    console.log(JSON.stringify({ claimed: s.claimed, delivered: s.delivered, failed: s.failed, deadLettered: s.deadLettered }, null, 2));
  } else {
    const { runScheduledJobs } = await import("../src/lib/integration/cron");
    console.log(JSON.stringify(await runScheduledJobs(), null, 2));
  }
  const { getDb } = await import("../src/lib/db");
  await (await getDb()).close();
}

main().catch((e) => {
  console.error("[outbox] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
