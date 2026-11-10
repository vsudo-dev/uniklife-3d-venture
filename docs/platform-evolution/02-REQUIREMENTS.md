# Requirements Specification

**Date:** 2026-11-09
**Status:** Draft — awaiting approval

---

## Phase 0: Foundation (Make Multi-Industry Ready)

### REQ-F01: Industry Profile Configuration Schema

**What:** Database tables and admin UI to define industry profiles (category, industry name, active modules, submodules, field definitions, role definitions, dashboard widgets).

**Schema (proposed):**
```
industry_categories
  id, name, slug, icon, sort_order

industry_profiles
  id, category_id, name, slug, description, is_template, cloned_from_id
  default_modules (jsonb), default_roles (jsonb), default_dashboard (jsonb)

organization_industry_profile
  organization_id, industry_profile_id
  (links a client org to its industry profile)

industry_modules
  id, profile_id, module_slug, label, icon, sort_order, is_active
  submodules (jsonb: [{slug, label, icon, route_pattern}])
  field_definitions (jsonb: [{field_key, label, type, crm_field_name, required}])

module_field_mappings
  id, organization_id, module_id, frontend_field_key, crm_field_name
  crm_field_type, is_custom_field, auto_created, sync_direction (app→crm | crm→app | both)
```

**Why:** The current nav and modules are hardcoded for Real Estate. To support 102 industries, modules must be data-driven.

**Acceptance:**
- Platform admin can create/edit industry profiles
- Modules and submodules render dynamically from config
- Existing Real Estate module continues to work as "Real Estate Sales CRM" profile

---

### REQ-F02: Dynamic Navigation

**What:** Replace the hardcoded `nav-config.ts` with navigation generated from the organization's active industry profile and modules.

**Current:** `NAV_ITEMS` array with static routes.
**Target:** `getNavForOrg(orgId)` → reads `industry_modules` for the org's profile → returns nav items.

**Constraints:**
- Universal modules (Dashboard, Leads, Contacts, Settings, Integration) always present
- Industry-specific modules appear based on profile config
- Per-role filtering continues to work (permission system unchanged)
- Platform admin sees all modules across all orgs

---

### REQ-F03: Dynamic Dashboard Widgets

**What:** Dashboard page renders a configurable grid of widgets based on the org's industry profile.

**Widget types:**
- KPI stat tiles (count, sum, percentage)
- Chart widgets (bar, line, pie — connected to module data)
- Activity feed (recent events, from notification system)
- Pipeline/funnel (lead stages, booking stages, etc.)
- Quick actions (industry-specific shortcuts)

**Config stored in:** `industry_profiles.default_dashboard` (jsonb) + per-org override in `organization_dashboard_config`.

---

### REQ-F04: Storage Driver (S3/R2)

**What:** Add an S3-compatible storage driver alongside the existing `local` and `supabase` drivers.

**Env vars:**
```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com
S3_BUCKET=uniklife-assets
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
```

**Why:** Supabase Storage is fine but couples us. S3/R2 is universal, cheaper at scale, and works with Cloudflare R2 (no egress fees).

**Scope:** ~50–80 lines in `src/lib/storage.ts` (new `s3` case in `putObject`, `getObject`, `deleteObject`). No other files change.

---

### REQ-F05: Production Sync Worker

**What:** Harden the 2-way sync from a client-side prototype to a server-side production system.

**Current state:** Browser-only in-memory demo (`sync-prototype.ts`). Outbound events use the transactional outbox (production-ready). Inbound webhook exists (production-ready).

**Required:**
1. Server-side sync worker (cron-triggered or long-running on a worker platform)
2. Per-org sync checkpoints persisted in DB
3. Polling CRM changes since last checkpoint (requires CRM API — MyAppz-specific)
4. Conflict detection and resolution queue
5. Dead-letter queue for failed syncs
6. Admin dashboard: sync status per org, last sync time, errors, manual retry

**Depends on:** MyAppz CRM API documentation (what endpoints are available for reading changes).

---

## Phase 1: Universal Modules

### REQ-U01: Lead Management Module

**What:** The core module every industry needs — leads list, detail, pipeline view, assignment, CRM sync.

**Submodules:**
| Submodule | Route | Description |
|-----------|-------|-------------|
| Leads list | `/leads` | Filterable, sortable table with status badges |
| Lead detail | `/leads/[id]` | Full lead view with activity timeline, notes, CRM sync status |
| Pipeline | `/leads/pipeline` | Kanban board (stages configurable per industry) |
| Assignment | — | Auto/manual lead assignment to staff based on rules |
| Import | `/leads/import` | CSV import with field mapping |

**CRM sync:**
- Lead created in frontend → webhook fires → creates lead in CRM
- Lead updated in CRM → inbound webhook → updates in frontend
- Field mapping: configurable per org (which frontend field maps to which CRM field)

**Roles:**
- CEO/Admin: sees all leads, can reassign
- Manager: sees team leads
- Executive: sees own leads only
- Customer: not applicable

---

### REQ-U02: Contacts/Customers Module

**What:** Universal contact directory synced with CRM contacts.

**Submodules:**
| Submodule | Route | Description |
|-----------|-------|-------------|
| Directory | `/contacts` | Searchable contact list |
| Detail | `/contacts/[id]` | Contact profile, communication history, linked records |
| Import | `/contacts/import` | CSV + CRM bulk sync |

---

### REQ-U03: Enhanced Platform Admin Panel

**What:** The operations center for UNIKLIFE platform owner.

**Submodules:**
| Submodule | Route | Description |
|-----------|-------|-------------|
| Client onboarding wizard | `/platform/onboard` | Step-by-step: select industry → configure → connect CRM → go live |
| Industry templates | `/platform/templates` | Browse/create/edit industry profile templates |
| Clone workflow | `/platform/clone` | Clone existing client config for same-industry new client |
| Integration health | `/platform/integrations` | All orgs' sync status, failures, dead letters |
| Module library | `/platform/modules` | Available modules, field definitions, mapping templates |
| Billing overview | `/platform/billing` | Client usage, plan tiers (future) |

---

### REQ-U04: Configurable Role System

**What:** Extend the current fixed role set to support industry-specific roles while keeping universal roles.

**Universal roles (always present):**
- `platform_admin` — UNIKLIFE platform owner
- `org_admin` — Client CEO / Owner
- `customer` — End customer (if applicable)

**Industry roles (defined per profile):**
- Real Estate: `venture_manager`, `sales_manager`, `sales_executive`
- Hospital: `doctor`, `nurse`, `receptionist`, `lab_technician`, `pharmacist`
- School: `principal`, `teacher`, `accountant`, `admission_officer`
- etc.

**Implementation:** `industry_profiles.default_roles` defines available roles per industry. `organization_members.role` stores the actual role (still a text field, validated against the profile's role list).

---

## Phase 2: First Industry Verticals

### REQ-V01: Real Estate Sales CRM (Already Built)

**Status:** Complete. Becomes the first industry profile template.
**Modules:** Ventures, Plot Inventory, Bookings, Commissions, Site Visits, Enquiries, Network
**Action:** Wrap existing code as the "Real Estate Sales CRM" profile. No functional changes.

---

### REQ-V02: Hospital Management (New)

**Modules:**
| Module | Submodules |
|--------|-----------|
| Patients | Registration, Directory, Medical Records, History |
| OPD/IPD | Appointments, Queue, Admissions, Discharge |
| Billing | Invoice, Payments, Insurance Claims |
| Pharmacy | Inventory, Prescriptions, Dispensing |
| Lab | Test Orders, Results, Reports |
| Staff | Doctors, Nurses, Shifts, Attendance |

**CRM fields to map:** Patient name, phone, email, doctor, department, diagnosis, appointment date, bill amount, payment status, insurance ID.

---

### REQ-V03: School Management (New)

**Modules:**
| Module | Submodules |
|--------|-----------|
| Students | Registration, Directory, Academic Records |
| Admissions | Applications, Entrance Tests, Enrollment |
| Fees | Fee Structure, Collection, Receipts, Defaulters |
| Attendance | Daily, Subject-wise, Reports |
| Timetable | Class Schedule, Teacher Schedule |
| Staff | Teachers, Admin, Attendance, Payroll |

**CRM fields to map:** Student name, parent name, phone, email, class, section, fee amount, payment status, admission date, roll number.

---

## Non-Functional Requirements

### NFR-01: Performance
- Dashboard loads in < 2s on 3G
- Lead list supports 10,000+ leads per org with pagination
- Sync latency: < 30s for critical events (bookings, payments)

### NFR-02: Security
- All existing security measures maintained (RBAC, tenant isolation, RLS, SSRF protection)
- CRM API keys never exposed to browser (server-side only)
- Webhook signatures verified on both directions

### NFR-03: Mobile-First
- All modules work at 360px width
- PWA installable per client with their branding
- Touch-friendly tables and forms

### NFR-04: Clone Reliability
- Cloning a profile takes < 5 seconds
- Cloned config is independent (changes don't affect source)
- Field mappings are templates, not shared references
