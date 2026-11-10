# Ventures App — End-to-End Analysis

**Date:** 2026-11-09
**Source:** Live app screenshots (uniklife-3d.vercel.app) + codebase analysis
**Purpose:** Document exactly how the Ventures module works — every screen, every feature, every CRM connection point — as the reference blueprint for building other industry modules.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    UNIKLIFE VENTURES FRONTEND                       │
│                    (Next.js 15 + React 19 PWA)                      │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Dashboard │  │  Sales   │  │ Finance  │  │  Administration  │   │
│  │  (Home)   │  │ Module   │  │ Module   │  │     Module       │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Service Layer (src/lib/services/)               │   │
│  │  Every function takes AuthContext, filters by organizationId │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                Integration Layer                              │   │
│  │  Outbox → HTTP Connector → CRM    |    Inbound Webhook ← CRM │   │
│  │  Sync System (delta 15s, full 15m)|    WhatsApp ← Meta       │   │
│  │  Meta Lead Ads ← Facebook         |    Email/SMTP → Provider │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Database (Postgres / PGlite)                     │   │
│  │  Multi-tenant: organization_id on every row + RLS             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   MyAppz CRM       │
                    │   (White-label)    │
                    │   via API/Webhook  │
                    └───────────────────┘
```

---

## 2. Sidebar Navigation Structure

The sidebar is the app's primary navigation. It groups features into logical sections:

### Sections (from screenshots)

| Section | Menu Items | Description |
|---------|-----------|-------------|
| **WORKSPACE** | Home | Main dashboard |
| **SALES** | Bookings, Enquiries, Site visits, Trip tracking, My network, Sales dashboard | Core sales operations |
| **VENTURES & PLOT INVENTORY** | Ventures, Plot inventory | Real estate specific — projects and their plots |
| **FINANCE** | Plans & simulator, Payments, Commission Structure | Financial management |
| **ADMINISTRATION > ORGANIZATION** | Staff & Access, Organizations | People and multi-org management |
| **UNIKLIFE AI** | Uniklife AI Integration | CRM connection hub |
| **PREFERENCES** | Settings | User/org preferences |

### What's Reusable vs. Industry-Specific

| Reusable (keep for all industries) | Industry-Specific (Real Estate only) |
|-----------------------------------|------------------------------------|
| Home/Dashboard | Ventures (= Projects/Properties) |
| Enquiries (→ Leads) | Plot inventory (= Product inventory) |
| Bookings (→ Orders/Appointments) | 3D viewer |
| Site visits (→ Appointments) | Plot area, facing, corner attributes |
| Trip tracking (→ Field staff tracking) | Mortgage blocked status |
| My network (→ Reporting tree) | |
| Sales dashboard | |
| Plans & simulator (→ Pricing plans) | |
| Payments | |
| Commission Structure | |
| Staff & Access | |
| Organizations | |
| Uniklife AI Integration | |
| Settings | |

---

## 3. Screen-by-Screen Analysis

### 3.1 Dashboard (Home)

**URL:** `/dashboard`
**Role:** Platform Administrator view

**Components:**
- **Welcome banner** with user name + org name
- **Quick actions:** "Open 3D venture" + "New booking" buttons
- **6 KPI tiles** (personal scope):
  - My enquiries: 0
  - My bookings: 0 (awaiting advance)
  - My site visits: 0
  - Pending follow-ups: 0
  - My commissions (approved): ₹0 (pending, paid breakdown)
  - Notifications: 0 unread
- **Recent bookings card** — "No bookings yet, Open a venture in 3D..."
- **Notifications card** — "You're all caught up"
- **Organization overview section:**
  - Gross Booking Value: ₹0
  - Verified Collections: ₹0
  - Outstanding Balances: ₹0
  - Conversion: 0%
- **Booking value chart** — last 30 days bar chart
- **Plot availability** — donut/legend: Available, Temporarily Held, Reserved, Booked, Sold, Blocked (0 plots across 2 ventures)

**For multi-industry:** The dashboard layout is reusable. KPI tiles, charts, and cards need to be driven by industry profile config. Replace "bookings" with "appointments", "orders", etc.

---

### 3.2 Bookings

**URL:** `/bookings`

- Search bar: "Search booking, customer, phone or plot"
- Status filter dropdown: All statuses
- Filter button
- **"New booking from 3D viewer"** button (industry-specific)
- Currently shows "No bookings found"

**CRM sync point:** When a booking is created → `booking.created` event → outbox → CRM opportunity. Status changes fire `booking.confirmed` / `booking.cancelled`.

---

### 3.3 Enquiries

**URL:** `/enquiries`

- Tab filters: All (1), New (1), Contacted (0), Qualified (0), Converted (0), Closed (0)
- **"+ New enquiry"** button
- Enquiry card shows: Name (Sudhir), status badge (new), source badge (Staff), phone, venture, time
- Status dropdown to change status inline
- "Assign" field for employee assignment
- "Schedule site visit" quick action link

**CRM sync point:** Enquiries = Leads in CRM. `lead.created`, `lead.updated`, `lead.status_changed` events.

---

### 3.4 Site Visits

**URL:** `/site-visits`

- KPI tiles: Today (0), Requests (0), Unassigned (0)
- Tab filters: Upcoming, Past, All dates
- Filters: status, venture, visitor search
- View toggle: Agenda / List
- **"+ Schedule visit"** button
- "Team tracking" button → goes to trip tracking

**CRM sync point:** `appointment.created`, `appointment.completed` events.

---

### 3.5 Trip Tracking

**URL:** `/site-visits/tracking`

- Date picker with day navigation
- KPI tiles: Employees (0), Visits (0), On the move / On site (0), Returned (0)
- "← Site visits" back button
- Daily view of all field staff trips

**How it works (from screenshots):**
1. Salesperson starts trip on their phone, agrees to share location
2. Phone enters venture's geofence → arrival recorded automatically
3. Managers open Trip tracking → Timeline: map shows fence, route, Start (S), Site and End (E) markers
4. "Open route in Google Maps" links to external map

**Privacy-aware:** Location shared only during active trips, browser GPS only while page is open, visible only to employee + reporting chain + org admins.

---

### 3.6 My Network

**URL:** `/network`

- Shows reporting tree — employee and everyone who reports to them
- "No employee record linked" when account not linked to employee directory
- Privacy note: "Upline managers and their earnings are never shown"

---

### 3.7 Sales Dashboard

**URL:** `/sales`

- Scope badge: "Organization" with venture filter dropdown
- **8 KPI tiles:**
  - Gross Booking Value: ₹0
  - Verified Payments — Real: ₹0
  - Verified Payments — Simulated: ₹0
  - Outstanding Balances: ₹0
  - Booking Requests: 0
  - Conversion Rate: 0%
  - Enquiries: 1
  - Discounts Granted: ₹0
- **Explanation card:** "Reading these numbers" — explains difference between gross booking value, verified payments, and outstanding
- **Booking requests chart** — last 30 days
- **Plot status** — availability breakdown with legend
- **Top ventures** — by gross booking value
- **Top plots** — highest net value

---

### 3.8 Ventures

**URL:** `/ventures`

- List of ventures (real estate projects)
- **"New venture"** button
- Currently shows "No ventures yet. Create your first venture to start adding plots."
- Each venture would show: name, plot count, availability status

**Industry equivalent:** This is the "Products/Projects/Programs" module. For Hospital = Departments, for School = Classes, for Coaching = Programs.

---

### 3.9 Plot Inventory

**URL:** `/plots`

- Organization switcher at top
- **Filters:** Property type, Venture, Phase/block, Status, Facing, Corner, Plot number, Area (sq yd) range, Total price range
- **Export:** "Export CSV" and "Upload PDF/CSV" buttons
- Status summary: "0 plots matching filters · 0 mortgage blocked · 0 available with price · 0 awaiting selling price"
- Paginated table

**Industry equivalent:** This is "Inventory" — product/service catalog. Very industry-specific fields (area, facing, corner are real-estate only).

---

### 3.10 Plans & Simulator — Discounts

**URL:** `/commissions/plans?section=discounts`

- **Discounts management page**
- KPI tiles: Active (0), Pending Approval (0), Expired (0), Granted Confirmed (₹0), Usage (0)
- Discount stacking notice: "Only one discount can be applied per booking. An organization administrator can enable stacking in Settings..."
- Tabs: All, Active, Pending approval, Paused, Expired, Rejected, Archived
- Search by name or code
- **"+ New discount"** button

---

### 3.11 Payments

**URL:** `/payments`

- KPI tiles: Verified — Real (₹0), Verified — Simulated (₹0), Pending Checkouts (₹0), Failed (₹0)
- Tab filters: All, Verified, Pending, Failed, Refunded
- Toggle: "Real & simulated" / "Real only" / "Simulated only"

**CRM sync point:** `payment.verified` events.

---

### 3.12 Commission Structure

**URL:** `/commissions`

- Tabs: Ledger, Plans & simulator, Settlements & finance
- **Lifetime Commission:** ₹0
- Privacy: "You see only your own and your downline's entries — never an upline's rates or earnings"
- KPI tiles: Pending Approval (₹0), Approved (₹0), In Settlement (₹0), Paid (₹0)
- Tabs within Ledger: My ledger, My team, Approvals queue (0)
- Status filter

---

### 3.13 Staff & Access

**URL:** `/staff`

- **8 sub-tabs:** Employee Directory, Agent Directory, Staff Login & Access, Roles & Authentication, Organization Chart, Commission Structure, Agent Commissions, Employee Incentives
- KPI tiles: Employees (1), Active (1), Linked to a Login (1), Top Level — No Manager (1)
- Search + status filter
- Table: Employee ID, Name, Mobile, Email, Designation, Level, Reporting Manager, Ventures, Status, Joined, Login
- Sample row: EMP-00001, Org B Administrator, Managing Director, L1, active
- **"Import CSV"** and **"+ Add employee"** buttons

---

### 3.14 Organizations

**URL:** `/organizations`

- **Platform Administration** level page
- KPI tiles: Organizations (2), Active (2), Suspended (0), Total Bookings (8)
- **"Create"** button for new organization (creates tenant with first administrator)
- Table: Organization, Status, Staff, Customers, Employees, Ventures, Bookings, Created, Actions
- Two orgs shown:
  - Demo Ventures (Sample Org) — sample-realty-b — 1 staff, 0 customers, 1 employee, 2 ventures, 0 bookings
  - Demo Ventures (Sample Org) — demo-ventures — 10 staff, 1 customer, 10 employees, 2 ventures, 8 bookings
- Actions: "Switch to" and "Suspend"

**Key for multi-industry:** This IS the platform admin panel. Each row = one client organization. Needs industry_profile_id column added.

---

### 3.15 Uniklife AI Integration — API Tab

**URL:** `/integrations`

- Connection card: UNIKLIFE.AI — MOCK mode, API type, enabled
- Last success timestamp
- **Connection config:**
  - Connection type: "API — send app data to CRM"
  - Connection name: UNIKLIFE.AI
  - Enable connection checkbox
  - CRM Incoming Webhook URL: `https://myappzbackend.com/functions/v1/workflow-webhook/dyrcp976ed2xhw0k`
  - Authentication: HMAC signature
  - Secret variable name: `UNIKLIFE_OUTBOUND_SECRET` — "set on server" badge
- **Parameters available to connect** — field reference cards:
  - Customer & enquiry: customer_name, customer_phone, customer_email, customer_id, enquiry_id, message, source
  - Project & plots: project_name, project_id, plot_number, plot_numbers, plot_area_sq_yards, base_amount, net_amount, total_area_sq_yards
  - Booking & payment: booking_number, booking_id, payment_status, advance_amount, discount_amount, currency, payment_due_at, verified_payments, payment_id, payment_amount, payment_provider, payment_method, payment_reference, refund_review_required
  - Discount: discount_name, discount_code, discount_amount, discount_id
  - Sales team: employee_name, employee_id, employee_code, designation, commission_level, reporting_manager_id, employment_status, selling_employee_code
  - Commission: commission_total_amount, commission_basis, plan_version, payees[].name, payees[].employee_code, commission_entries[].role, commission_entries[].level, commission_entries[].amount, commission_entries[].rate_percent/rate_per_sq_yard, commission_entries[].sale_value, commission_entries[].area_sq_yards, settlement_id, settlement_reference, period start/end, payment_reference
  - Site visit: site_visit_id, visitor_name, visitor_phone...
  - Hold & follow-up: hold_group_id...
- **Request details:** id, type, occurred_at, organization_id, source_record_id, idempotency_key, test, simulated
- **Test & dispatch section:**
  - "Send test event" and "Dispatch now" buttons
  - Verification: "Not verified — MOCK only" — must type "I VERIFIED THE UNIKLIFE.AI API" to go live
  - "Mark verified & switch to live" button

---

### 3.16 Uniklife AI Integration — Webhook Tab

**URL:** `/integrations?tab=webhook`

- **"+ Create more APIs & Webhooks"** button
- "No connections yet. Create an API or Webhook to get started."
- **Webhook delivery logs:**
  - Tabs: Outbound, Inbound, Mock CRM inbox
  - Status filter + Filter button
  - Currently: "No inbound webhooks yet" — "Signed requests from UNIKLIFE.AI to the inbound endpoint appear here, including duplicates and rejections"
- "Integration settings" link

---

### 3.17 Uniklife AI Integration — Sync System

**URL:** `/integrations/sync`

- KPI tiles:
  - Worker Heartbeat: "No recent check" (target cadence 15 seconds)
  - Live External APIs: 0
  - Meta Leads Imported: 0
  - Meta Leads to Review: 0
- **"Run one check now"** button (manual trigger)
- Auto-refresh: "This page refreshes its status every 15 seconds"

**How the sync works:**
- Direct Meta: Connect Facebook Page + lead form → Meta sends signed leadgen webhooks → worker retrieves full lead → creates enquiry
- Worker checks missed leads every 15 seconds
- Every 15 minutes: scans 24-hour recovery window, ignores duplicate lead IDs
- **Administrator setup:** `DATABASE_DRIVER=postgres`, `SYNC_WORKER_ENABLED=true`, `npm run sync:worker`
- Vercel daily cron doesn't provide 15-second syncing — need always-on Node server

**Sync execution logs:** Table with Started, Source (manual/auto), Status (completed), Processed, Details

---

### 3.18 Uniklife AI Integration — Meta Lead Ads

**URL:** `/integrations/meta`

- **"Open Meta Apps"** and **"Open Meta Lead Ads Testing"** buttons
- Connect a Lead Ads form: Facebook Page ID, Lead form ID, target venture
- **Administrator setup:**
  1. Grant app access to Page and lead form in Meta
  2. Configure Page webhook with callback URL: `https://uniklife-3d.vercel.app/api/webhooks/meta/leads`
  3. Set Page access token as env var: `META_PAGE_TOKEN_5DFE2063FEDE49D9A418520FD9D566FD`
  4. Start worker
- Status badge: "Page token is not set on this server"
- **Connected forms** table: Page, Form, Status, Last Check/Error

---

### 3.19 Uniklife AI Integration — WhatsApp

**URL:** `/whatsapp`

- **"Connect WhatsApp in 3 steps"** visual flow:
  1. Prepare business (admin access + phone number)
  2. Configure Meta app (WhatsApp + Embedded Signup)
  3. Set server settings (Vercel production variables)
  4. Verify webhook (callback URL + matching verify token)
  5. Connect with Meta (choose business and number)
  6. Confirm delivery (send test to opted-in recipient)
- **How messages travel:** UNIKLIFE → Meta Cloud API → Customer (and back via signed webhooks)
- **3 setup steps:**
  1. Open Meta app → Add WhatsApp + Facebook Login
  2. Connect the number → use Go to Connect with Meta
  3. Verify and test → paste callback URL into Meta
- Callback URL: `https://uniklife-3d.vercel.app/api/webhooks/whatsapp`
- Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- **"Connect with Meta"** button (Embedded Signup)
- Recent WhatsApp activity table

---

### 3.20 Uniklife AI Integration — Email & SMTP

**URL:** `/integrations/email`

- SMTP connection config:
  - SMTP host: smtp.gmail.com
  - SMTP username (empty)
  - From email (empty)
  - Sender name: Uniklife
  - Encryption: STARTTLS : 587
  - "Enable email delivery after verification" checkbox
- **"Save SMTP"** and **"Verify connection (no email)"** buttons
- Finish setup instructions with env var name: `SMTP_PASSWORD_5DFE2063FEDE49D9A418520FD9D566FD`
- Status: "SMTP verification needed"
- Email and WhatsApp alert logs table

---

### 3.21 Uniklife AI Integration — Google Maps

**URL:** `/integrations/maps`

- **Site-visit map choice:**
  - Google Maps: Real map with fence circle, route, markers. Needs Google key + billing. Currently "key missing"
  - Stationary GIS fence: Built-in fixed fence. No Google account needed. Currently "active now"
- **"Save choice"** and **"Test map"** buttons
- **Setup guide:** "Connect Google Maps in 5 steps" visual:
  1. Google Cloud Console → create project, turn on billing
  2. APIs & Services → Library → enable Maps JavaScript API
  3. Credentials → Create credentials → API key → RESTRICT IT (Websites: your domain, API: Maps JavaScript only)
  4. Vercel → Settings → Environment Variables → `GOOGLE_MAPS_API_KEY`
  5. Choose in app → Google Maps tab → Save
- **What you see after a site visit:**
  - Map: Google Maps with geofence circle (300m), route line, S/Site/E markers
  - Timeline: Trip started (10:02 manual+GPS), Entered site geofence (10:41 auto), Arrived at site (10:41), Visit completed (11:35, 54 min on site), Returned (12:20, 18.4km)

---

### 3.22 Audit Log

**URL:** `/integrations` (bottom section)

- "Append-only record of changes in Demo Ventures (Sample Org). Credentials and secrets are redacted before they are stored."
- **Filters:** Action contains, Entity type, Actor, Date range
- **"Export CSV"** button
- Log entries show: timestamp, action badge (integration.updated, integration.test_event, integration.dispatch_now), entity type badge, description, actor name + email
- Example entries:
  - "UNIKLIFE.AI connection settings saved"
  - "Test event queued"
  - "Dispatched 0 event(s): 0 delivered, 0 failed, 0 dead-lettered"

---

### 3.23 Settings — Profile

**URL:** `/settings`

- Profile: Email (sign-in), Full name, Phone
- Change password: Current, New, Confirm (min 10 chars)
- **Active organization:** Dropdown to switch orgs — shows org name, slug, plot count

---

### 3.24 Settings — Notifications

**URL:** `/settings?tab=notifications`

- Notification preferences summary:
  - In-app: On
  - Dashboard alerts: On
  - Push: Off
  - WhatsApp (UNIKLIFE.AI): On
  - Email (UNIKLIFE.AI): On
- "Open notification preferences" button

---

### 3.25 Settings — Organization

**URL:** `/settings?tab=organization`

- **Booking rules:**
  - Plot hold (minutes): 15
  - Payment window (minutes): 120
  - Booking amount (%): 10
  - Maximum discount (%): 20
  - Approval threshold (%): 5
  - Follow-up reminders (hours): 24, 72
- **Employee ID prefix:** EMP (2-6 capital letters)
- **Contact:** email, phone
- **Toggles:**
  - Allow discount stacking: Off
  - Require second approver for commission plans: On (four-eyes control)

---

### 3.26 Settings — Company Branding

**URL:** `/settings?tab=branding`

- Company name, Application name, Short name, Website
- **Default colour mode:** System (follow device)
- **Brand theme:** 12 options with light/dark previews:
  - Royal Sapphire & Gold, Midnight Royal, Ivory Heritage, Emerald Estate
  - Ruby Prestige (selected ✓), Ocean Sapphire, Onyx & Gold, Pearl Minimal
  - Saffron Sunrise, Teal Horizon, Amethyst Royale, Copper Earth
- **Logo & app icons:**
  - Upload logo (PNG, JPEG, WebP, 64x64 min, 5MB max)
  - Generated PWA icons: 192px + 512px maskable
- **Domains:**
  - White-label domain management
  - "One domain per white-label app" explanation
  - Current: `sample.localhost:3000` — primary, DNS confirmed
  - Add domain input

---

## 4. CRM Integration — How It All Connects

### 4.1 Outbound Flow (Frontend → CRM)

```
User action in frontend
    │
    ▼
Service function (e.g. createBooking)
    │
    ├── Insert/update database row
    │
    └── enqueueOutboundEvent() in SAME transaction
         │
         ▼
    outbox table row
         │
         ▼
    HTTP Connector picks up
         │
         ├── HMAC signature on payload
         ├── Idempotency-Key header
         ├── X-Uniklife-Event header
         │
         ▼
    POST to CRM webhook URL
    (https://myappzbackend.com/functions/v1/workflow-webhook/...)
         │
         ▼
    CRM processes event → creates/updates record
```

### 4.2 Inbound Flow (CRM → Frontend)

```
CRM staff updates a record
    │
    ▼
CRM workflow fires webhook
    │
    ▼
POST /api/webhooks/uniklife/incoming
    │
    ├── Verify HMAC/Bearer signature
    ├── Schema validate with Zod
    ├── Deduplicate by idempotency_key
    │
    ▼
Process event → update local database
    │
    ▼
Frontend reflects change on next load/refresh
```

### 4.3 Event Types (from API tab parameters)

| Category | Fields Available for CRM | Count |
|----------|------------------------|-------|
| Customer & enquiry | customer_name, phone, email, id, enquiry_id, message, source | 7 |
| Project & plots | project_name, id, plot_number, plot_numbers, area, base_amount, net_amount, total_area | 8 |
| Booking & payment | booking_number, id, status, advance, discount, currency, due_at, verified_payments, payment_id/amount/provider/method/reference, refund_review | 14 |
| Discount | name, code, amount, id | 4 |
| Sales team | name, id, code, designation, commission_level, reporting_manager_id, employment_status, selling_code | 8 |
| Commission | total_amount, basis, plan_version, payees[], entries[] (role/level/amount/rate/value/area), settlement, reference, period | 15+ |
| Site visit | visit_id, visitor_name, phone, etc. | 3+ |
| Hold & follow-up | hold_group_id, etc. | 1+ |
| **Request envelope** | id, type, occurred_at, organization_id, source_record_id, idempotency_key, test, simulated | 8 |

### 4.4 Authentication Methods Supported

From the API tab dropdown:
- **HMAC signature** (current) — shared secret, signs payload
- **Bearer token**
- **Basic auth**
- **API key**
- **Custom header**

### 4.5 Mock → Live Verification

The app has a safety gate:
1. Start in MOCK mode — test events go to "Mock CRM inbox" (visible in Webhook tab)
2. To go live: type "I VERIFIED THE UNIKLIFE.AI API" confirmation text
3. Click "Mark verified & switch to live"
4. Requires `UNIKLIFE_LIVE_ENABLED=true` env var

---

## 5. Multi-Channel Integration Summary

| Channel | Status | Purpose |
|---------|--------|---------|
| **API (Outbound)** | Built, MOCK mode | Send events to CRM webhook |
| **Webhook (Inbound)** | Built, no connections | Receive updates from CRM |
| **Sync System** | Built, worker needed | Background polling, missed-lead recovery |
| **Meta Lead Ads** | Built, needs Meta app | Direct Facebook/Instagram leads |
| **WhatsApp** | Built, needs Meta setup | Customer messaging via Meta Cloud API |
| **Email & SMTP** | Built, needs SMTP config | Staff alerts and reminders |
| **Google Maps** | Built, optional | Site visit maps (fallback: GIS fence) |

---

## 6. Key Patterns for Multi-Industry Replication

### 6.1 What stays the same for every industry

1. **Auth & login flow** — local bcrypt+JWT
2. **Dashboard layout** — KPI tiles + charts + cards (content changes per industry)
3. **Enquiries → Leads pipeline** — status progression (New → Contacted → Qualified → Converted → Closed)
4. **Organization management** — multi-tenant, create/switch/suspend
5. **Staff & Access** — employee directory, roles, reporting tree, login management
6. **Commission structure** — ledger, plans, settlements (optional per industry)
7. **Payment tracking** — verified/pending/failed/refunded
8. **Integration hub** — API, Webhook, Sync, WhatsApp, Email, all reusable
9. **Settings** — profile, notifications, organization rules, branding, domains
10. **Audit log** — append-only, filterable, exportable

### 6.2 What changes per industry

1. **Sidebar items** — "Ventures" becomes "Departments", "Classes", "Programs", etc.
2. **Inventory fields** — plot area/facing/corner becomes bed count/class size/session duration
3. **Dashboard KPIs** — booking value becomes admission count, patient count, etc.
4. **CRM field mappings** — each industry maps different frontend fields to CRM fields
5. **Organization settings** — booking rules become appointment rules, fee rules, etc.
6. **Quick actions** — "New booking from 3D viewer" becomes "New appointment", "New enrollment"

### 6.3 The Pattern for Building a New Industry Module

```
1. Create industry_profile row (category, industry, config JSON)
2. Define modules + submodules (nav items)
3. Define field_definitions (what data this industry captures)
4. Map fields to CRM (field_mappings table)
5. Configure roles + permissions for this industry
6. Set organization_settings defaults
7. Dashboard KPI config (which metrics to show)
8. Done — the platform renders the right UI from config
```

---

## 7. Answers to Your Questions

### Is Supabase needed?

**For ONE shared account — YES, this is the right approach.** Here's the breakdown:

| Service | Supabase? | Alternative | Recommendation |
|---------|-----------|-------------|----------------|
| **Database** | No | Any Postgres (Neon, Supabase, Railway, Cloudflare D1) | Use Supabase Postgres — one database, all clients share it via `organization_id` |
| **Auth** | Optional | Already built: local bcrypt + JWT | **Keep local auth** — it's already production-ready, no Supabase dependency |
| **File Storage** | Yes | S3, R2, Supabase Storage | Use Supabase Storage or Cloudflare R2 — one bucket, paths prefixed by org_id |
| **Realtime** | No | Not needed yet | Skip for now |

**ONE Supabase account (Pro plan $25/mo) is enough for ALL clients.** Not per-client Supabase.

### One Cloudflare account?

**YES — one Cloudflare account handles everything:**
- Cloudflare Pages for deployment (or keep Vercel)
- Custom domains: each client gets their subdomain/domain pointing to the same deployment
- R2 for file storage (alternative to Supabase Storage)
- Workers for the sync worker (background process)

### Is the project idea possible?

**YES, absolutely.** Here's why:

1. **The hardest parts are already built:**
   - Multi-tenant architecture (organization_id everywhere)
   - CRM integration (outbox, webhooks, sync)
   - Auth, roles, permissions
   - White-label branding (12 themes, custom domains, PWA icons)
   - Full Real Estate module as reference

2. **What remains is configuration, not architecture:**
   - Industry profiles = database rows defining modules/fields
   - New industry = new config rows + industry-specific UI components
   - CRM field mapping = table rows, not code changes

3. **The risk is scope, not feasibility:**
   - 102 industries is ambitious — but with the clone pattern, industry #3 takes 10% of the effort of industry #1
   - Start with "Healthy Lifestyle" → Parenting Coaching + DMIT as you said
   - Prove the pattern works, then scale

### Auth approach?

**Keep local auth (bcrypt + JWT).** It's already built, works with multi-tenant, doesn't require Supabase Auth. Add Supabase Auth as an optional provider later if needed for social login (Google, Apple).

---

## 8. Next Step: CRM Screenshots Needed

To complete the analysis, I need screenshots of:
1. **MyAppz CRM dashboard** — what the CRM interface looks like
2. **CRM custom fields** — how fields are created/managed
3. **CRM workflow builder** — where webhook URLs are configured
4. **CRM API documentation** — endpoints, auth methods
5. **CRM contacts/leads view** — how data appears on the CRM side

This will let me map the exact integration points for the "Healthy Lifestyle" module.

---

*Next document: `07-CRM-ANALYSIS.md` — waiting for CRM screenshots*
