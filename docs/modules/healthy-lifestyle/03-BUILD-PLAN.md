# Healthy Lifestyle Module — Build Plan

**Date:** 2026-11-09
**Approach:** Senior developer + SaaS engineer — build the platform foundation first, then the industry-specific UI.
**Rule:** Every code change requires explicit user approval before implementation.

---

## Build Strategy

**Phase 1** builds the foundation that ALL future industries will use (industry profiles, dynamic nav, dynamic dashboard). This is the hardest and most important phase — get it right and every subsequent industry is just config + UI components.

**Phase 2** builds the Healthy Lifestyle specific UI (Parenting Coaching + DMIT screens).

**Phase 3** wires up CRM sync and tests end-to-end.

---

## Phase 1: Platform Foundation (Required for ANY new industry)

### Task 1.1 — Industry Profile Schema (Database Migration)

**What:** Create the tables that define what modules, submodules, and fields each industry has.

**New migration file:** `supabase/migrations/0010_industry_profiles.sql`

```sql
-- Industry categories (Health & Wellness, Education, Real Estate, etc.)
CREATE TABLE industry_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "Health & Wellness"
  slug TEXT NOT NULL UNIQUE,             -- "health-wellness"
  icon TEXT,                             -- icon identifier
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Industries within a category
CREATE TABLE industry_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES industry_categories(id),
  name TEXT NOT NULL,                    -- "Healthy Lifestyle"
  slug TEXT NOT NULL UNIQUE,             -- "healthy-lifestyle"
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Modules for an industry (sidebar sections)
CREATE TABLE industry_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id UUID NOT NULL REFERENCES industry_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Parenting Coaching"
  slug TEXT NOT NULL,                    -- "parenting-coaching"
  icon TEXT NOT NULL,                    -- lucide icon name
  section TEXT NOT NULL,                 -- sidebar section: "main", "coaching", "dmit", "finance", "admin"
  sort_order INT NOT NULL DEFAULT 0,
  is_required BOOLEAN DEFAULT false,     -- Dashboard, Settings always required
  UNIQUE(industry_id, slug)
);

-- Submodules (pages within a module)
CREATE TABLE industry_submodules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES industry_modules(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Sessions"
  slug TEXT NOT NULL,                    -- "sessions"
  href TEXT NOT NULL,                    -- "/sessions"
  icon TEXT,
  permission TEXT,                       -- required permission to see this
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(module_id, slug)
);

-- Field definitions for an industry (what data to capture)
CREATE TABLE industry_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id UUID NOT NULL REFERENCES industry_profiles(id) ON DELETE CASCADE,
  module_slug TEXT NOT NULL,             -- which module this field belongs to
  field_key TEXT NOT NULL,               -- "child_name"
  field_label TEXT NOT NULL,             -- "Child Name"
  field_type TEXT NOT NULL,              -- "text", "number", "date", "dropdown", "multiselect", "file"
  options JSONB,                         -- dropdown/multiselect options
  is_required BOOLEAN DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(industry_id, field_key)
);

-- CRM field mappings (frontend field → CRM field)
CREATE TABLE industry_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  field_definition_id UUID NOT NULL REFERENCES industry_field_definitions(id),
  crm_field_name TEXT NOT NULL,          -- "{{contact.child_name}}"
  crm_object TEXT NOT NULL DEFAULT 'contact',  -- "contact", "opportunity", "custom"
  sync_direction TEXT NOT NULL DEFAULT 'both', -- "app_to_crm", "crm_to_app", "both"
  is_custom_field BOOLEAN DEFAULT true,
  auto_created BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, field_definition_id)
);

-- Link organizations to their industry profile
ALTER TABLE organizations
  ADD COLUMN industry_profile_id UUID REFERENCES industry_profiles(id);
```

**Files to modify:**
- `supabase/migrations/0010_industry_profiles.sql` — new
- `src/lib/db/index.ts` — add migration to auto-migrate list (PGlite)

---

### Task 1.2 — Industry Profile Service

**What:** Service layer for CRUD on industry profiles, modules, fields, mappings.

**New file:** `src/lib/services/industry-profiles.ts`

```
Functions:
- listCategories(auth)
- getIndustryProfile(auth, industryId)
- getModulesForIndustry(auth, industryId) → nav items
- getFieldDefinitions(auth, industryId, moduleSlug)
- getFieldMappings(auth, organizationId)
- createFieldMapping(auth, data)
- cloneIndustryProfile(auth, sourceId, newName) → deep-copy for customization
```

**Pattern:** Same as existing services — takes `AuthContext` first, filters by `organizationId`.

---

### Task 1.3 — Dynamic Sidebar Navigation

**What:** Replace the static `nav-config.ts` with a dynamic system that reads modules from the industry profile.

**Files to modify:**
- `src/components/shell/nav-config.ts` — keep as fallback for Real Estate (no industry_profile_id)
- `src/components/shell/sidebar.tsx` (or equivalent) — fetch nav items from industry profile if org has one
- New: `src/lib/services/navigation.ts` — `getNavItems(auth)` → merges industry modules with universal items

**Logic:**
```
if (organization.industry_profile_id) {
  // Dynamic: fetch modules from industry_modules table
  navItems = await getModulesForIndustry(auth, org.industry_profile_id)
} else {
  // Fallback: existing static Real Estate nav
  navItems = NAV_ITEMS
}
```

---

### Task 1.4 — Dynamic Dashboard

**What:** Dashboard KPIs driven by industry profile config instead of hardcoded Real Estate metrics.

**New table (in same migration):**
```sql
CREATE TABLE industry_dashboard_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id UUID NOT NULL REFERENCES industry_profiles(id) ON DELETE CASCADE,
  widget_type TEXT NOT NULL,         -- "kpi_tile", "chart", "list", "card"
  title TEXT NOT NULL,
  data_source TEXT NOT NULL,         -- service function to call
  position INT NOT NULL DEFAULT 0,
  config JSONB,                      -- widget-specific config (icon, color, format)
  UNIQUE(industry_id, position)
);
```

**Files to modify:**
- `src/app/(app)/dashboard/page.tsx` — conditionally render widgets from config
- New: `src/lib/services/dashboard.ts` — `getDashboardData(auth)` → returns KPIs based on industry

---

### Task 1.5 — Seed Data: Healthy Lifestyle Profile

**New file:** `supabase/seeds/healthy-lifestyle.sql`

Seeds the industry_categories, industry_profiles, industry_modules, industry_submodules, and industry_field_definitions for the Healthy Lifestyle module with Parenting Coaching and DMIT submodules.

---

## Phase 2: Healthy Lifestyle UI

### Task 2.1 — Parenting Coaching Pages

**New files (all under `src/app/(app)/`):**

| File | What |
|------|------|
| `sessions/page.tsx` | Sessions list — table/cards with filters |
| `sessions/[id]/page.tsx` | Session detail — notes, action items, progress |
| `sessions/new/page.tsx` | Schedule new session form |
| `programs/page.tsx` | Programs list — active coaching packages |
| `programs/[id]/page.tsx` | Program detail — enrolled clients, schedule |
| `progress/page.tsx` | Progress tracker — all clients' goals |
| `progress/[clientId]/page.tsx` | Individual client progress with charts |
| `resources/page.tsx` | Resource library — filterable list |

**New service files:**
| File | Functions |
|------|-----------|
| `src/lib/services/sessions.ts` | listSessions, getSession, createSession, updateSession, completeSession |
| `src/lib/services/programs.ts` | listPrograms, getProgram, createProgram, enrollClient |
| `src/lib/services/progress.ts` | listGoals, createGoal, updateProgress, getClientProgress |
| `src/lib/services/resources.ts` | listResources, createResource, shareWithClient |

**New migration:** `supabase/migrations/0011_coaching_tables.sql`
- `coaching_sessions` table
- `coaching_programs` table
- `coaching_enrollments` table
- `coaching_goals` table
- `coaching_progress_entries` table
- `coaching_resources` table

---

### Task 2.2 — DMIT Pages

**New files (all under `src/app/(app)/dmit/`):**

| File | What |
|------|------|
| `tests/page.tsx` | Tests list — status pipeline view |
| `tests/[id]/page.tsx` | Test detail — status timeline, fingerprints, report link |
| `tests/new/page.tsx` | New test registration + scheduling |
| `reports/page.tsx` | Reports list — generated reports |
| `reports/[id]/page.tsx` | Report viewer — charts + PDF download |
| `counseling/page.tsx` | Counseling sessions list |
| `batches/page.tsx` | School batch management |
| `batches/[id]/page.tsx` | Batch detail — student list, progress |

**New service files:**
| File | Functions |
|------|-----------|
| `src/lib/services/dmit-tests.ts` | listTests, getTest, createTest, updateTestStatus, collectScan |
| `src/lib/services/dmit-reports.ts` | listReports, getReport, generateReport, deliverReport |
| `src/lib/services/dmit-counseling.ts` | listSessions, scheduleCounseling, completeCounseling |
| `src/lib/services/dmit-batches.ts` | listBatches, createBatch, importStudents, updateBatchProgress |

**New migration:** `supabase/migrations/0012_dmit_tables.sql`
- `dmit_tests` table
- `dmit_reports` table
- `dmit_counseling_sessions` table
- `dmit_batches` table
- `dmit_batch_students` table

---

### Task 2.3 — Client Portal (Parent View)

**New files:**

| File | What |
|------|------|
| `portal/page.tsx` | Parent's home — upcoming sessions, recent reports |
| `portal/sessions/page.tsx` | My sessions list |
| `portal/reports/page.tsx` | My DMIT reports |
| `portal/progress/page.tsx` | My goals & progress |
| `portal/resources/page.tsx` | My assigned resources |

**Access control:** `customer` role sees only portal routes. Existing `requirePageContext("customer")` pattern.

---

## Phase 3: CRM Integration

### Task 3.1 — New Event Types

Add to `src/lib/integration/events.ts`:

```
// Parenting Coaching events
"enquiry.created"
"consultation.scheduled"
"client.enrolled"
"session.completed"
"session.cancelled"
"goal.created"
"goal.achieved"
"payment.verified"

// DMIT events
"dmit.client.registered"
"dmit.test.scheduled"
"dmit.scan.collected"
"dmit.report.generated"
"dmit.report.delivered"
"dmit.counseling.scheduled"
"dmit.counseling.completed"
"dmit.batch.created"
"dmit.payment.verified"
```

### Task 3.2 — CRM Custom Fields Setup

Manually create custom fields in CRM for testing. Document the merge tags. Map them in `industry_field_mappings`.

### Task 3.3 — End-to-End Test

1. Create enquiry in frontend → verify contact created in CRM
2. Schedule session → verify appointment in CRM
3. Update lead status in CRM → verify enquiry status changes in frontend
4. Deliver DMIT report → verify activity logged in CRM
5. Payment → verify in CRM Finance

---

## Priority Order

```
Week 1:  Task 1.1 (schema) + Task 1.2 (service) + Task 1.5 (seed data)
Week 2:  Task 1.3 (dynamic nav) + Task 1.4 (dynamic dashboard)
Week 3:  Task 2.1 (coaching pages — sessions, programs)
Week 4:  Task 2.1 continued (progress, resources) + Task 2.3 (portal)
Week 5:  Task 2.2 (DMIT pages — tests, reports)
Week 6:  Task 2.2 continued (counseling, batches) + Task 3.1 (events)
Week 7:  Task 3.2 (CRM fields) + Task 3.3 (end-to-end testing)
Week 8:  Polish, fix, deploy
```

---

## What I Need Your Approval On

Before writing any code, I need you to approve:

1. **The database schema** (Task 1.1) — industry profiles + field definitions + mappings
2. **The approach** — dynamic nav from DB vs. config file
3. **Which task to start with** — I recommend Task 1.1 (schema) since everything else depends on it
4. **File locations** — the proposed paths above

Tell me which task to begin, and I'll show you the exact code changes for your approval before writing anything.
