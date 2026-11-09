@echo off
REM Starts the PRODUCTION build on :3100 against a separate local PGlite database
REM (.data/pglite-e2e) for browser tests. Test-only secrets — never use in a real deployment.
set NEXT_DIST_DIR=.next-build
set NODE_ENV=production
set PGLITE_DATA_DIR=.data/pglite-e2e
set AUTO_SEED_DEMO=false
set APP_BASE_URL=http://localhost:3100
set SESSION_SECRET=e2e-only-session-secret-0123456789abcdefghij
set PAYMENT_WEBHOOK_SECRET=e2e-only-payment-secret-0123456789abcdefghij
set CRON_SECRET=e2e-only-cron-secret-0123456789abcdefghijklmn
set UNIKLIFE_OUTBOUND_SECRET=e2e-only-uniklife-outbound-0123456789
set UNIKLIFE_WEBHOOK_SECRET=e2e-only-uniklife-inbound-0123456789
npx next start -p 3100
