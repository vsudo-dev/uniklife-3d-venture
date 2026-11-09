# Development conventions (read before changing code)

Stack: Next.js 15.5 App Router (React 19), TypeScript strict, Tailwind 4, Zod 3, PGlite (local Postgres) / postgres.js (Supabase), Vitest. ESM project (`"type": "module"`). Windows dev machine, PowerShell.

## Layout
- `supabase/migrations/*.sql` — schema (0001 core, 0002 integrity triggers, 0003 commissions/notifications/site visits/domains, 0004 RLS). Read these to learn table/column names. New migrations: next free number, never edit applied ones.
- `src/lib/db` — `getDb()`, `Queryable.query<T>(sql, params)`, `Database.transaction(fn)`. Numeric/bigint come back as strings → use `num()` from `@/lib/db/types`. Pass arrays/JSON as params with explicit casts (`$1::uuid[]`, `$2::jsonb`).
- `src/lib/auth/context.ts` — `AuthContext` (user, organizationId, role, ventureIds|null, customerId, employee, networkEmployeeIds|null). Helpers: `assertPermission(ctx, perm)`, `can`, `assertStaff`, `canAccessVenture`, `inNetwork`.
- `src/lib/auth/permissions.ts` — roles & permissions. `src/lib/auth/server.ts` — `requirePageContext(perm|"staff"|"customer")` for pages, `getAuthContext()`.
- `src/lib/services/*.ts` — ALL business logic & authorization (server-side). Every function takes `ctx: AuthContext` first and filters by `ctx.organizationId`. Records outside the caller's scope → throw `notFound()` (never leak existence). Mutations: `withTx(async (q) => ...)`, then `writeAudit(q, ctx, {...})` and, where relevant, `enqueueOutboundEvent(q, {...})` (transactional outbox, `src/lib/integration/outbox.ts`).
- Errors: `src/lib/errors.ts` (`badRequest`, `forbidden`, `notFound`, `conflict`, `unprocessable`).
- API routes: `src/app/api/**/route.ts` using `authed()` / `publicRoute()`, `body(req, zodSchema)`, `json(data, status)` from `@/lib/api`. Keep handlers thin — call services.
- Pages: `src/app/(app)/**/page.tsx` are server components inside the authenticated shell. Call `requirePageContext(...)` first, then services directly. Interactive bits → small `"use client"` components that call the API with `api()` / `newIdempotencyKey()` from `@/lib/client/api`, then `router.refresh()`.
- UI kit: `src/components/ui.tsx` (Button, LinkButton, Card, CardHeader, PageHeader, Badge, StatusBadge, PlotStatusBadge, Stat, EmptyState, Notice, Field, BrandMark, cx). CSS utility classes in `globals.css`: `.card .input .label .table .gold-text .premium-hero`. Theme tokens as Tailwind colours: `bg-surface bg-surface-2 border-border text-muted text-primary bg-gold text-gold-strong bg-gold-soft text-success text-warning text-danger`. Icons: `lucide-react`. Formatting: `@/lib/format` (`inr`, `num` (string!), `dateTime`, `date`, `relative`).
- Navigation is already configured in `src/components/shell/nav-config.ts` — do not edit it; just create the routes it points to.

## Rules
- Enforce permissions in services, never only in the UI. Respect network privacy: non-org-wide roles see only `ctx.networkEmployeeIds` records; never expose upline commission rates/earnings to downlines.
- Never put secrets in code, DB rows or logs. Integration secrets are env var NAMES stored in DB, values in env.
- No button may look functional if it is not wired up.
- Mobile-first responsive (works at 360px); accessible labels; no horizontal page scroll (wrap tables in `overflow-x-auto`).
- Do not start/stop/restart the dev server (one is already running on :3000 and shared). Do not delete `.data/`.
- Do not modify files owned by another workstream (see your task). If you need a change in a shared file (`src/lib/db/*`, `src/lib/auth/*`, `src/lib/api.ts`, `src/components/ui.tsx`, `globals.css`, existing migrations), stop and report it instead.
- Tests: Vitest integration tests in `tests/integration/<area>.test.ts` using `tests/support/db.ts` (`createTestDb()`, `ctxFor(db, email)`, `demoVenture`, `plotIds`, `key`). Run only your files: `npx vitest run tests/integration/<file>`. Typecheck with `npx tsc --noEmit` — fix errors in YOUR files; other workstreams may be mid-edit.
- Demo users (password `Demo@12345`): platform@uniklife.local (platform admin), ceo@demo.local (L1, org_admin, EMP-00118), priya (L2), kiran (L3), lakshmi (L4, sales_manager), ravi (L5), sneha (L6), vikram (L7), anil@demo.local (L8, EMP-00125), deepa@demo.local (L5 parallel team under lakshmi), venture.manager@demo.local, customer@demo.local, admin@sample-b.local (second org). Ladder: anil→vikram→sneha→ravi→lakshmi→kiran→priya→ceo.
