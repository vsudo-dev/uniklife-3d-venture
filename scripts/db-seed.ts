/** Seeds demo data into the LOCAL PGlite database if it is empty. Stop `npm run dev` first. */
import path from "node:path";
import { createPgliteDatabase } from "../src/lib/db/pglite";
import { migrate } from "../src/lib/db/migrate";
import { seedIfEmpty } from "../src/lib/db/seed";

async function main() {
  if (process.env.DATABASE_DRIVER === "postgres") throw new Error("Use scripts/bootstrap-production.ts for hosted databases");
  const db = await createPgliteDatabase(path.resolve(process.cwd(), process.env.PGLITE_DATA_DIR ?? ".data/pglite"));
  await migrate(db);
  console.log((await seedIfEmpty(db)) ? "Demo data seeded." : "Database already has data — nothing to do.");
  await db.close();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
