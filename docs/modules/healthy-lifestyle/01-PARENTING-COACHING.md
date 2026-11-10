# Parenting Coaching — Submodule Specification

**Module:** Healthy Lifestyle
**Submodule:** Parenting Coaching
**Date:** 2026-11-09

---

## 1. Market Context

### What Parenting Coaches Do
Parenting coaches help families navigate behavioral challenges, developmental milestones, communication breakdowns, and parenting transitions (new baby, divorce, teen years). Sessions are typically 1-on-1 (sometimes both parents), delivered via video call or in-person, with homework/action items between sessions.

### Market Landscape
- **Pricing:** ₹2,000–₹15,000/session in India ($75–$200 in US/UK)
- **Packages:** 6–12 session bundles at 15–25% discount
- **Subscriptions:** ₹3,000–₹15,000/month for ongoing access + resources
- **Acquisition:** 70%+ from word-of-mouth/referrals — referral tracking is critical
- **Delivery:** 80%+ online (Zoom/Google Meet) post-2020
- **Key stat:** 94% of coaching-software users rate progress tracking as important/highly important
- **Pain point:** Most coaches cobble together Calendly + Zoom + Google Sheets + WhatsApp. No unified platform.

### Competitors
- **HoneyBook** — booking + payments + contracts (general coaching)
- **Paperbell** — scheduling + packages + client portal (coaching-focused)
- **Practice Better** — health/wellness coaching platform
- **CoachAccountable** — progress tracking + action items
- **Simply.Coach** — Indian coaching platform

### Our Advantage
One platform that combines client management, session scheduling, progress tracking, resource sharing, payments, AND syncs everything to the CRM for marketing automation, WhatsApp follow-ups, and analytics.

---

## 2. Features

### 2.1 Client Intake & Onboarding

**What:** When a new enquiry comes in, collect structured information about the family.

| Field | Type | CRM Mapping | Required |
|-------|------|-------------|----------|
| Parent Name | text | `{{contact.first_name}}` `{{contact.last_name}}` | Yes |
| Parent Phone | phone | `{{contact.phone}}` | Yes |
| Parent Email | email | `{{contact.email}}` | Yes |
| Child Name | text | `{{contact.child_name}}` (custom) | Yes |
| Child Age | number | `{{contact.child_age}}` (custom) | Yes |
| Child Date of Birth | date | `{{contact.child_dob}}` (custom) | No |
| Number of Children | number | `{{contact.num_children}}` (custom) | No |
| Concern Area | multi-select | `{{contact.concern_area}}` (custom) | Yes |
| Family Situation | dropdown | `{{contact.family_situation}}` (custom) | No |
| Referral Source | text | `{{contact.source}}` | No |
| Referred By | text | `{{contact.referred_by}}` (custom) | No |
| Preferred Language | dropdown | `{{contact.preferred_language}}` (custom) | No |
| Notes | textarea | `{{contact.notes}}` | No |

**Concern Area options:** Behavioral issues, Sleep problems, Screen time, Sibling rivalry, Academic pressure, Emotional regulation, Communication, Discipline, Teen challenges, Special needs, New parent guidance, Divorce/separation, Other

**Family Situation options:** Nuclear family, Joint family, Single parent, Co-parenting, Blended family, Other

**Flow:**
1. New enquiry → intake form auto-populates from CRM contact (if exists)
2. Coach reviews intake → schedules consultation
3. After consultation → creates coaching plan with goals
4. Parent receives welcome email/WhatsApp with portal access

### 2.2 Session Management

**What:** Schedule, conduct, and document coaching sessions.

**Session record fields:**

| Field | Type | Description |
|-------|------|-------------|
| Session # | auto | Sequential per client |
| Date & Time | datetime | Scheduled time |
| Duration | number | Minutes (default 45/60) |
| Type | dropdown | Initial consultation, Regular, Follow-up, Emergency, Group |
| Mode | dropdown | Video call, In-person, Phone |
| Status | dropdown | Scheduled, Completed, Cancelled, No-show, Rescheduled |
| Coach | user | Assigned coach |
| Session Notes | richtext | Coach's private notes |
| Key Observations | textarea | What the coach noticed |
| Action Items | list | Homework for parents (with due dates) |
| Parent Feedback | textarea | Parent's self-report |
| Next Session | date | Auto-suggest based on frequency |

**CRM sync:** Each session → CRM appointment. Status changes fire events. Session notes stored as CRM activity/note on the contact.

### 2.3 Coaching Programs

**What:** Predefined coaching packages that clients enroll in.

| Field | Type | Description |
|-------|------|-------------|
| Program Name | text | e.g., "Positive Parenting 8-Week" |
| Description | textarea | What the program covers |
| Duration | text | e.g., "8 weeks" |
| Session Count | number | e.g., 8 |
| Session Frequency | dropdown | Weekly, Bi-weekly, Monthly |
| Price | currency | Package price |
| Discount vs. single | percentage | e.g., 20% off |
| Age Group | dropdown | 0–2, 3–5, 6–9, 10–12, 13–17, All ages |
| Concern Focus | multi-select | Which concerns this program addresses |
| Resources Included | list | Linked resources/worksheets |
| Status | dropdown | Active, Paused, Archived |
| Max Clients | number | Capacity (for group programs) |

**Example Programs:**
- Positive Parenting Foundations (8 sessions, ₹12,000)
- Teen Communication Toolkit (6 sessions, ₹10,000)
- New Parent Survival Guide (4 sessions, ₹6,000)
- Screen Time Detox (4 sessions, ₹5,000)
- Sibling Harmony Workshop (Group, 4 sessions, ₹3,000/parent)

### 2.4 Progress Tracking

**What:** Track measurable goals and milestones for each client.

**Goal record:**

| Field | Type | Description |
|-------|------|-------------|
| Goal Title | text | e.g., "Reduce bedtime tantrums" |
| Category | dropdown | Behavior, Communication, Routine, Emotional, Academic, Relationship |
| Baseline | text | Starting situation description |
| Target | text | What success looks like |
| Metric | dropdown | Frequency (per week), Duration (minutes), Rating (1–10), Yes/No |
| Start Value | number | e.g., 7 tantrums/week |
| Current Value | number | e.g., 2 tantrums/week |
| Target Value | number | e.g., 0 |
| Status | dropdown | Active, Achieved, Paused, Dropped |
| Timeline | text | Expected timeframe |

**Progress entries:** Parent logs periodic updates (weekly check-in). Coach reviews during sessions. Visual chart shows trend over time.

**Dashboard widget:** "Client Progress" card showing active goals, % achieved, trend arrows.

### 2.5 Resource Library

**What:** Coaches share curated content with clients — articles, worksheets, videos, guides.

| Field | Type | Description |
|-------|------|-------------|
| Title | text | Resource name |
| Type | dropdown | Article, Worksheet, Video, Audio, Checklist, Guide |
| Category | dropdown | Same as concern areas |
| Age Group | dropdown | Target age group |
| File/URL | file/url | Stored in CRM Vault or external link |
| Description | textarea | Brief summary |
| Visibility | dropdown | All clients, Enrolled only, Specific clients |

**Sharing:** Coach assigns resources to a client → appears in their portal/app. Can be attached to session action items.

### 2.6 Client Portal (Parent View)

**What:** Parents log in to see their coaching journey.

**Portal sections:**
- **My Sessions** — upcoming, past, action items
- **My Goals** — progress charts, current goals, achievements
- **Resources** — assigned articles, worksheets, videos
- **Messages** — WhatsApp/in-app communication with coach
- **Payments** — package status, invoices, receipts
- **My Profile** — family info, preferences

**Access:** Same PWA login as the main app, but with "customer" role that shows only the parent portal.

### 2.7 Automated Follow-ups

**What:** CRM automation triggers based on coaching events.

| Trigger | Action | Template |
|---------|--------|----------|
| Session completed | WhatsApp: session summary + action items | Post-session follow-up |
| 3 days after session | Email: progress check-in | Client check-in |
| Action item due date | WhatsApp: gentle reminder | Task reminder |
| 7 days no engagement | Email: re-engagement | We miss you |
| Goal achieved | WhatsApp: congratulations | Milestone celebration |
| Package sessions remaining = 1 | Email: renewal offer | Package renewal |
| Referral made | WhatsApp: thank you + reward | Referral thank you |

---

## 3. CRM Custom Fields Needed

### Contact Object (Additional Fields)

| Field Name | Type | Merge Tag |
|-----------|------|-----------|
| Child Name | Single Line | `{{contact.child_name}}` |
| Child Age | Number | `{{contact.child_age}}` |
| Child DOB | Date Picker | `{{contact.child_dob}}` |
| Number of Children | Number | `{{contact.num_children}}` |
| Concern Area | Multi Select | `{{contact.concern_area}}` |
| Family Situation | Dropdown | `{{contact.family_situation}}` |
| Referred By | Single Line | `{{contact.referred_by}}` |
| Preferred Language | Dropdown | `{{contact.preferred_language}}` |
| Coaching Program | Dropdown | `{{contact.coaching_program}}` |
| Sessions Completed | Number | `{{contact.sessions_completed}}` |
| Total Sessions | Number | `{{contact.total_sessions}}` |
| Coach Assigned | Single Line | `{{contact.coach_assigned}}` |
| Active Goals | Number | `{{contact.active_goals}}` |
| Next Session Date | Date Picker | `{{contact.next_session}}` |
| Enrollment Date | Date Picker | `{{contact.enrollment_date}}` |
| Package Status | Dropdown | `{{contact.package_status}}` |

### Pipeline Stages

```
New Enquiry → Consultation Scheduled → Consultation Done → Enrolled → Active → Completed → Alumni
```

---

## 4. Events (Frontend → CRM)

| Event | When | CRM Action |
|-------|------|-----------|
| `enquiry.created` | New enquiry submitted | Create Contact + Lead |
| `consultation.scheduled` | Consultation booked | Create Appointment, move pipeline |
| `client.enrolled` | Parent enrolls in program | Move pipeline to Enrolled, update custom fields |
| `session.completed` | Session marked done | Log Activity, update sessions_completed |
| `session.cancelled` | Session cancelled | Update appointment status |
| `goal.created` | New goal set | Update active_goals count |
| `goal.achieved` | Goal marked achieved | Trigger celebration template |
| `payment.verified` | Payment confirmed | Update package_status, log in CRM Finance |
| `resource.shared` | Resource assigned to client | Log Activity |

---

## 5. Screens (UI Pages)

| Page | URL | Description |
|------|-----|-------------|
| Sessions list | `/sessions` | All sessions: upcoming, past, filtered by coach/client |
| Session detail | `/sessions/[id]` | Notes, action items, progress update |
| Programs list | `/programs` | Active coaching programs with enrollment counts |
| Program detail | `/programs/[id]` | Program info, enrolled clients, schedule |
| Progress tracker | `/progress` | Client goals dashboard with charts |
| Client progress | `/progress/[clientId]` | Individual client's goals and trends |
| Resources | `/resources` | Resource library with filters |
| Client portal | `/portal` | Parent's view (customer role) |
