# UNIKLIFE Platform — Vision & Architecture Analysis

**Date:** 2026-11-09
**Status:** Analysis complete — awaiting approval before any code changes

---

## 1. What We Are Building (The Big Picture)

### The Problem
- UNIKLIFE sells **white-label CRM** (from MyAppz CRM providers) to clients across 100+ industries.
- Client CEOs and high-level executives find the CRM confusing — too many features, complex setup, generic UI.
- Setting up fields, webhooks, and workflows for each new client is repetitive manual work.

### The Solution
A **multi-industry frontend platform** that:
1. **Simplifies** — Presents only the features each industry/role needs, in a CEO-friendly UI.
2. **Connects** — Bridges to the existing white-label CRM via API, webhooks, and 2-way sync.
3. **Clones** — Same industry? Clone the template. Only change webhook URLs, API keys, and minor customizations.
4. **Scales** — Platform owner (UNIKLIFE) manages all client onboarding from a single admin panel.

### How It Works (Data Flow)

```
┌─────────────────────┐         API / Webhook / 2-Way Sync         ┌──────────────────────┐
│                     │  ─────────────────────────────────────────▶ │                      │
│   UNIKLIFE Frontend │                                             │  MyAppz White-Label  │
│   (Our Platform)    │  ◀───────────────────────────────────────── │  CRM (Per Client)    │
│                     │         Inbound Webhooks / Polling          │                      │
│   CEO-friendly UI   │                                             │  Staff operates here  │
│   PWA App Support   │                                             │  (Full CRM features)  │
│   Role-based access │                                             │                      │
└─────────────────────┘                                             └──────────────────────┘
        ▲                                                                    ▲
        │                                                                    │
   CEO / Executives                                                    Staff / Operators
   (View dashboards,                                                   (Use full CRM for
    approve, track)                                                     day-to-day work)
```

### Per-Client Setup Flow

```
1. Platform owner selects Industry + Profile (e.g., "Hospital Management")
2. System loads industry template (modules, fields, dashboard config, role definitions)
3. Platform owner creates a new white-label CRM sub-account in MyAppz
4. Platform configures: webhook URL, API key, field mappings
5. For CRM fields that don't exist → auto-create custom fields via CRM API → map them
6. Client gets their branded PWA login (e.g., hospital.uniklife.app)
7. 2-way sync runs continuously:
   - Frontend action → fires to CRM
   - CRM data change → reflects in frontend
```

---

## 2. Reference App Analysis (uniklife-3d-venture)

The existing deployed app at `uniklife-3d.vercel.app` is **one submodule** of one industry:
- **Industry:** Real Estate & Construction
- **Profile:** Real Estate Sales CRM
- **Submodule:** Ventures (3D Plot Viewer, Booking, Commissions)

### What Already Exists & Patterns to Reuse

| Layer | What's Built | Reusable? |
|-------|-------------|-----------|
| **Multi-tenant isolation** | `organizations` table, `organization_id` on every row, RLS policies | Yes — core platform pattern |
| **White-label branding** | Per-org name, logo, theme, PWA manifest, custom domains | Yes — exact pattern needed |
| **Role-based access** | `platform_admin`, `org_admin`, `venture_manager`, `sales_manager`, `sales_executive`, `customer` | Needs expansion per industry |
| **Permission system** | 30+ granular permissions, role → permission mapping, server-enforced | Yes — extend with industry permissions |
| **Auth (local)** | bcrypt + JWT sessions, no Supabase dependency | Yes — production-ready |
| **Integration layer** | Outbound events → outbox → HTTP connector, inbound webhooks, field mappings | Yes — the core sync engine |
| **2-way sync prototype** | Delta checks (15s), full reconciliation (15m), conflict resolution, checkpoints | Yes — needs production hardening |
| **Employee/Network hierarchy** | 1–12 level downline tree, reporting lines, network privacy | Industry-specific but pattern reusable |
| **Dashboard** | Sales metrics, booking pipeline, filterable | Template per industry |
| **Notifications** | In-app bell, push (VAPID), upline notifications | Yes — universal |
| **Audit log** | Every mutation logged with actor, reason, full before/after | Yes — universal |
| **PWA** | Per-tenant manifest, icons, install prompt, offline fallback | Yes — exact pattern |
| **3D Viewer** | Three.js venture viewer, cinematic tour | Real Estate specific only |
| **Bookings/Payments** | Hold → discount → book → pay → confirm via webhook | Real Estate specific (pattern reusable for other booking industries) |
| **Commissions** | Multi-level, ₹/sq yd or %, plans, simulator, settlements, XLSX | Real Estate / Sales specific |
| **Site visits + GPS** | Trip tracking, geofence auto-arrival | Field-sales specific |
| **PDF generation** | Booking acknowledgement PDFs | Template per industry |

### Current Architecture Diagram

```
src/
├── app/
│   ├── (app)/           ← Authenticated pages (server components)
│   │   ├── dashboard/       ← Sales dashboard
│   │   ├── ventures/        ← 3D viewer, venture CRUD
│   │   ├── plots/           ← Plot inventory
│   │   ├── bookings/        ← Booking workflow
│   │   ├── commissions/     ← Multi-level commissions
│   │   ├── employees/       ← Employee directory
│   │   ├── network/         ← Downline tree
│   │   ├── integrations/    ← CRM connection settings
│   │   ├── settings/        ← Org branding, password
│   │   └── ...
│   ├── api/              ← API routes (thin → services)
│   └── login/            ← Public auth pages
├── components/
│   ├── viewer/           ← 3D viewer (Three.js) — Real Estate only
│   ├── booking/          ← Booking workflow — Real Estate only
│   ├── commissions/      ← Commission tools — Sales-based industries
│   ├── integrations/     ← CRM connection UI — Universal
│   ├── shell/            ← App shell, navigation — Universal
│   └── ui.tsx            ← Shared component library — Universal
├── lib/
│   ├── auth/             ← Auth context, permissions, sessions
│   ├── db/               ← Database abstraction (PGlite / Postgres)
│   ├── services/         ← ALL business logic (server-only)
│   ├── integration/      ← CRM sync engine (outbox, connectors, events)
│   └── ...
└── supabase/migrations/  ← SQL schema (source of truth)
```

---

## 3. Industry & Module Structure (102 Industries × 20 Categories)

### Category → Industry → Submodules Model

Each industry is a **profile** that defines:
- Which **modules** are active (lead management, appointments, inventory, billing, etc.)
- Which **submodules** appear under each module
- Which **fields** are displayed (mapped to CRM custom fields)
- Which **roles** exist (beyond the universal platform/org/customer roles)
- Which **dashboard widgets** show up
- Which **webhook events** fire and what CRM fields they map to

### The 20 Industry Categories

| # | Category | Industries | Key Modules |
|---|----------|-----------|-------------|
| 1 | Healthcare & Wellness | Hospital, Clinic, Dental, Lab, Physio, Wellness Coach | Patients, Appointments, Billing, Reports |
| 2 | Education & Training | School, College, Coaching, EdTech, Preschool | Students, Admissions, Fees, Attendance |
| 3 | Real Estate & Construction | Sales CRM, Plot Mgmt, Construction, Rental, Interior | **Ventures** (existing), Leads, Bookings, Site Visits |
| 4 | Finance & Insurance | Loan/DSA, Insurance, Advisory, Chit Fund, Tax | Leads, Applications, Disbursements, Collections |
| 5 | Retail & E-commerce | Store, E-commerce, Wholesale, Grocery, Jewellery | Inventory, Orders, Customers, POS |
| 6 | Professional Services | Law, CA, Consulting, Digital Agency, IT Services | Cases/Projects, Clients, Billing, Time |
| 7 | Hospitality & Travel | Hotel, Travel, Restaurant, Catering, Banquet | Reservations, Guests, Rooms/Tables, Events |
| 8 | Automotive & Transport | Car/Bike Dealer, Service Center, Rental, Fleet | Vehicles, Leads, Service Jobs, Bookings |
| 9 | Beauty & Lifestyle | Salon, Spa, Gym, Yoga, Boutique | Appointments, Memberships, Packages, Staff |
| 10 | Agriculture & Food | Agri Input, Farm, Dairy, Poultry, Food Processing | Inventory, Orders, Farmers/Suppliers, Dispatch |
| 11 | Manufacturing & Industrial | Mfg Ops, Equipment, Textile, Furniture, Packaging | Production, Orders, Inventory, Quality |
| 12 | Home & Local Services | Cleaning, Pest Control, Electrical, Repair, Security | Service Requests, Scheduling, Teams, Billing |
| 13 | Media & Entertainment | Photo/Video Studio, Film, Influencer, Ad Agency, Publishing | Projects, Clients, Deliverables, Invoicing |
| 14 | Events & Communities | Events, Weddings, Exhibitions, Membership, Awards | Events, Vendors, Guests, Registrations |
| 15 | HR & Recruitment | Recruitment, Staffing, Corporate HR, Training, Payroll | Candidates, Jobs, Interviews, Payroll |
| 16 | Nonprofit & Public | NGO, Fundraising, CSR, Community, Skill Dev | Programs, Donors, Beneficiaries, Reports |
| 17 | Technology & Digital | SaaS, AI Agency, Web Dev, Digital Product, IT Support | Tickets, Projects, Clients, Subscriptions |
| 18 | B2B Sales & Distribution | FMCG, Pharma, Building Materials, Electrical, Industrial | Distributors, Orders, Routes, Collections |
| 19 | Specialized Healthcare | Vet, Home Health, Elder Care, Mental, Nutrition | Patients, Care Plans, Appointments, Records |
| 20 | Premium & Emerging | Franchise, Coworking, Solar, EV, Luxury | Units/Locations, Members, Subscriptions, Service |

### Universal Modules (Present in Every Industry)

These come from the CRM and are always needed:

| Module | Submodules | CRM Source |
|--------|-----------|-----------|
| **Lead Management** | Leads list, Lead detail, Lead pipeline, Lead assignment | CRM leads module |
| **Dashboard** | KPIs, Charts, Activity feed, Notifications | CRM dashboard + computed |
| **Contacts/Customers** | Directory, Detail, Communication history | CRM contacts |
| **Settings** | Branding, Users & roles, API keys, Webhook config | Platform config |
| **Integration** | Connection status, Field mappings, Sync logs, Event logs | Platform integration engine |

### Industry-Specific Modules (Examples)

| Industry | Specific Modules |
|----------|-----------------|
| Hospital Management | Patient Records, OPD/IPD, Pharmacy, Lab Reports, Bed Management |
| School Management | Student Records, Admissions, Fee Collection, Attendance, Timetable |
| Real Estate Sales CRM | Ventures/Projects, Plot Inventory, Bookings, Commissions, Site Visits |
| Car Dealership | Vehicle Inventory, Test Drives, Financing, Service Booking, Insurance |
| Restaurant & Cafe | Table Management, Menu, Orders, Kitchen Display, Reservations |
| Fitness Gym | Members, Memberships, Class Schedule, Trainer Assignment, Check-in |

---

## 4. Architecture: What Each Client Gets

### Answer: What Requires Supabase?

**Supabase is NOT required.** The current code uses Supabase as one of several swappable backends:

| Concern | Current Options | Recommendation for Multi-Industry Platform |
|---------|----------------|-------------------------------------------|
| **Database** | PGlite (dev) / postgres.js (any Postgres) | **Single shared Postgres** with tenant isolation via `organization_id` (already built). One Supabase project or one managed Postgres (Neon/RDS/etc.) for ALL clients. |
| **Auth** | Local (bcrypt + JWT) / Supabase Auth | **Local auth** (already default, production-ready, no external dependency) |
| **File Storage** | Local disk / Supabase Storage | **Cloudflare R2** or **S3** (need to add a driver — ~50 lines of code). Or keep Supabase Storage as the single shared bucket. |
| **CRM Connection** | HTTP connector + webhooks (generic) | Already CRM-agnostic. Each client's connection row stores their CRM's webhook URL, auth type, and field mappings. |

### Per-Client Infrastructure

| Resource | Separate per client? | Shared? | Notes |
|----------|---------------------|---------|-------|
| **White-label CRM sub-account** | Yes (from MyAppz) | — | Created by platform owner in the CRM |
| **Supabase project** | **NO** | Yes (one for all) | One database, tenant isolation by `organization_id` + RLS |
| **Cloudflare Pages/Workers** | **NO** | Yes (one deployment) | Multi-tenant: resolved by custom domain → organization |
| **Git repo** | **NO** | Yes (this repo) | One codebase, one deployment, industry config = data not code |
| **Custom domain** | Yes (optional) | — | `hospital.clientname.com` CNAME → Vercel, mapped to org in DB |
| **Vercel project** | **NO** | Yes (one deployment) | Multi-tenant routing already built |
| **Webhook endpoints** | Per-client connection row | — | URL + auth stored in `integration_connections` per org |
| **API keys** | Per-client (in env or CRM) | — | Secret env var names stored in DB, values in platform env |

### Why NOT Separate Infrastructure Per Client

1. **Already multi-tenant** — The entire codebase is built around `organization_id` isolation. Every query, every service call, every permission check filters by tenant.
2. **Cost** — 100+ Supabase projects × 100+ Vercel projects = thousands of dollars/month vs. one shared deployment.
3. **Maintenance** — One codebase, one deployment, one migration path. Schema changes apply to all tenants in one migration.
4. **Clone = Database Row** — Adding a new client = inserting rows (organization, industry profile, module config), not cloning infrastructure.

### When You WOULD Separate (Enterprise Override)

A very large client (hospital chain, franchise network) might get:
- Dedicated Postgres schema or database (for compliance/data residency)
- Dedicated Vercel deployment (for custom SLA)

This is an enterprise upsell, not the default path.

---

## 5. Platform Owner Operations (Single Admin Panel)

The platform owner (UNIKLIFE developer/admin) manages everything from one interface:

### Platform Admin Dashboard

```
Platform Admin Panel
├── 🏢 Organizations (Clients)
│   ├── Create new client
│   ├── Select industry template
│   ├── Configure modules & submodules
│   ├── Set up CRM connection (webhook, API, field mapping)
│   ├── Manage custom domain
│   └── Clone from existing client (same industry)
│
├── 🏭 Industry Templates
│   ├── Healthcare & Wellness (6 profiles)
│   ├── Education & Training (5 profiles)
│   ├── Real Estate & Construction (5 profiles)
│   │   └── Real Estate Sales CRM
│   │       ├── Module: Ventures ← (this is what's built)
│   │       ├── Module: Lead Management
│   │       ├── Module: Bookings
│   │       └── ...
│   ├── ... (17 more categories)
│   └── Create custom template
│
├── 🔗 Integration Hub
│   ├── Connection status (all clients)
│   ├── Sync health dashboard
│   ├── Failed deliveries / dead letters
│   ├── Field mapping library
│   └── Webhook event logs
│
├── 📦 Module Library
│   ├── Universal modules (Lead Mgmt, Dashboard, Contacts, Settings)
│   ├── Industry modules (per category)
│   ├── Module → CRM field mapping templates
│   └── Clone / customize module
│
└── ⚙️ Platform Settings
    ├── Default themes & branding
    ├── Environment secrets
    ├── CRM provider configuration
    └── Billing & usage
```

### Clone Workflow

```
1. Platform admin: "Clone Real Estate Sales CRM for a new client"
2. System copies:
   ✓ Industry profile (modules, submodules, field definitions)
   ✓ Role definitions and permission mappings
   ✓ Dashboard widget configuration
   ✓ Webhook event mappings template
   ✓ CRM field mapping template
3. Platform admin customizes:
   → Webhook URL (new CRM sub-account URL)
   → API key (new CRM sub-account key)
   → Custom domain (optional)
   → Branding (logo, name, colors)
   → Module tweaks (enable/disable submodules)
4. System auto-creates missing CRM custom fields via API
5. Client is live
```

---

## 6. Suggested Development Workflow

### Phase 0: Foundation (Current State → Multi-Industry Ready)
**Goal:** Refactor the existing Real Estate module into the platform's module system without breaking it.

1. **Industry & Module Config Schema** — Add `industry_profiles`, `industry_modules`, `module_field_mappings` tables.
2. **Dynamic Navigation** — Nav items come from the client's active modules (not hardcoded in `nav-config.ts`).
3. **Dynamic Dashboard** — Widget grid driven by module config, not a single hardcoded dashboard.
4. **Storage Driver** — Add S3/R2 driver (or keep Supabase Storage as shared service).
5. **Strengthen Sync Engine** — Production-ready 2-way sync worker (background, durable, checkpoint-based).

### Phase 1: Universal Modules
**Goal:** Build the modules every industry needs.

1. **Lead Management** — Leads list, detail, pipeline, assignment, CRM field sync.
2. **Contacts/Customers** — Universal directory synced with CRM contacts.
3. **Enhanced Dashboard** — Configurable widget grid per industry.
4. **Platform Admin Panel** — Industry template management, client onboarding wizard, clone workflow.

### Phase 2: First 3 Industry Verticals
**Goal:** Prove the template/clone model works across different industries.

1. **Real Estate Sales CRM** — Already built (Ventures, Plots, Bookings, Commissions).
2. **Hospital Management** — Patient records, OPD, appointments, billing.
3. **School Management** — Students, admissions, fees, attendance.

### Phase 3: Scale to 20 Categories
**Goal:** Rapidly add remaining industries using the clone/template system.

- Each new industry = database config rows + any unique UI components.
- Most industries within a category share 80%+ of their module structure.
- "Clone from same category" should handle 90% of new industry setup.

### Phase 4: Self-Service & Marketplace
**Goal:** Let clients customize their own modules.

- Module marketplace (enable/disable features).
- Field customization within modules.
- Custom dashboard widget builder.

---

## 7. Technology Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Database | **One shared Postgres** (Supabase or Neon or managed Postgres) | Multi-tenant isolation already built; cheapest; single migration path |
| Auth | **Local** (bcrypt + JWT) | Already default, no external dependency, works everywhere |
| File storage | **Add S3/R2 driver** (or keep Supabase Storage shared) | Vercel's ephemeral FS can't do `local`; S3/R2 is cheapest at scale |
| Hosting | **Vercel** (single project) | Already configured; multi-tenant domain routing built |
| CRM connection | **Existing HTTP connector + outbox** | Generic enough for any CRM that has webhooks + API |
| Sync | **Production sync worker** (Vercel cron + serverless, or dedicated worker) | Current prototype is client-side only; need server-side durable sync |
| Industry config | **Database-driven** (not code branches) | Clone = insert rows, not fork repo |
| Frontend framework | **Next.js 15 + React 19 + Tailwind 4** (keep current) | Already proven in the Real Estate module |

---

## 8. Files in This Analysis Folder

| File | Purpose |
|------|---------|
| `01-VISION-AND-ANALYSIS.md` | This file — the complete analysis |
| `02-REQUIREMENTS.md` | Detailed requirements per phase |
| `03-DEVELOPMENT-PLAN.md` | Step-by-step implementation plan with task breakdown |
| `04-INDUSTRY-PROFILES.md` | All 102 industries with their modules and submodules |
| `05-CRM-FIELD-MAPPING.md` | How fields map between frontend and CRM |
