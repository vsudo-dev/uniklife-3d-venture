/**
 * Recreates the LOCAL PGlite development database (migrations + demo seed).
 * Stop `npm run dev` first — PGlite data files must not be shared by two processes.
 * Never touches a hosted database.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { createPgliteDatabase } from "../src/lib/db/pglite";
import { migrate } from "../src/lib/db/migrate";
import { seedDemo } from "../src/lib/db/seed";

async function main() {
  if (process.env.DATABASE_DRIVER === "postgres") throw new Error("db:reset only works on the local PGlite database");
  const dir = path.resolve(process.cwd(), process.env.PGLITE_DATA_DIR ?? ".data/pglite");
  if (!dir.includes(`${path.sep}.data${path.sep}`)) throw new Error(`Refusing to delete unexpected path ${dir}`);
  await rm(dir, { recursive: true, force: true });
  const db = await createPgliteDatabase(dir);
  console.log("Applied:", (await migrate(db)).join(", "));
  if (!process.argv.includes("--no-seed")) {
    await seedDemo(db);
    console.log("Demo data seeded (password Demo@12345 for all demo users).");
  }
  await db.close();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
