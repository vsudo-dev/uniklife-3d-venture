# Deployment: Supabase (database + storage) · Vercel (hosting) · GoDaddy (domain)

Nothing has been deployed yet. Every step that touches a hosted service needs your accounts and your explicit go-ahead.

## 1. Supabase
1. Create a project (region **Mumbai, ap-south-1**). Keep the database password.
2. Fill `.env.production.local` (git- and Vercel-ignored):
   - `DATABASE_URL` — *Transaction pooler* URI (port 6543)
   - `MIGRATION_DATABASE_URL` — *Session pooler* URI (port 5432)
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `BOOTSTRAP_ADMIN_PASSWORD` (temporary first-admin password)
3. Apply migrations (dry run first):
   ```bash
   npx tsx --env-file=.env.production.local scripts/db-migrate.ts --remote --dry-run
   npx tsx --env-file=.env.production.local scripts/db-migrate.ts --remote --yes-i-am-sure
   ```
4. Private storage bucket: `npx tsx --env-file=.env.production.local scripts/setup-storage.ts`
5. Bootstrap your organization (clean start, no demo accounts):
   ```bash
   npx tsx --env-file=.env.production.local scripts/bootstrap-production.ts --yes-i-am-sure \
     --org-name "ABC Ventures" --org-slug abc-ventures --admin-email you@company.com --admin-name "Your Name" \
     --domain venture.yourcompany.com
   ```

## 2. Vercel
1. `npx vercel login` (browser sign-in), then `npx vercel link` in the project folder.
2. Production environment variables (generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`):

| Variable | Value |
| --- | --- |
| `DATABASE_DRIVER` | `postgres` |
| `DATABASE_URL` | Supabase transaction pooler URI |
| `AUTO_SEED_DEMO` | `false` |
| `APP_BASE_URL` | `https://venture.yourcompany.com` |
| `SESSION_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `CRON_SECRET` | random, ≥ 32 chars |
| `UNIKLIFE_OUTBOUND_SECRET`, `UNIKLIFE_WEBHOOK_SECRET` | random, ≥ 32 chars |
| `UNIKLIFE_LIVE_ENABLED` | `false` |
| `STORAGE_DRIVER` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (service key server-only) |
| `PAYMENT_PROVIDER` | `mock` (all payments SIMULATED until a real gateway is integrated) |
| `VAPID_*` | optional, for push notifications |

3. `npx vercel --prod`. `vercel.json` sets region `bom1` and a **daily** cron (Hobby plan limit). Hold expiry does not depend on the cron (it is enforced on every booking action and by the live viewer stream).

## 3. GoDaddy DNS
- **Subdomain** (e.g. `venture.yourcompany.com`): add it in Vercel → Domains, then in GoDaddy DNS create a **CNAME** with host `venture` and the target value Vercel shows for your project (commonly `cname.vercel-dns.com`; use exactly what Vercel displays).
- **Root domain** (`yourcompany.com`): GoDaddy cannot CNAME the apex — create the **A record** Vercel shows (commonly `76.76.21.21`).
- HTTPS certificates are issued automatically by Vercel after DNS propagates (minutes to hours).
- Map the domain to the tenant: Settings → Branding → Domains (or `--domain` during bootstrap). Each white-label tenant needs its own domain/subdomain for a distinct PWA identity.

## Notes
- Vercel Hobby is for non-commercial use; a business deployment should use Pro.
- Supabase free projects pause after ~1 week without activity.
- In-memory rate limits are per serverless instance; use a shared store (e.g. Upstash Redis) for strict limits at scale.
