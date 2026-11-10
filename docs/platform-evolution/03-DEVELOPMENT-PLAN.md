# Development Plan

**Date:** 2026-11-09
**Status:** Draft — NO code changes without explicit approval
**Rule:** Every code change requires user approval before implementation.

---

## Reference: Existing App Patterns (from uniklife-3d.vercel.app source)

### Dashboard Pattern (to replicate for every industry)
The dashboard (`src/app/(app)/dashboard/page.tsx`) follows this structure:
1. **Server component** — calls `requirePageContext("staff")` for auth
2. **Parallel data fetch** — `Promise.all([myHome(ctx), listNotifications(ctx), salesMetrics(ctx)])`
3. **KPI Tiles** — 6-tile grid (enquiries, bookings, site visits, follow-ups, commissions, notifications)
4. **Recent Activity** — Card with recent bookings list
5. **Notifications** — Card with latest notifications
6. **Upcoming Items** — Card with scheduled items (site visits)
7. **Metrics Section** — Stat tiles + Bar chart + Status bar (role-gated: `dashboard.view` permission)

This pattern becomes the **dashboard template**: for each industry, swap the KPI definitions, activity type, and chart data source.

### Service Pattern (every module follows this)
```
Page (server component)
  → requirePageContext(permission)
  → service function(ctx, params)
    → ctx.organizationId filters tenant
    → assertPermission(ctx, perm) for authz
    → withTx(async (q) => { ...SQL... writeAudit(...) enqueueOutboundEvent(...) })
  → render data

API Route (for client components)
  → authed(async (ctx, req) => { ...service call... json(result) })

Client Component ("use client")
  → api("/api/...", { method, body })
  → router.refresh()
```

### Navigation Pattern
- Sidebar nav from `nav-config.ts` — items with `href`, `label`, `icon`, `permission`, `section`
- Grouped into: main, sales, finance, admin
- Filtered by role: `visibleNav(role)`

### Integration Pattern (CRM connection)
- **Outbound:** business change → `enqueueOutboundEvent(q, {...})` in same DB tx → outbox → HTTP POST to CRM webhook URL
- **Inbound:** CRM → POST `/api/webhooks/uniklife/incoming` → verify signature → schema validate → process → update local record
- **Connection config:** per-org row in `integration_connections` with destination URL, auth type, field mappings, mode (mock/live)
- **2-way sync prototype:** delta check every 15s, full reconcile every 15m, conflict resolution queue

---

## Phase 0: Foundation (Estimated: 2–3 weeks)

### Task 0.1: Industry Profile Schema
**Files to create/modify:** New migration `supabase/migrations/0011_industry_profiles.sql`

```sql
-- Industry categories (20 categories)
create table public.industry_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  sort_order integer not null default 0
);

-- Industry profiles (102 profiles, each belongs to a category)
create table public.industry_profiles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references industry_categories(id),
  name text not null,
  slug text not null unique,
  description text,
  is_system_template boolean not null default false,
  cloned_from_id uuid references industry_profiles(id),
  default_roles jsonb not null default '[]',
  default_dashboard_config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Link org to its industry profile
alter table public.organizations
  add column industry_profile_id uuid references industry_profiles(id);

-- Modules available for an industry profile
create table public.industry_modules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references industry_profiles(id) on delete cascade,
  module_slug text not null,
  label text not null,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_universal boolean not null default false,
  submodules jsonb not null default '[]',
  field_definitions jsonb not null default '[]',
  unique (profile_id, module_slug)
);

-- Per-org field mappings (frontend field → CRM field)
create table public.module_field_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  module_id uuid not null references industry_modules(id),
  frontend_field_key text not null,
  crm_field_name text not null,
  crm_field_type text not null default 'text',
  is_custom_field boolean not null default false,
  auto_created boolean not null default false,
  sync_direction text not null default 'both' check (sync_direction in ('app_to_crm', 'crm_to_app', 'both')),
  unique (organization_id, module_id, frontend_field_key)
);
```

**New service:** `src/lib/services/industry-profiles.ts`
**New pages:** `src/app/(app)/platform/templates/page.tsx` (platform admin only)

---

### Task 0.2: Dynamic Navigation
**Files to modify:** `src/components/shell/nav-config.ts`, `src/components/shell/app-nav.tsx`

**Approach:**
1. Keep `NAV_ITEMS` as the fallback (for orgs without an industry profile = legacy Real Estate mode)
2. Add `getNavForOrg(orgId, role)` that reads the org's industry modules from DB
3. Universal modules (Dashboard, Leads, Contacts, Settings, Integration) always inject first
4. Industry modules render based on `industry_modules` rows
5. Nav component calls the new function, falls back to static items

---

### Task 0.3: Dynamic Dashboard
**Files to modify:** `src/app/(app)/dashboard/page.tsx`

**Approach:**
1. Read org's `industry_profile.default_dashboard_config` (or org-level override)
2. Dashboard config is a JSON array of widget definitions:
   ```json
   [
     {"type": "kpi_grid", "widgets": [
       {"key": "leads", "label": "My Leads", "source": "leads.count_mine", "icon": "inbox"}
     ]},
     {"type": "recent_activity", "source": "leads", "limit": 5},
     {"type": "chart_bar", "source": "leads.trend_30d", "label": "New leads — 30 days"},
     {"type": "pipeline", "source": "leads.stages"}
   ]
   ```
3. Widget renderer maps `type` → React component, `source` → service function
4. Existing Real Estate dashboard becomes the default config for the Real Estate profile

---

### Task 0.4: S3/R2 Storage Driver
**Files to modify:** `src/lib/storage.ts`, `src/lib/env.ts`

**Scope:** Add `s3` case to the storage driver switch. Use `@aws-sdk/client-s3` (works with Cloudflare R2, AWS S3, MinIO, etc.).

---

### Task 0.5: Production Sync Engine
**Files to modify:** `src/lib/integration/sync-worker.ts` (refactor from prototype)

**Depends on:** MyAppz CRM API documentation. Until we have it, strengthen the existing webhook-based flow:
1. Per-org sync checkpoints table
2. Server-side cron job (already exists: `/api/cron/run`) extended to poll CRM changes
3. Dead letter queue monitoring UI in platform admin
4. Manual retry/replay from admin panel (already partially built in `/integrations/logs`)

---

## Phase 1: Universal Modules (Estimated: 3–4 weeks)

### Task 1.1: Lead Management Module
**New files:**
```
src/app/(app)/leads/page.tsx             ← Leads list
src/app/(app)/leads/[id]/page.tsx        ← Lead detail
src/app/(app)/leads/pipeline/page.tsx    ← Pipeline/Kanban
src/app/api/leads/route.ts              ← CRUD API
src/lib/services/leads.ts               ← Business logic
src/components/leads/lead-table.tsx      ← List component
src/components/leads/lead-detail.tsx     ← Detail component
src/components/leads/pipeline-board.tsx  ← Kanban component
```

**Migration:** `0012_leads_module.sql` — leads table with universal fields + org-specific custom fields via JSONB.

**CRM sync events:**
- `lead.created` → outbound to CRM
- `lead.updated` → outbound to CRM
- `lead.status_changed` → outbound to CRM
- Inbound `lead.updated` already exists in the event system

---

### Task 1.2: Contacts Module
**Similar structure to leads.** Extends existing `customers` table or adds a universal `contacts` table.

---

### Task 1.3: Platform Admin Panel
**New files:**
```
src/app/(app)/platform/page.tsx                    ← Platform dashboard
src/app/(app)/platform/onboard/page.tsx            ← Client onboarding wizard
src/app/(app)/platform/templates/page.tsx          ← Industry templates browser
src/app/(app)/platform/templates/[id]/page.tsx     ← Template detail/editor
src/app/(app)/platform/clone/page.tsx              ← Clone workflow
src/app/(app)/platform/integrations/page.tsx       ← All-org sync health
src/lib/services/platform.ts                       ← Platform-level operations
```

---

### Task 1.4: Clone System
**Service:** `src/lib/services/platform.ts → cloneOrganization(ctx, sourceOrgId, newOrgName, ...)`

**What gets cloned:**
1. Industry profile reference (same profile, shared)
2. Module configuration (copied, independent)
3. Role definitions (copied)
4. Dashboard widget config (copied)
5. Field mapping templates (copied, CRM field names kept, but connection credentials blank)
6. Webhook event mapping template (copied)

**What is NOT cloned:**
- Data (leads, bookings, contacts, etc.)
- CRM connection credentials (must be set up for new CRM sub-account)
- Custom domain
- Users/staff

---

## Phase 2: Industry Verticals (Estimated: 2–3 weeks per vertical)

### Task 2.1: Wrap Real Estate as Profile Template
- Create the "Real Estate Sales CRM" industry profile in the seed
- Map existing modules (Ventures, Plots, Bookings, etc.) to `industry_modules` rows
- Dashboard config from current dashboard layout
- No functional code changes — purely configuration

### Task 2.2: Hospital Management
- New modules: Patients, OPD/IPD, Billing, Pharmacy, Lab
- New roles: doctor, nurse, receptionist, lab_technician, pharmacist
- Dashboard: patient count, today's appointments, OPD queue, bed occupancy, revenue
- CRM field mappings for patient records

### Task 2.3: School Management
- New modules: Students, Admissions, Fees, Attendance, Timetable
- New roles: principal, teacher, accountant, admission_officer
- Dashboard: enrollment, fee collection, attendance rate, class strength
- CRM field mappings for student records

---

## Phase 3: Scale (Ongoing)

For each new industry within an existing category:
1. Clone the closest existing profile
2. Customize module labels, field names, dashboard widgets
3. Configure CRM field mappings
4. Test webhook flow
5. Go live

**Estimated time per industry after templates exist: 1–2 days** (mostly configuration, not code).

---

## Deployment Strategy

### Single Deployment (Recommended)
```
                    ┌──────────────┐
                    │   Vercel     │
                    │  (one app)   │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    hospital.client1.com  school.client2.com  plots.client3.com
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────┴───────┐
                    │  PostgreSQL  │
                    │  (one DB,    │
                    │  multi-tenant)│
                    └──────────────┘
```

All clients share one Vercel deployment and one database.
Each client gets their own custom domain (CNAME → Vercel).
Tenant resolution: domain → `organization_domains` → `organization_id`.

### Environment Variables (One Set)
```
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://...  (one shared database)
STORAGE_DRIVER=s3
S3_ENDPOINT=...  (one shared bucket with org-prefixed paths)
AUTH_PROVIDER=local
SESSION_SECRET=...
CRON_SECRET=...
```

Per-client CRM credentials are stored as env var NAMES in the database (existing pattern: `integration_connections.outbound_secret_env`), with actual values in Vercel environment variables.

---

## Priority Order

1. **Phase 0.1** — Industry profile schema (unlocks everything else)
2. **Phase 0.2** — Dynamic nav (makes the app profile-aware)
3. **Phase 1.1** — Lead Management (the universal module every client needs first)
4. **Phase 1.3** — Platform admin panel (needed to manage onboarding)
5. **Phase 0.3** — Dynamic dashboard (configurable per industry)
6. **Phase 1.4** — Clone system (enables rapid scaling)
7. **Phase 0.4** — S3 storage driver (needed before prod deployment)
8. **Phase 0.5** — Production sync engine (needed before real CRM connections)
9. **Phase 2.1** — Wrap Real Estate (prove the profile model works)
10. **Phase 2.2/2.3** — Hospital / School (first new verticals)
