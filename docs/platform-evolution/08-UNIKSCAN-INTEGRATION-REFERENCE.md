# UnikScan Integration Reference — How Webhooks, API & 2-Way Sync Actually Work

**Date:** 2026-11-09
**Source:** 9 screenshots from `qr.venukalyan.ai/admin/settings` (UnikScan event management platform)
**Purpose:** This is the PROVEN reference architecture. UnikScan already does what we need for Healthy Lifestyle. We replicate this exact pattern.

---

## 1. UnikScan Platform Overview

**UnikScan** (`qr.venukalyan.ai`) is an event management platform built by Venkatesh. It manages:
- **Events** (e.g., "Transform Your Life 2026", "BOSS TIRUPATI")
- **Attendees** (registration, check-in, tickets)
- **Scanner** (QR code entry scanning)
- **Payments** (Razorpay integration)
- **Templates** (email/WhatsApp templates)
- **Google Sheets** (data sync)
- **Affiliates** (referral tracking)

**Sidebar navigation:** Dashboard, Events, Attendees, Scanner, Payments, Staff, Templates, Google Sheets, Affiliates, Settings

---

## 2. Settings Architecture (6 Tabs)

The Settings page at `qr.venukalyan.ai/admin/settings` has 6 tabs:

| Tab | What It Does |
|-----|-------------|
| **Integrations** | Payment Gateway, WhatsApp API, Email Delivery provider connections |
| **Webhooks** | Incoming + Outgoing webhook endpoints with event filtering |
| **Automations** | Auto-trigger rules for WhatsApp and Email on specific events |
| **Email Templates** | HTML email templates with merge tag placeholders |
| **Branding** | Platform name, logo, brand colors, Google integration |
| **Comm Logs** | Communication history — every email/WhatsApp sent, with status |

**Status bar at top:** EMAIL (Not configured), PAYMENTS (Disabled — free event), WHATSAPP (Disabled), BRANDING (Using defaults)

---

## 3. Integrations Tab (Screenshot 58)

### 3.1 Payment Gateway
- **Active provider:** Razorpay (dropdown selection)
- **Status:** Not verified
- Supports payment collection per event

### 3.2 WhatsApp API
- **Provider:** Disabled (dropdown)
- **Status:** Not verified
- Can be enabled with WhatsApp Business API provider

### 3.3 Email Delivery
- **Provider:** Resend (REQUIRED)
- **Configuration fields:**
  - Sender name (e.g., "Uniklife Events")
  - From address (REQUIRED — `tickets@yourdomain.com`)
  - Reply-to address (`help@yourdomain.com`)
  - Resend API key (REQUIRED — masked with `•••••`)
- **Note:** "Each event can use its own sender name, From and Reply-to address (Events → Edit → Settings → Email sender)."
- **Test Connection** button to verify

**Key pattern for Healthy Lifestyle:** Same integration tab structure — Payment Gateway (Razorpay), WhatsApp API (for session reminders), Email Delivery (Resend for appointment confirmations, report delivery).

---

## 4. Webhooks Tab — THE CORE INTEGRATION (Screenshots 56, 57)

This is the most important section. UnikScan has a complete bidirectional webhook system.

### 4.1 Webhook Management UI

**Header:** "Manage webhooks for" → dropdown: "All events (global) · 3" (3 endpoints configured)

**Two sections:**
1. **Incoming** (CRM → Frontend) — receive data from external systems
2. **Outgoing** (Frontend → CRM) — send data to external systems

### 4.2 Incoming Webhooks (CRM → UnikScan)

**TWO incoming endpoints configured:**

**Endpoint 1:** `All events (global) — incomin`
- **Status:** Active (green toggle ON)
- **Scope:** All events
- **Endpoint URL:** `https://hlhilbrbsaqjjpaguxod.supabase.co/functions/v1/webhook-incoming?token=fb0e330293164a16820507113d6993...`
- **Default event:** Latest event (default)
- **Saved** status confirmed
- **"How to use (curl)"** expandable section

**Endpoint 2:** `Incoming endpoint`
- **Status:** Active (green toggle ON)
- **Scope:** All events
- **Endpoint URL:** `https://hlhilbrbsaqjjpaguxod.supabase.co/functions/v1/webhook-incoming?token=a21b4646977928ad3c568b9d93dba0...`
- **Default event:** Latest event (default)
- **Saved** status confirmed

**Key observations:**
- Both point to **Supabase Edge Functions** (`supabase.co/functions/v1/webhook-incoming`)
- Authentication via **query parameter token** (long hex string)
- The Supabase project ID is `hlhilbrbsaqjjpaguxod`
- Each incoming endpoint gets its own unique token
- Default event = "Latest event (default)" — when a request doesn't specify `event_id`, it routes to the latest event

### 4.3 Outgoing Webhooks (UnikScan → CRM)

**ONE outgoing endpoint configured:**

**Name:** `Outgoing endpoint`
- **Status:** Active (green toggle ON)
- **Scope:** All events
- **Destination URL:** `https://myappzbackend.com/functions/v1/workflow-webhook/dyrcp976ed2xhw0k`
- **Event scope:** All events (dropdown)

**Events to send (5 event types):**
1. `Attendee registered` (green pill)
2. `Attendee checked in` (green pill)
3. `Selfie captured` (green pill)
4. `Kit collected` (green pill)
5. `Payment completed` (green pill)

**Security:**
- **Custom headers & fields** — expandable section for adding auth headers
- **Example payload (JSON)** — expandable section showing payload structure
- **Signing secret:** masked (`•••••••••••••••`) with show/copy/regenerate buttons
- **Signature mode:** "No signature (open...)" dropdown — options likely include HMAC-SHA256, etc.
- **Send test** button — sends a test webhook to verify connectivity

### 4.4 Delivery Monitoring (Recent Deliveries)

**Dashboard metrics:**
- **SUCCESS RATE:** 100% (green)
- **FAILED (24H):** 0
- **AVG LATENCY:** 2760 ms

**Filters:** Search URL/error/code, All events dropdown, All status dropdown, date range

**Delivery log entries:**

| Direction | Event | URL | Latency | Status | Date |
|-----------|-------|-----|---------|--------|------|
| OUTGOING | test.ping | `https://myappzbackend.com/functions/v1/workflow-webhook/dyrcp976ed2xhw0k` | 867ms | 200 | 9 Nov, 10:06 am |
| OUTGOING | test.ping | `https://myappzbackend.com/functions/v1/workflow-webhook/dyrcp976ed2xhw0k` | 401ms | 200 | 9 Nov, 10:06 am |
| OUTGOING | attendee.checke... | `https://myappzbackend.com/functions/v1/workflow-webhook/p55uu03kz...` | 3301ms | 200 | 15 Oct, 10:02 am |
| OUTGOING | attendee.checke... | `https://myappzbackend.com/functions/v1/workflow-webhook/p55uu03kz...` | 2209ms | 200 | 14 Oct, 09:16 am |
| OUTGOING | attendee.checke... | (same URL) | 2194ms | 200 | 14 Oct, 09:16 am |
| OUTGOING | attendee.checke... | (same URL) | 2195ms | 200 | 13 Oct, 01:44 pm |
| OUTGOING | attendee.checke... | (same URL) | 2903ms | 200 | 13 Oct, 12:59 pm |
| OUTGOING | attendee.checke... | (same URL) | 2284ms | 200 | 13 Oct, 12:32 pm |

**Key observations:**
- Two different workflow webhook IDs used: `dyrcp976ed2xhw0k` (test.ping + outgoing config) and `p55uu03kz...` (attendee.checked_in events)
- All deliveries returning HTTP 200 — 100% success rate
- Latency ranges from 401ms to 3301ms (average ~2760ms)
- `test.ping` events sent on Nov 9 — active testing happening TODAY
- `attendee.checked_in` events flowing from Oct 13–15 to a different CRM workflow
- The CRM destination is **MyAppz backend**: `myappzbackend.com/functions/v1/workflow-webhook/{workflow_id}`

---

## 5. Automations Tab (Screenshot 54)

### Auto-Trigger Rules

**Two columns: WhatsApp Automations | Email Automations**

**Three trigger events for each channel:**

| Trigger | WhatsApp | Email |
|---------|----------|-------|
| **On Entry Scan** | Template ID — required to enable. Only send to plan (blank = all). Never run. | Template Name/ID — required to enable. Only send to plan (blank = all). Never run. Preview button. |
| **On Registration** | Template ID — required to enable. Only send to plan (blank = all). Never run. | Template Name/ID — required to enable. Only send to plan (blank = all). **Last run 25 Oct, 10:53 am.** Preview button. |
| **On Update** | Template ID — required to enable. Only send to plan (blank = all). Never run. | Template Name/ID — required to enable. Only send to plan (blank = all). **Last run 23 Oct, 09:33 pm.** Preview button. |

**Configuration per rule:**
- Toggle switch (ON/OFF) — all currently OFF
- Template ID/Name field — must provide template to enable
- Plan filter — "Only send to plan (blank = all)" — target specific ticket tiers

**Test Connectivity section at bottom:**
- Test Recipient: Email or Phone input field (`example@mail.com or 91XXXXXXXXXX`)
- **Test Email** button
- **Test WA** button

**Key observations:**
- Email "On Registration" automation last ran Oct 25 — proving the system works
- Email "On Update" automation last ran Oct 23 — record update notifications work
- WhatsApp automations haven't run yet (provider disabled)
- Each automation links to a template (from the Templates tab)
- Plan-based filtering = per-tier notifications (VIP gets different email than General)

---

## 6. Email Templates Tab (Screenshots 52, 53)

### Default Ticket Email Template

**Auto-sent on registration.** The generated ticket image is attached (never stored).

**Template preview shows:**
```
QR UNIKLIFE
You're registered!
Here's your ticket — show it at the entrance.

BOSS TIRUPATI
📅 Sunday, 28 June 2026 · 09:00
📍 Hotel Pai Viceroy, Tirupati

ATTENDEE
Jane Doe          [VIP badge]
TICKET ID
BOSS-001

YOUR TICKET
[QR Code placeholder]
```

**Available placeholders:**

| Placeholder | Description |
|-------------|-------------|
| `{{name}}` | The attendee's full name |
| `{{ticket_id}}` | Their ticket number, e.g. UBM-B17-042 |
| `{{plan}}` | The plan or tier they registered for |
| `{{event_name}}` | The event's name |
| `{{event_date}}` | The event's start date |
| `{{location}}` | Where the event is held |

**Three template types (tabs):**
1. **Registration** — sent when attendee registers
2. **Entry Scan** — sent when attendee's QR is scanned at entry
3. **Record Update** — sent when attendee record is modified

**Custom HTML section:**
- "Registration Email HTML" editor
- INSERT buttons for each placeholder
- **Send test to me** button
- **History** button (view past sent emails)
- **Load Sample** button (load default HTML)
- "This branded template is used automatically — no setup needed. Leave the boxes below empty to keep it, or paste custom HTML to override a specific trigger."

---

## 7. Branding Tab (Screenshot 51)

### Platform Branding
- **Platform name:** (empty — using UnikScan default)
- **Browser tab title:** (empty)
- **Platform Logo:** No logo — Upload logo button + "or paste an image URL"
- **Brand Colors:**
  - Primary: `#6366f1` (indigo/purple)
  - Secondary: `#14b8a6` (teal/green)
- Colors applied to: registration, ticket, portal (attendee-facing pages)

### Google Integration
- **Connected:** `Uniklife01@Gmail.Com`
- **Status:** "Connected and syncing real-time"
- **Disconnect** button available

---

## 8. Comm Logs Tab (Screenshot 50)

### Recent Communications

**Full communication audit trail:**

| Column | Description |
|--------|-------------|
| Type | Email (envelope icon) |
| Recipient | Email address of the recipient |
| Event/Attendee | Attendee name + event name |
| Status | `success` (green badge) |
| Date | Timestamp |
| Action | (action buttons) |

**Filters:** Search recipient/attendee/event, All types dropdown, All status dropdown, Date range

**Export CSV** button + **Refresh** button

**Sample log entries (all from Oct 25, "Transform Your Life 2026" event):**
- K. MAHESH GOUD (2 emails) → `ipm.m008@gmail.com` → success, 10:53
- Seshakumari (2 emails) → `seshakumarigynec@gmail.com` → success, 10:16
- Konda ravinder (2 emails) → `ravicharanadigital@gmail.com` → success, 10:14
- Saad (1 email) → `saadmd821@gmail.com` → success, 09:49
- Sunitha (1 email) → `suneetharachoori2024@gmail.com` → success, 09:49
- Suman yerramsetty (2 emails) → `vikrantfurniture@gmail.com` → success, 09:45
- Ramesh (1 email) → `rame143rothiya@gmail.com` → success, 09:34

**Pattern:** Two emails per attendee = (1) Registration confirmation + (2) Ticket with QR code attachment

---

## 9. THE PROVEN ARCHITECTURE — How It All Connects

```
┌─────────────────────────────────────────────────────────────────┐
│                    UnikScan Frontend                             │
│                  (qr.venukalyan.ai)                              │
│                                                                  │
│  Events → Attendees → Scanner → Payments → Templates            │
│                                                                  │
│  Settings:                                                       │
│    ├── Integrations (Razorpay, WhatsApp, Resend Email)          │
│    ├── Webhooks (Incoming + Outgoing)                            │
│    ├── Automations (WhatsApp + Email triggers)                   │
│    ├── Email Templates (Registration, Entry Scan, Update)       │
│    ├── Branding (Logo, Colors)                                   │
│    └── Comm Logs (Delivery audit trail)                          │
└──────────────┬──────────────────────┬────────────────────────────┘
               │                      │
               │ OUTGOING             │ INCOMING
               │ (5 event types)      │ (webhook-incoming)
               │                      │
               ▼                      │
┌──────────────────────────┐          │
│   MyAppz CRM Backend     │          │
│   (myappzbackend.com)    │          │
│                          │          │
│   /functions/v1/         │          │
│   workflow-webhook/      │──────────┘
│   {workflow_id}          │
│                          │
│   Receives:              │   Sends:
│   - attendee.registered  │   - contact.updated
│   - attendee.checked_in  │   - lead.status_changed
│   - selfie.captured      │   - appointment.created
│   - kit.collected        │   - payment.received
│   - payment.completed    │
└──────────────────────────┘
               │
               ▼
┌──────────────────────────┐
│   Supabase Edge Functions│
│   (hlhilbrbsaqjjpaguxod) │
│                          │
│   /functions/v1/         │
│   webhook-incoming       │
│   ?token={auth_token}    │
│                          │
│   Processes incoming     │
│   webhooks and updates   │
│   the frontend database  │
└──────────────────────────┘
```

### The 2-Way Sync Flow:

**OUTGOING (Frontend → CRM):**
```
1. User action in UnikScan (e.g., attendee registers)
2. UnikScan fires event: "attendee.registered"
3. Webhook system checks: Is there an outgoing endpoint for this event? ✅
4. HTTP POST to: https://myappzbackend.com/functions/v1/workflow-webhook/{id}
   - Payload: JSON with attendee data, event context
   - Headers: Custom headers + signing secret (HMAC)
5. CRM receives → creates/updates Contact, runs workflow automation
6. Delivery logged in Recent Deliveries (status 200, latency tracked)
7. If failed → logged with error code, searchable in delivery log
```

**INCOMING (CRM → Frontend):**
```
1. CRM action (e.g., staff updates contact in CRM)
2. CRM workflow fires webhook to UnikScan's incoming URL
3. HTTP POST to: https://hlhilbrbsaqjjpaguxod.supabase.co/functions/v1/webhook-incoming?token={token}
4. Supabase Edge Function receives:
   - Validates token (authentication)
   - Parses payload
   - Routes to correct event (or "Latest event" default)
   - Updates database record
5. Frontend reflects the change on next load/refresh
```

**AUTOMATION (Event → Notification):**
```
1. Event fires (registration, entry scan, record update)
2. Automation rules checked:
   - WhatsApp: Template ID configured? Plan filter matches? → Send WhatsApp
   - Email: Template Name/ID configured? Plan filter matches? → Send Email
3. Template rendered with placeholders ({{name}}, {{ticket_id}}, etc.)
4. Communication sent via provider (Resend for email, WhatsApp API for WA)
5. Result logged in Comm Logs (recipient, status, timestamp)
```

---

## 10. Mapping UnikScan → Healthy Lifestyle Module

### Direct Pattern Reuse

| UnikScan Feature | Healthy Lifestyle Equivalent | Reuse |
|-----------------|----------------------------|-------|
| **Events** | Coaching Programs / DMIT Test Types | Same concept — a container for sessions |
| **Attendees** | Clients (Parents + Children) | Same concept — people being served |
| **Scanner** | N/A (no QR entry) | Skip |
| **Payments** (Razorpay) | Payments (Razorpay) | 100% reuse |
| **Templates** | Session/Report email templates | Same pattern, different content |
| **Google Sheets** | Google Sheets export | 100% reuse |
| **Affiliates** | Referral tracking | 80% reuse |
| **Comm Logs** | Communication audit trail | 100% reuse |

### Settings Tab Mapping

| UnikScan Settings Tab | Healthy Lifestyle Equivalent |
|----------------------|------------------------------|
| **Integrations** | Same: Razorpay + WhatsApp API + Resend Email |
| **Webhooks** | Same: Incoming (CRM → App) + Outgoing (App → CRM) |
| **Automations** | Same structure, different triggers (see below) |
| **Email Templates** | Same structure, different templates |
| **Branding** | Same: Platform name, logo, colors |
| **Comm Logs** | Same: Full audit trail |

### Webhook Event Mapping

**UnikScan Events → Healthy Lifestyle Events:**

| UnikScan Event | Parenting Coaching Equivalent | DMIT Equivalent |
|---------------|------------------------------|-----------------|
| `attendee.registered` | `client.enquiry_created` | `dmit.client_registered` |
| `attendee.checked_in` | `session.started` | `dmit.scan_collected` |
| `selfie.captured` | N/A | `dmit.fingerprint_captured` |
| `kit.collected` | `resource.shared` | `dmit.report_delivered` |
| `payment.completed` | `payment.verified` | `dmit.payment_verified` |

### Automation Trigger Mapping

**UnikScan Triggers → Healthy Lifestyle Triggers:**

| UnikScan Trigger | Parenting Coaching | DMIT |
|-----------------|-------------------|------|
| **On Registration** | On Enquiry Created | On Client Registered |
| **On Entry Scan** | On Session Started | On Scan Collected |
| **On Update** | On Record Updated | On Status Changed |
| *(new)* | On Session Completed | On Report Ready |
| *(new)* | On Goal Achieved | On Report Delivered |
| *(new)* | On Package Renewed | On Counseling Completed |

### Email Template Mapping

**UnikScan Templates → Healthy Lifestyle Templates:**

| UnikScan Template | Parenting Coaching | DMIT |
|------------------|-------------------|------|
| **Registration email** | Welcome + consultation booking | Welcome + test scheduling |
| **Entry Scan email** | Session confirmation | Fingerprint scan confirmation |
| **Record Update email** | Progress update notification | Status change notification |
| *(new)* | Session summary + action items | Report ready notification |
| *(new)* | Goal achievement celebration | Counseling session summary |
| *(new)* | Package renewal reminder | Re-assessment offer |

### Placeholder Mapping

**UnikScan Placeholders → Healthy Lifestyle Placeholders:**

| UnikScan | Parenting Coaching | DMIT |
|----------|-------------------|------|
| `{{name}}` | `{{client_name}}` | `{{parent_name}}` |
| `{{ticket_id}}` | `{{session_id}}` | `{{test_id}}` |
| `{{plan}}` | `{{program_name}}` | `{{report_tier}}` |
| `{{event_name}}` | `{{program_name}}` | `{{test_type}}` |
| `{{event_date}}` | `{{session_date}}` | `{{test_date}}` |
| `{{location}}` | `{{session_mode}}` (Video/In-person) | `{{center_name}}` |
| *(new)* | `{{coach_name}}` | `{{counselor_name}}` |
| *(new)* | `{{child_name}}` | `{{child_name}}` |
| *(new)* | `{{next_session}}` | `{{report_url}}` |
| *(new)* | `{{goals_summary}}` | `{{dominant_intelligence}}` |

---

## 11. Outgoing Webhook Payload Design (App → CRM)

Based on UnikScan's pattern, here's the payload structure for Healthy Lifestyle:

### Parenting Coaching — `enquiry.created`
```json
{
  "event": "enquiry.created",
  "timestamp": "2026-11-09T10:30:00Z",
  "organization_id": "uuid",
  "data": {
    "enquiry_id": "uuid",
    "parent_name": "Priya Sharma",
    "parent_phone": "+919876543210",
    "parent_email": "priya@example.com",
    "child_name": "Arjun",
    "child_age": 8,
    "concern_area": ["Behavioral issues", "Screen time"],
    "family_situation": "Nuclear family",
    "referral_source": "Google",
    "referred_by": "Sunita Menon"
  }
}
```

### Parenting Coaching — `session.completed`
```json
{
  "event": "session.completed",
  "timestamp": "2026-11-09T11:00:00Z",
  "organization_id": "uuid",
  "data": {
    "session_id": "uuid",
    "client_id": "uuid",
    "session_number": 3,
    "duration_minutes": 45,
    "type": "Regular",
    "mode": "Video call",
    "coach_name": "Dr. Meera",
    "action_items": ["Practice calm-down breathing", "15-min family game time daily"],
    "next_session": "2026-11-16T10:00:00Z",
    "sessions_completed": 3,
    "total_sessions": 8
  }
}
```

### DMIT — `dmit.report_delivered`
```json
{
  "event": "dmit.report_delivered",
  "timestamp": "2026-11-09T14:00:00Z",
  "organization_id": "uuid",
  "data": {
    "test_id": "uuid",
    "client_id": "uuid",
    "child_name": "Arjun",
    "test_type": "Student",
    "report_tier": "Standard",
    "report_url": "https://storagev2.files-vault.com/uploads/...",
    "dominant_intelligence": "Logical-Mathematical",
    "learning_style": "Visual",
    "brain_dominance": "Left 58% / Right 42%",
    "counselor_assigned": "Dr. Rakesh",
    "counseling_date": "2026-11-12T10:00:00Z"
  }
}
```

---

## 12. Incoming Webhook Payload Design (CRM → App)

Based on UnikScan's Supabase Edge Function pattern:

### CRM Contact Updated
```json
{
  "event": "contact.updated",
  "source": "crm",
  "timestamp": "2026-11-09T15:00:00Z",
  "data": {
    "crm_contact_id": "ghl_abc123",
    "fields_changed": {
      "coaching_program": "Positive Parenting Foundations",
      "sessions_completed": 4,
      "package_status": "Active",
      "next_session": "2026-11-16"
    }
  }
}
```

### CRM Pipeline Stage Changed
```json
{
  "event": "lead.stage_changed",
  "source": "crm",
  "timestamp": "2026-11-09T15:30:00Z",
  "data": {
    "crm_contact_id": "ghl_abc123",
    "previous_stage": "Consultation Scheduled",
    "new_stage": "Enrolled",
    "pipeline": "Healthy Lifestyle"
  }
}
```

---

## 13. Implementation Plan — What to Build

### 13.1 Settings Page Structure (Reuse from UnikScan)

```
Settings → /settings
  ├── Integrations    → /settings/integrations
  │     ├── Payment Gateway (Razorpay)
  │     ├── WhatsApp API (provider dropdown)
  │     └── Email Delivery (Resend — sender name, from, reply-to, API key)
  │
  ├── Webhooks        → /settings/webhooks
  │     ├── Incoming endpoints (URL + token + default event + toggle)
  │     ├── Outgoing endpoints (URL + events to send + signing secret + signature mode)
  │     └── Recent Deliveries (success rate, failed, avg latency, log table)
  │
  ├── Automations     → /settings/automations
  │     ├── WhatsApp Automations (per trigger: template ID + plan filter + toggle)
  │     ├── Email Automations (per trigger: template Name/ID + plan filter + toggle + preview)
  │     └── Test Connectivity (test recipient input + Test Email + Test WA buttons)
  │
  ├── Email Templates → /settings/templates
  │     ├── Default email template (preview + placeholders)
  │     ├── Per-trigger tabs (Registration, Session Complete, Report Ready, etc.)
  │     ├── Custom HTML editor with INSERT placeholder buttons
  │     └── Send test to me + History + Load Sample
  │
  ├── Branding        → /settings/branding
  │     ├── Platform name + Browser tab title
  │     ├── Platform Logo (upload or URL)
  │     ├── Brand Colors (Primary + Secondary hex pickers)
  │     └── Google Integration (connect/disconnect)
  │
  └── Comm Logs       → /settings/comm-logs
        ├── Search + filters (type, status, date range)
        ├── Table: Type, Recipient, Event/Client, Status, Date, Action
        └── Export CSV + Refresh
```

### 13.2 Webhook Service (Core Engine)

**This is the engine that powers the 2-way sync. Same pattern as UnikScan.**

```
src/lib/services/webhooks.ts

Functions:
- listEndpoints(auth, direction: 'incoming' | 'outgoing')
- createEndpoint(auth, { name, url, direction, events, signingSecret, signatureMode })
- updateEndpoint(auth, endpointId, updates)
- deleteEndpoint(auth, endpointId)
- toggleEndpoint(auth, endpointId, active: boolean)
- sendWebhook(auth, endpointId, event, payload) → fires outgoing
- receiveWebhook(token, payload) → processes incoming
- listDeliveries(auth, filters) → delivery log
- getDeliveryStats(auth) → success rate, failed count, avg latency
- sendTestPing(auth, endpointId) → test.ping event
```

### 13.3 Automation Service

```
src/lib/services/automations.ts

Functions:
- listRules(auth)
- createRule(auth, { trigger, channel, templateId, planFilter, active })
- updateRule(auth, ruleId, updates)
- toggleRule(auth, ruleId, active: boolean)
- executeRule(auth, trigger, context) → checks rules, sends notifications
- testConnectivity(auth, channel, recipient) → sends test message
```

### 13.4 Communication Log Service

```
src/lib/services/comm-logs.ts

Functions:
- logCommunication(auth, { type, recipient, event, clientName, status, metadata })
- listLogs(auth, filters)
- exportCSV(auth, filters)
```

### 13.5 Database Tables Needed

```sql
-- Webhook endpoints (incoming + outgoing)
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',     -- event types to listen for / send
  event_scope TEXT NOT NULL DEFAULT 'all', -- 'all' or specific scope
  signing_secret TEXT,
  signature_mode TEXT DEFAULT 'none',      -- 'none', 'hmac-sha256'
  auth_token TEXT,                         -- for incoming endpoints
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Webhook delivery log
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id),
  direction TEXT NOT NULL,
  event_type TEXT NOT NULL,                -- e.g. 'attendee.registered', 'session.completed'
  url TEXT NOT NULL,
  request_payload JSONB,
  response_status INT,
  response_body TEXT,
  latency_ms INT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'success', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Automation rules
CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  trigger_event TEXT NOT NULL,             -- 'on_registration', 'on_session_complete', etc.
  channel TEXT NOT NULL,                   -- 'email', 'whatsapp'
  template_id TEXT,                        -- template identifier
  plan_filter TEXT,                        -- only send to specific plan/program (blank = all)
  is_active BOOLEAN DEFAULT false,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Communication logs
CREATE TABLE communication_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,                      -- 'email', 'whatsapp', 'sms'
  recipient TEXT NOT NULL,                 -- email address or phone number
  client_name TEXT,
  event_context TEXT,                      -- e.g. "Session 3 — Positive Parenting"
  template_id TEXT,
  status TEXT NOT NULL,                    -- 'success', 'failed', 'pending', 'bounced'
  provider_response JSONB,                -- raw response from Resend/WhatsApp API
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Integration credentials (per org)
CREATE TABLE integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL,                  -- 'razorpay', 'whatsapp', 'resend'
  credentials JSONB NOT NULL,             -- encrypted: { api_key, secret, sender_name, from_address, etc. }
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, provider)
);

-- Email templates
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,              -- 'registration', 'session_complete', 'report_ready', etc.
  subject TEXT NOT NULL,
  html_content TEXT,                       -- custom HTML (blank = use default branded template)
  placeholders TEXT[] NOT NULL DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 14. Key Takeaways

### What UnikScan Proves Works:
1. **Supabase Edge Functions for incoming webhooks** — token-based auth, works reliably
2. **MyAppz workflow-webhook endpoint for outgoing** — 100% success rate, ~2.7s avg latency
3. **Event-based architecture** — discrete events (`attendee.registered`, `payment.completed`) trigger specific actions
4. **Template-based notifications** — merge tag placeholders, per-trigger templates, custom HTML override
5. **Delivery monitoring** — success rate, latency tracking, searchable log with date filtering
6. **Per-event webhook routing** — different workflow IDs for different event types
7. **Toggle-based activation** — each endpoint and automation rule has an on/off toggle
8. **Test connectivity** — test.ping events + Test Email/WA buttons for verification
9. **Communication audit trail** — every message logged with recipient, status, timestamp
10. **Razorpay for payments** — already the active provider, same for Healthy Lifestyle

### What We Build New:
1. **More event types** — UnikScan has 5 events, Healthy Lifestyle needs ~18 (9 coaching + 9 DMIT)
2. **More automation triggers** — UnikScan has 3 triggers, we need 6+ per submodule
3. **More template placeholders** — child_name, coach_name, report_url, goals_summary, etc.
4. **CRM field sync** — UnikScan syncs attendee data, we sync coaching/DMIT custom fields
5. **Report delivery via Vault** — UnikScan doesn't generate reports; DMIT needs report URL in webhook payload

### What We DON'T Build:
- The webhook infrastructure is the SAME — endpoints, deliveries, signing, monitoring
- The automation pattern is the SAME — trigger → check rules → send notification → log
- The settings UI is the SAME — 6 tabs with the same structure
- The Supabase Edge Function for incoming is the SAME — token auth, payload processing
- The MyAppz destination URL pattern is the SAME — `myappzbackend.com/functions/v1/workflow-webhook/{id}`

**Bottom line:** UnikScan is the blueprint. We're adding more event types and templates, not building a new system.
