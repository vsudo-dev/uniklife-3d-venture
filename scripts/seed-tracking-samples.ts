/**
 * Adds SAMPLE site-visit trips (Hyderabad → Zaheerabad demo venture → back).
 *   Local (stop `npm run dev` first):  npx tsx scripts/seed-tracking-samples.ts [--force]
 *   Hosted test DB:                    npx tsx --env-file=.env.production.vercel.local scripts/seed-tracking-samples.ts --remote --yes-i-am-sure [--force]
 */
import path from "node:path";
import { createPgliteDatabase } from "../src/lib/db/pglite";
import { createPostgresDatabase } from "../src/lib/db/postgres";
import { migrate } from "../src/lib/db/migrate";
import { seedTrackingSamples } from "../src/lib/demo/tracking-samples";

async function main() {
  const force = process.argv.includes("--force");
  if (process.argv.includes("--remote")) {
    if (!process.argv.includes("--yes-i-am-sure")) throw new Error("Refusing to write to a remote database without --yes-i-am-sure");
    const url = process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
    if (!url) throw new Error("No database URL in environment");
    const db = createPostgresDatabase(url);
    try {
      console.log(await db.transaction((q) => seedTrackingSamples(q, { force })));
    } finally {
      await db.close();
    }
    return;
  }
  const db = await createPgliteDatabase(path.resolve(process.cwd(), process.env.PGLITE_DATA_DIR ?? ".data/pglite"));
  await migrate(db);
  console.log(await db.transaction((q) => seedTrackingSamples(q, { force })));
  await db.close();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
