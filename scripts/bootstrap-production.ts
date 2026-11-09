/**
 * One-time production bootstrap (Supabase). Creates the platform administrator and
 * the first organization + its administrator — OR loads the clearly-labelled demo
 * data set when --demo is passed.
 *
 *   npx tsx --env-file=.env.production.local scripts/bootstrap-production.ts --yes-i-am-sure \
 *       --org-name "ABC Ventures" --org-slug abc-ventures \
 *       --admin-email you@company.com --admin-name "Your Name" [--domain venture.company.com] [--demo]
 *
 * The temporary password is read from BOOTSTRAP_ADMIN_PASSWORD (env) — it is never
 * printed. Change it after the first sign-in.
 */
import { createPostgresDatabase } from "../src/lib/db/postgres";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.argv.includes("--yes-i-am-sure")) throw new Error("Refusing to modify a production database without --yes-i-am-sure");
  const url = process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is not set");
  const db = createPostgresDatabase(url);
  try {
    const [{ n }] = await db.query<{ n: string }>("select count(*) as n from organizations");
    if (Number(n) > 0) throw new Error("Database already has organizations — bootstrap only runs on an empty database");

    if (process.argv.includes("--demo")) {
      process.env.ALLOW_DEMO_SEED = "true";
      const { seedDemo } = await import("../src/lib/db/seed");
      await seedDemo(db);
      console.log("Demo data loaded (fictional venture, people and approvals; demo password documented in README). Change or disable demo accounts before real use.");
    }

    const email = arg("admin-email");
    const name = arg("admin-name");
    const orgName = arg("org-name");
    const slug = arg("org-slug");
    if (!email || !name || !orgName || !slug) {
      if (process.argv.includes("--demo")) return;
      throw new Error("--admin-email, --admin-name, --org-name and --org-slug are required");
    }
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
    const weak = validatePasswordStrength(password);
    if (weak) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${weak}`);
    const hash = await hashPassword(password);

    await db.transaction(async (q) => {
      const [org] = await q.query<{ id: string }>(
        "insert into organizations (name, slug, app_name, short_name, contact_email) values ($1,$2,$1,$3,$4) returning id",
        [orgName, slug, orgName.slice(0, 12), email],
      );
      const [u] = await q.query<{ id: string }>(
        "insert into app_users (email, full_name, password_hash, is_platform_admin) values ($1,$2,$3,true) returning id",
        [email.toLowerCase(), name, hash],
      );
      await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'org_admin')", [org.id, u.id]);
      await q.query(
        `insert into employees (organization_id, employee_code, user_id, full_name, email, designation, commission_level)
         values ($1, 'EMP-00001', $2, $3, $4, 'Chief Executive Officer', 1)`,
        [org.id, u.id, name, email.toLowerCase()],
      );
      await q.query("update organizations set next_employee_number = 2 where id = $1", [org.id]);
      await q.query(
        `insert into integration_connections (organization_id, provider, name, mode, is_enabled, auth_type, outbound_secret_env, inbound_secret_env)
         values ($1, 'uniklife', 'UNIKLIFE.AI (mock)', 'mock', true, 'hmac', 'UNIKLIFE_OUTBOUND_SECRET', 'UNIKLIFE_WEBHOOK_SECRET')`,
        [org.id],
      );
      const domain = arg("domain");
      if (domain) {
        await q.query("insert into organization_domains (organization_id, domain, is_primary, verified) values ($1, lower($2), true, true)", [org.id, domain]);
      }
      await q.query(
        "insert into audit_logs (organization_id, actor_type, action, entity_type, summary) values ($1, 'system', 'bootstrap', 'organization', 'Production bootstrap')",
        [org.id],
      );
    });
    console.log(`Created organization "${orgName}" and administrator ${email}.`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
