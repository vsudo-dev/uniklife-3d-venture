# Production readiness checklist

Tick only after verifying in the target environment. Items marked **(blocker)** must be done before accepting real customer money.

## Security & data
- [ ] All secrets set in Vercel (≥ 32 random chars); none in code or the database (integration secrets are env-var *names* in the DB)
- [ ] `AUTO_SEED_DEMO=false`; no demo accounts in production
- [ ] Supabase RLS enabled on all tables (migration 0004/0005); service-role key is server-only
- [ ] Storage bucket is **private**; assets served only via authorization-checked routes
- [ ] Backups: Supabase daily backups / PITR enabled **and a restore test performed** (blocker)
- [ ] Data retention policy for site-visit GPS pings (recommended: purge raw pings after 90 days) and customer data
- [ ] Customer consent & privacy notice text approved by legal (blocker)
- [ ] Shared-store rate limiting (e.g. Upstash Redis) if traffic warrants

## Payments & bookings
- [ ] Real payment gateway integrated with server-side signature verification and refund handling (**blocker** — currently mock/SIMULATED only)
- [ ] Booking acknowledgement / receipt wording approved (blocker)
- [ ] Hold minutes, payment window, booking-amount % configured per organization/venture
- [ ] Concurrency tested on the production database (double-booking prevention relies on unique indexes + row locks)

## Commissions & finance
- [ ] Commission plans configured and approved per venture / property type
- [ ] Clawback policy for cancelled bookings with paid commissions agreed with finance (currently flagged for review, not automated)
- [ ] Settlement & reconciliation process agreed with UNIKLIFE.AI Finance

## Ventures
- [ ] Real venture geometry imported from approved survey drawings (DXF) and **verified** (area deviation report reviewed)
- [ ] Approval references verified against source documents (the app treats them as unverified until a staff member records verification)
- [ ] Venture coordinates and geofence radius set (site-visit auto-arrival)

## Integration
- [ ] UNIKLIFE.AI endpoints, auth and event formats verified in a sandbox; event mappings configured
- [ ] `UNIKLIFE_LIVE_ENABLED=true` only after sign-off; connection verified by an org admin
- [ ] Cron schedule adequate (Vercel Hobby: daily; Pro: every 5 minutes recommended)

## Operations
- [ ] Custom domain + HTTPS live (GoDaddy CNAME → Vercel)
- [ ] Error monitoring (e.g. Sentry) and uptime checks configured
- [ ] Incident response owner and runbook defined
- [ ] Accessibility and performance check on representative low-end Android + iPhone
- [ ] Pilot with a small team; acceptance sign-off
