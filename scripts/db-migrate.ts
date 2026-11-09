/**
 * Applies supabase/migrations to a database.
 *
 *   Local PGlite (default):  npm run db:migrate
 *   Remote (Supabase):       npx tsx --env-file=.env.production.local scripts/db-migrate.ts --remote --yes-i-am-sure
 *
 * Remote runs use MIGRATION_DATABASE_URL (Supabase *session* pooler or direct
 * connection, port 5432) and refuse to run without both flags. Connection strings
 * are never printed.
 */
import path from "node:path";
import { createPgliteDatabase } from "../src/lib/db/pglite";
import { createPostgresDatabase } from "../src/lib/db/postgres";
import { listMigrations, migrate } from "../src/lib/db/migrate";

const remote = process.argv.includes("--remote");
const confirmed = process.argv.includes("--yes-i-am-sure");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (remote) {
    const url = process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
    if (!url) throw new Error("MIGRATION_DATABASE_URL (or POSTGRES_URL_NON_POOLING / DATABASE_URL) is not set");
    const host = new URL(url).hostname;
    console.log(`Target: remote PostgreSQL at ${host}`);
    const all = await listMigrations();
    console.log(`Migrations on disk: ${all.map((m) => m.name).join(", ")}`);
    if (dryRun) return;
    if (!confirmed) throw new Error("Refusing to migrate a remote database without --yes-i-am-sure");
    const db = createPostgresDatabase(url);
    try {
      const ran = await migrate(db);
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Already up to date");
    } finally {
      await db.close();
    }
    return;
  }
  const dir = path.resolve(process.cwd(), process.env.PGLITE_DATA_DIR ?? ".data/pglite");
  const db = await createPgliteDatabase(dir);
  const ran = await migrate(db);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Already up to date");
  await db.close();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
