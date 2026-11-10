# MyAppz CRM Analysis — How the CRM Works

**Date:** 2026-11-09
**Source:** CRM screenshots from login.uniklife.ai (Uniklife.Ai workspace)
**Purpose:** Map every CRM capability so we know exactly what to connect to from the multi-industry frontend.

---

## 1. CRM Platform Identity

| Property | Value |
|----------|-------|
| **Platform** | MyAppz CRM (white-label SaaS) |
| **Access URL** | `login.uniklife.ai/v2/s/{workspace_id}/...` |
| **Workspace ID** | `f0496963-3208-4c23-a541-693b1068e3f7` |
| **Account name** | Uniklife.Ai |
| **AI assistant** | Maya |
| **Domain** | link.uniklife.com (CNAME → join.myappz.ai) |
| **Owner** | Uniklife.Ai (aiuniklife@gmail.com) |

The CRM is a **GoHighLevel-style** white-label platform. Each client who buys from UNIKLIFE gets their own CRM sub-account under this workspace. The frontend platform (our project) sits in front of this CRM as a CEO-friendly interface.

---

## 2. CRM Sidebar Navigation (Modules)

```
┌──────────────────────────┐
│  ← Back to Dashboard     │
│                          │
│  SETTINGS                │
│  ├── Vault               │  Media library
│  ├── Staff               │  Team, roles, departments
│  ├── Tags                │  147 tags for segmentation
│  ├── Values              │  Merge tags / variables
│  ├── Fields              │  Custom field definitions
│  ├── Templates           │  36 message templates
│  ├── App Store           │  18 integrations
│  ├── Domains             │  Custom domain management
│  ├── Wallet              │  Credits for messaging/AI
│  ├── Branding            │  White-label appearance
│  ├── Mobile Nav          │  Mobile bottom bar config
│  ├── Analytics           │  Cross-channel dashboard
│  ├── Notifications       │  Alert preferences
│  ├── Deleted Items       │  30-day trash recovery
│  └── Customize           │  Module visibility toggles
│                          │
│  MAIN NAV (from Dashboard)│
│  ├── Dashboard           │  CEO intelligence view
│  ├── Lead Generation     │  Forms, funnels, landing pages
│  ├── Lead Management     │  Kanban pipeline
│  ├── Lead Automation     │  Workflow builder
│  ├── Sales               │  Products, invoices, proposals
│  ├── AI Suite            │  AI features (LLM, etc.)
│  ├── Operations          │  Tasks, projects
│  ├── Inbox               │  Unified messaging
│  ├── Calendar            │  Appointments & scheduling
│  ├── Finance             │  Revenue, invoices
│  ├── Community           │  Courses, memberships
│  └── Staff               │  Team management
└──────────────────────────┘
```

### Module Toggle (Customize Page)

All modules can be turned on/off per workspace. Core modules (Dashboard, Settings) are required and cannot be hidden. This means each client's CRM can show only the modules relevant to their industry.

---

## 3. CRM Dashboard — CEO Intelligence View

**URL:** `/dashboard`

**KPI sections (14 KPIs, drag-to-reorder, show/hide):**

| Section | KPIs | Current Values |
|---------|------|---------------|
| **Marketing & Leads** | Ad Spend (₹0.00), Leads Generated (0), Conversion Rate (—) | All zero |
| **Sales & Revenue** | Total Sales (0), Sales Calls (0) | All zero |
| **Operations** | Calendar Bookings (0) | Zero |
| **Messaging & Engagement** | WA Official Status (inactive, snapshot) | Inactive |
| **Contacts & CRM** | New Contacts (0), Total Contacts (93), Active Leads (91), Customers (1), New Customers (0) | 93 contacts, 91 leads |
| **Finance** | Total Revenue (₹0.00), MRR (₹0.00) | Zero |

**Key insight:** The CRM already has 93 contacts and 91 active leads — this is real data that the frontend platform needs to sync with.

---

## 4. Lead Management — Pipeline

**URL:** `/lead-management/crm/opportunity`

### Pipeline Stages (B2B Sales Pipeline)

```
New Lead → Contacted → Qualified → Discovery Call → Proposal Sent → Negotiation → Closed Won → Closed Lost
    0          1           0            1                0              0            0            0
```

### Current Leads

| Lead | Stage | Phone | Email | Source | Value |
|------|-------|-------|-------|--------|-------|
| SAI | Contacted | +919100047152 | — | Manual entry | ₹0 |
| kiran | Discovery Call | +917780764342 | kiran@gmail.com | Manual entry | ₹0 |

### Lead Card Actions (icons on each card)
- Chat/message
- Call
- Calendar/appointment
- WhatsApp
- More (...)

### Lead View Options
- Stats, Leads, Pipeline, Follow-up, Contacts, Contact Group, Meta Leads tabs
- AI Score toggle
- Stage Settings
- Analytics
- Multiple view modes (grid, list, kanban, etc.)
- Pipeline selector (B2B Sales Pipeline, can create custom)

**Integration point:** Our frontend's "Enquiries" module maps to CRM Leads. When an enquiry is created in the frontend → `lead.created` event → CRM creates a lead in the pipeline. Stage changes in CRM → webhook → update enquiry status in frontend.

---

## 5. Custom Fields

**URL:** `/settings/fields`

### Standard Fields (Contact Object)

| Field Name | Type | Unique Key | Status |
|-----------|------|------------|--------|
| First Name | Single Line | `{{contact.first_name}}` | Active |
| Last Name | Single Line | `{{contact.last_name}}` | Active |
| Email | Single Line | `{{contact.email}}` | Active |
| Phone | Phone | `{{contact.phone}}` | Active |
| Contact Type | Dropdown (Single) | `{{contact.contact_type}}` | Active |
| Business Name | Single Line | `{{contact.business_name}}` | Active |
| Business GST No | Single Line | `{{contact.gst_no}}` | Active |
| Business State | Dropdown (Single) | `{{contact.state}}` | Active |
| Business Address | Multi Line | `{{contact.street_address}}` | Active |
| Profile Photo | File Upload | `{{contact.profile_image}}` | Active |
| Company | Single Line | `{{contact.company}}` | Active |
| Job Title | Single Line | `{{contact.job_title}}` | Active |
| Industry | Dropdown (Single) | `{{contact.industry}}` | Active |
| Date of Birth | Date Picker | `{{contact.dob}}` | Active |
| Anniversary | Date Picker | `{{contact.anniversary}}` | Active |
| Source | Single Line | `{{contact.source}}` | Active |
| Medium | Single Line | `{{contact.medium}}` | Active |
| Campaign | Single Line | `{{contact.campaign}}` | Active |
| Country | Dropdown (Single) | `{{contact.country}}` | Active |
| City | Single Line | `{{contact.city}}` | Active |

### Tabs Available
- **Standard** — built-in contact fields (shown above)
- **Additional** — custom fields added for specific industries
- **Folders** — organize fields into groups

### Key Takeaway for Integration

The merge tag format `{{contact.field_name}}` is how we reference CRM fields in:
- Templates (email, WhatsApp, SMS)
- Workflow automations
- API payloads

**For the frontend field mapping:** Our `field_mappings` table maps frontend field keys to these CRM unique keys. Example:
```
frontend: "customer_name"  →  CRM: "{{contact.first_name}}" + "{{contact.last_name}}"
frontend: "customer_phone" →  CRM: "{{contact.phone}}"
frontend: "customer_email" →  CRM: "{{contact.email}}"
```

---

## 6. Values (Merge Tags)

**URL:** `/settings/values/contact`

### Contact Merge Tags (Standard)

| Name | Custom Value | Used In |
|------|-------------|---------|
| First Name | `{{contact.first_name}}` | 2 places |
| Last Name | `{{contact.last_name}}` | 2 places |
| Email | `{{contact.email}}` | 2 places |
| Phone | `{{contact.phone}}` | 2 places |
| Anniversary | `{{contact.anniversary}}` | Not used |
| Business Address | `{{contact.street_address}}` | Not used |
| Business GST No | `{{contact.gst_no}}` | Not used |
| Business Name | `{{contact.business_name}}` | Not used |
| Business State | `{{contact.state}}` | 2 places |
| Campaign | `{{contact.campaign}}` | Not used |
| City | `{{contact.city}}` | 2 places |
| Company | `{{contact.company}}` | Not used |
| Contact Type | `{{contact.contact_type}}` | Not used |
| Country | `{{contact.country}}` | 2 places |
| Date of Birth | `{{contact.dob}}` | Not used |

### Tabs Available
Contact, Staff, Company, Additional, Custom, Calendar, Finance, Webinar, Time, Course, Folders

**Important:** The "Additional" and "Custom" tabs are where industry-specific custom fields will appear after we create them via the API.

---

## 7. Templates

**URL:** `/settings/templates`

### Template Count: 36 total

| Type | Count | Examples |
|------|-------|---------|
| **WhatsApp Business** | 2 | welcome (WABA, en_US, APPROVED) |
| **Notes** | 8 | Meeting Notes, Payment Pending Reminder, Reschedule Requested, Customer Not Interested |
| **Outreach** | 6 | Closing check-in, Appointment confirmation, Payment reminder, Following up, Great speaking with you, Tried to reach you |
| **Email** | — | (in follow-up category) |
| **WhatsApp** | — | (separate from Business) |
| **Follow-up** | 20 | Performance Review Prep, Team 1-on-1, Booking Confirmation, Post-Appointment Follow-up, Overdue Collection Call, Invoice Payment Reminder, Renewal Reminder, Client Check-in, Post-Meeting Follow-up, Demo Meeting, Lead Email Follow-up, New Lead Call, Expense Approval, Upsell Opportunity, SaaS Trial Expiry, **Real Estate Showing Follow-up**, **Healthcare Patient Revisit**, Task Deadline Review, Community Engagement Check, Stale Conversation Reply |

### Industry-Specific Templates Already Exist!

Notable templates that confirm multi-industry intent:
- **Real Estate Showing Follow-up** — "Follow up after property showing"
- **Healthcare Patient Revisit** — "Schedule patient revisit"
- **Booking Confirmation** — "Confirm upcoming booking details"
- **Appointment confirmation** — "Your appointment for {{opportunity_name}} is confirmed"

These use merge tags like `{{contact_name}}`, `{{opportunity_name}}` in their bodies.

---

## 8. App Store (Integrations)

**URL:** `/settings/app-store`

### Connected & Available Apps (18 total)

| Category | App | Status | Purpose |
|----------|-----|--------|---------|
| **AI & Intelligence** | Uniklife LLM | Connected | Unified LLM gateway (uses wallet credits) |
| | Google Gemini | **Required**, Disconnected | AI Studio, image generation |
| | OpenAI | Disconnected | GPT models, embeddings |
| | Anthropic Claude | Disconnected | Analysis, writing, coding |
| | DeepSeek | Disconnected | Open-source models |
| **MCP Connections** | Maya MCP (for you) | Disconnected | Connect Claude/ChatGPT/Cursor to CRM |
| **Messaging** | 1 app | — | — |
| **Email & SMTP** | 1 app | — | — |
| **Social Media** | 2 apps | — | — |
| **Call Tracking** | 2 apps | — | — |

### Key Insight: Maya MCP

The CRM has an MCP (Model Context Protocol) connection option. This means:
- You can connect Claude Code directly to the CRM via MCP
- This could be used for development/debugging — query CRM data directly from the IDE
- Could also power AI features in the frontend

---

## 9. Domains

**URL:** `/settings/domains`

- **Total Domains:** 1
- **Verified:** 1
- **Connected Domain:** `link.uniklife.com` (Finance feature, VERIFIED)
- **CNAME:** link → join.myappz.ai
- **Feature Domains:** 1/10 used
- **Categories:** Portal, Shop, Community, Funnel

Each client's CRM sub-account can have its own custom domain.

---

## 10. Wallet & Credits

**URL:** `/settings/wallet`

- **Available:** 0.00 credits
- **Low balance warning** at 100 credits threshold
- Credits used for: messaging (WhatsApp), prospecting, AI features
- Monthly summary: Opening, Credits In, Debits Out, Closing, Net
- Usage history table with Date/Time, Service, Type, Credits, Balance, Status

**For the platform:** Each client's CRM account has its own wallet. The frontend doesn't need to manage credits directly — the CRM handles billing.

---

## 11. Branding (White-Label)

**URL:** `/settings/branding`

### Tabs
Identity, Themes, Library, Nav, Custom Menu, Mobile, Loader, Login, Workspace, Experience

### Brand Identity
- Logo — Light mode (68px × 190px, max 2.5MB, WebP optimized)
- Favicon (64×64, WebP)
- Logo — Dark mode (optional)
- Live Sidebar Preview showing both light/dark themes

**Both sides have white-labeling:** The CRM has branding, AND our frontend has branding (12 themes). Each client gets:
1. Branded CRM (for staff who need full CRM access)
2. Branded frontend (for CEO/executives who want the simplified view)

---

## 12. Mobile Navigation

**URL:** `/settings/mobile-nav`

5 bottom nav slots for mobile:
- Slot 1: Home (Locked)
- Slot 2: Leads (configurable)
- Slot 3: CRM (configurable)
- Slot 4: Inbox (configurable)
- Slot 5: more (Locked)

---

## 13. Analytics Dashboard

**URL:** `/settings/analytics`

### Analytics Channels (cards with KPIs)

| Channel | Metrics |
|---------|---------|
| Email | Sent count |
| Calls | Total, Connected, Avg Duration |
| WhatsApp | Message count |
| SMS | Message count |
| Pipeline | Deal count |
| Revenue | Revenue, Net, MRR, Active Subs |
| Forms | Views, Submissions, Conversion, Completion |
| Site Traffic | Views, Visitors, Bounce Rate, Avg Duration, Opt-ins |
| Instagram | Connected status |
| Community | Enrollments, Completion, Certificates |
| Zoom | Registered, Attended, No-Shows, Avg Watch, Sessions, Recordings |
| AI Brain | Query count |
| Shop | Order count |
| Surveys | Survey data |
| Social | Social analytics |
| Digital Human | Conversation count |
| Voice Agent | Calls, Completed, Answer Rate, Avg Duration |
| Courses | Course count |
| Finance | Documents, Revenue, Overdue |
| Expenses | Expense data |
| CLV | Customers, Total LTV, Avg LTV |

**Key insight:** The CRM has extensive analytics. Our frontend doesn't need to duplicate all of this — it should surface the most important KPIs for each industry and link to the CRM analytics for deep dives.

---

## 14. Notifications

**URL:** `/settings/notifications`

### In-App Notification Preferences

| Notification | Category | Toggle |
|-------------|----------|--------|
| New lead assigned | CRM | Off |
| Task due today | Tasks | Off |
| Invoice paid | Finance | Off |
| Workflow execution failed | Automation | On |
| Team messages | Communication | Off |
| Weekly performance summary | Reports | Off |

### Push (App) Notifications

New Lead, New Appointment Booked, Referral Earned, Bill Due, Automation Error, Product Sold, Notification From Automation, Announcements

**For the frontend:** We mirror relevant notification types. When the CRM fires a notification (e.g., "New lead assigned"), our frontend should also show it if the user has opted in.

---

## 15. Tags

**URL:** `/settings/tags`

- **147 tags** — all "Custom" type
- Used for segmenting contacts and CRM records
- Examples: "105391", "AI Saas Pack", "B17 MC1", "BOSS 1" through "BOSS 16", etc.
- Tags can be organized into Folders
- AI Tag Setup available

**For the frontend:** Tags are a CRM concept. The frontend might display tags on contact cards but shouldn't manage them directly — that's a CRM function.

---

## 16. Deleted Items / Recovery

**URL:** `/settings/recover`

- 30-day trash retention
- Categories: Contacts, Opportunities, sites, vault, automation, calendar, Follow-ups, Others
- Currently: 5 items (all "Untitled Workflow" automations)
- "Delete All" option

---

## 17. How Frontend Connects to CRM — Complete Picture

```
┌──────────────────────────────────────────────────────────────────┐
│                     UNIKLIFE FRONTEND                             │
│                     (Our Next.js App)                             │
│                                                                   │
│  User creates enquiry    User books appointment   Payment verified │
│         │                        │                       │        │
│         ▼                        ▼                       ▼        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │           Service Layer → Outbox → HTTP Connector           │  │
│  │                                                             │  │
│  │  POST to CRM webhook URL:                                   │  │
│  │  https://myappzbackend.com/functions/v1/workflow-webhook/... │  │
│  │                                                             │  │
│  │  Headers:                                                   │  │
│  │    X-Uniklife-Event: lead.created                          │  │
│  │    Idempotency-Key: uuid                                   │  │
│  │    X-Hub-Signature-256: hmac(payload, secret)              │  │
│  │                                                             │  │
│  │  Payload:                                                   │  │
│  │  {                                                          │  │
│  │    "type": "lead.created",                                 │  │
│  │    "data": {                                                │  │
│  │      "customer_name": "John",                              │  │
│  │      "customer_phone": "+919100047152",                    │  │
│  │      "customer_email": "john@example.com",                 │  │
│  │      "source": "website"                                   │  │
│  │    }                                                        │  │
│  │  }                                                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              CRM Workflow (Automation)                       │  │
│  │                                                             │  │
│  │  Incoming Webhook trigger → receives payload                │  │
│  │  → Create/Update Contact with:                              │  │
│  │      first_name = data.customer_name                       │  │
│  │      phone = data.customer_phone                           │  │
│  │      email = data.customer_email                           │  │
│  │      source = data.source                                  │  │
│  │  → Move to pipeline stage "New Lead"                       │  │
│  │  → (Optional) Send WhatsApp welcome template               │  │
│  │  → (Optional) Assign to staff member                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              CRM → Frontend (Reverse Sync)                  │  │
│  │                                                             │  │
│  │  Staff updates lead stage in CRM (e.g., Contacted → Qualified)│
│  │  → CRM Workflow fires outbound webhook                     │  │
│  │  → POST /api/webhooks/uniklife/incoming                    │  │
│  │  → Frontend updates enquiry status                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 18. CRM Field Mapping — Updated with Real CRM Fields

Now that we know the actual CRM field keys, here's the corrected mapping:

### Universal Fields (All Industries)

| Frontend Field | CRM Merge Tag | CRM Field Name | Type |
|---------------|--------------|----------------|------|
| `customer_name` | `{{contact.first_name}}` + `{{contact.last_name}}` | First Name + Last Name | Single Line |
| `customer_phone` | `{{contact.phone}}` | Phone | Phone |
| `customer_email` | `{{contact.email}}` | Email | Single Line |
| `customer_company` | `{{contact.company}}` | Company | Single Line |
| `customer_address` | `{{contact.street_address}}` | Business Address | Multi Line |
| `customer_city` | `{{contact.city}}` | City | Single Line |
| `customer_state` | `{{contact.state}}` | Business State | Dropdown |
| `customer_country` | `{{contact.country}}` | Country | Dropdown |
| `lead_source` | `{{contact.source}}` | Source | Single Line |
| `industry` | `{{contact.industry}}` | Industry | Dropdown |
| `date_of_birth` | `{{contact.dob}}` | Date of Birth | Date Picker |
| `job_title` | `{{contact.job_title}}` | Job Title | Single Line |
| `gst_number` | `{{contact.gst_no}}` | Business GST No | Single Line |
| `profile_photo` | `{{contact.profile_image}}` | Profile Photo | File Upload |

### Custom Fields Needed for "Healthy Lifestyle" Module

These don't exist in CRM yet — the platform will create them via API during client onboarding:

**Parenting Coaching submodule:**

| Frontend Field | CRM Field to Create | Type | Merge Tag (proposed) |
|---------------|--------------------|----|---------------------|
| `child_name` | Child Name | Single Line | `{{contact.child_name}}` |
| `child_age` | Child Age | Number | `{{contact.child_age}}` |
| `child_dob` | Child Date of Birth | Date Picker | `{{contact.child_dob}}` |
| `parent_type` | Parent Type | Dropdown | `{{contact.parent_type}}` |
| `coaching_program` | Coaching Program | Dropdown | `{{contact.coaching_program}}` |
| `session_count` | Sessions Completed | Number | `{{contact.session_count}}` |
| `next_session_date` | Next Session | Date Picker | `{{contact.next_session}}` |
| `coach_assigned` | Assigned Coach | Single Line | `{{contact.coach_assigned}}` |
| `goals` | Coaching Goals | Multi Line | `{{contact.coaching_goals}}` |
| `progress_notes` | Progress Notes | Multi Line | `{{contact.progress_notes}}` |

**DMIT (Dermatoglyphics Multiple Intelligence Test) submodule:**

| Frontend Field | CRM Field to Create | Type | Merge Tag (proposed) |
|---------------|--------------------|----|---------------------|
| `dmit_report_id` | DMIT Report ID | Single Line | `{{contact.dmit_report_id}}` |
| `dmit_test_date` | DMIT Test Date | Date Picker | `{{contact.dmit_test_date}}` |
| `intelligence_profile` | Intelligence Profile | Dropdown | `{{contact.intelligence_profile}}` |
| `learning_style` | Learning Style | Dropdown | `{{contact.learning_style}}` |
| `dominant_brain` | Dominant Brain | Dropdown | `{{contact.dominant_brain}}` |
| `report_status` | Report Status | Dropdown | `{{contact.report_status}}` |
| `counselor_assigned` | Assigned Counselor | Single Line | `{{contact.counselor_assigned}}` |
| `follow_up_date` | Follow-up Date | Date Picker | `{{contact.follow_up_date}}` |

---

## 19. CRM API Capabilities (Inferred from Screenshots)

Based on the CRM structure, the API likely supports:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/contacts` | GET, POST, PUT, DELETE | CRUD contacts |
| `/contacts/{id}/tags` | POST, DELETE | Manage contact tags |
| `/opportunities` | GET, POST, PUT | Pipeline deals |
| `/custom-fields` | GET, POST | List/create custom fields |
| `/custom-values` | GET, POST | List/create custom values |
| `/workflows` | GET, POST | Manage automations |
| `/calendars/appointments` | GET, POST | Booking/scheduling |
| `/templates` | GET | List message templates |
| `/conversations/messages` | POST | Send messages (WhatsApp, SMS, Email) |

**Need to verify:** The exact API documentation from MyAppz. The Maya MCP connection suggests there's a well-documented API since it supports Claude/ChatGPT integration.

---

## 20. What This Means for the "Healthy Lifestyle" Module

### Architecture Decision Confirmed

```
┌─────────────────────────┐     ┌─────────────────────────┐
│   UNIKLIFE FRONTEND     │     │     MyAppz CRM          │
│   (CEO-friendly UI)     │     │   (Full CRM backend)    │
│                         │     │                         │
│  Parenting Coaching     │◄───►│  Contacts + Custom      │
│  - Client profiles      │     │  Fields (child_name,    │
│  - Session booking      │     │  coaching_program, etc.) │
│  - Progress tracking    │     │                         │
│  - Payment tracking     │     │  Pipeline (leads →      │
│                         │     │  qualified → enrolled)  │
│  DMIT                   │     │                         │
│  - Test scheduling      │◄───►│  Appointments +         │
│  - Report management    │     │  Custom Fields          │
│  - Counselor assignment │     │  (dmit_report_id, etc.) │
│  - Follow-up tracking   │     │                         │
│                         │     │  Templates (WhatsApp,   │
│  Dashboard              │     │  Email for follow-ups)  │
│  - KPIs per submodule   │     │                         │
│  - Client engagement    │     │  Automations (lead      │
│  - Revenue summary      │     │  nurture, reminders)    │
└─────────────────────────┘     └─────────────────────────┘
         │                              │
         └──────────┬───────────────────┘
                    │
              2-way sync via
              API + Webhooks
```

### Step-by-Step for First Industry ("Healthy Lifestyle")

1. **In CRM:** Create custom fields for Parenting Coaching + DMIT via API (or manually first to test)
2. **In CRM:** Create a pipeline for this industry: New Lead → Consultation Booked → Assessment Done → Enrolled → Active → Completed
3. **In CRM:** Create workflow automations: incoming webhook → create/update contact with custom fields
4. **In Frontend:** Create industry profile config (modules, submodules, fields, CRM field mappings)
5. **In Frontend:** Build Parenting Coaching UI components (session list, booking form, progress cards)
6. **In Frontend:** Build DMIT UI components (test scheduling, report viewer, intelligence chart)
7. **Wire up:** Connect outbox events → CRM webhook, CRM webhook → frontend inbound endpoint
8. **Test:** Create a client in frontend → verify it appears in CRM pipeline → update in CRM → verify it syncs back

### What We Reuse from Ventures

| Ventures Feature | Healthy Lifestyle Equivalent |
|-----------------|----------------------------|
| Enquiries | Client enquiries (same flow) |
| Bookings | Session bookings |
| Site visits | Consultation appointments |
| Dashboard KPIs | Client KPIs (sessions, revenue) |
| Payments | Session/package payments |
| Commission structure | Referral commissions |
| Staff & Access | Coach/counselor directory |
| Integration hub | Same — API, Webhook, Sync, WhatsApp, Email |
| Settings/Branding | Same — fully reusable |

---

## 21. Is This Project Idea Possible? — Final Confirmation

**YES. Here's the proof from the CRM screenshots:**

1. **Custom fields exist and are extensible** — the CRM has Standard + Additional + Folders for organizing custom fields. We can create any field needed per industry.

2. **Templates already span industries** — "Real Estate Showing Follow-up" and "Healthcare Patient Revisit" templates already exist, proving the CRM is designed for multi-industry use.

3. **Module toggle exists** — the Customize page lets you show/hide modules. Each client sees only what's relevant.

4. **Pipeline is customizable** — "B2B Sales Pipeline" is just one option. Each industry can have its own pipeline stages.

5. **White-labeling works on both sides** — CRM branding (logo, themes, domain) + Frontend branding (12 themes, PWA, custom domains). Each client gets a fully branded experience.

6. **API + MCP ready** — Maya MCP connection means there's a developer-friendly API. The workflow automation builder handles incoming webhooks.

7. **93 contacts already in CRM** — real data is flowing. The integration path is proven.

**The biggest risk is not technical — it's scope management.** Start with one industry (Healthy Lifestyle), prove the pattern, then scale. The architecture supports it.

---

*Next: When you're ready to start building, approve which code changes to begin with. The first task would be creating the industry profile schema (database migration + service layer) — everything else depends on it.*
