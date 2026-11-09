# Local review: continuous integration and Staff & Access

Start with `npm run dev:prototype`. The server listens on port **3015** and uses
the separate `.data/sync-prototype` PGlite demo database. No production database
or live connector is used by this launcher. The user authorized publication of the reviewed prototype and navigation changes on November 6, 2026.

- No-login demonstration: http://localhost:3015/prototype/integration-sync
- In-app prototype tab: http://localhost:3015/integrations/sync-lab
- Combined people workspace: http://localhost:3015/staff
- Existing API and Webhooks: http://localhost:3015/integrations
- Demo administrator: `ceo@demo.local` / `Demo@12345`.

The no-login preview route returns 404 in production. The integration tab uses
the existing integration.manage permission. Staff sections retain their existing
server-side permission checks. Settings is the final sidebar group. Delivery and
audit logs now live in the integration workspace navigation; their routes remain.

## First action and review scenarios

The first scenario changes Plot 42 to On hold in Application A while Application B
is Available. After 15 seconds, Application B receives the change. Reset restarts
this scenario. The two application panels are simulated, in-memory records.

1. Change a record in either panel. Wait 15 seconds or select Sync now.
2. Simulate CRM offline, change a record, and sync. Checkpoints must stay unchanged.
   Reconnect and sync again; the retained change is applied.
3. Pause checks. Give the same record different values on both sides. Sync now:
   both values stay intact until you choose which one to keep.
4. Reconcile now runs a full record comparison. Automatic full reconciliation
   runs every 15 minutes while the active browser timer runs.

Staff & Access has directory, login and access, role/authentication matrix,
organization reporting chart, existing commission plan tools, and leadership
groups based on employee designations. Leadership titles, reporting relationships,
commission eligibility and system login roles remain distinct concepts.

## Production model proposed for approval

Use a durable, always-running worker with a change log/outbox or provider change
feed, an authenticated adapter for each application, per-tenant checkpoints,
idempotent writes, origin markers to avoid echo loops, controlled retries and
conflict review. Poll changes every 15 seconds from the **last acknowledged
checkpoint**, rather than just the most recent 15-second timestamp window. Fully
reconcile every 15 minutes. Add deletion tombstones, pagination, rate-limit
backoff, a dead-letter queue, schema mapping, token renewal, monitoring and a
restart/catch-up test before production use. No page reload is required.

MCP is an optional interface for AI tools such as inspecting sync health or
requesting reconciliation; it does not replace a sync worker or provide access
to another application without its authorization and supported APIs/feed.
Authorize once where supported, then renew credentials automatically. Provider
registration or consent cannot generally be eliminated.

The present prototype has **no real external connector, durable queue, background
worker, token refresh or MCP server**. Closing or backgrounding the page stops or
slows the browser timers; reloading resets its data. Its record-level conflict
policy is deliberately conservative. The user authorized publishing this demonstration.
Real external connectors, an always-running worker and an MCP server remain future implementation.

References:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://www.postgresql.org/docs/current/logicaldecoding.html
