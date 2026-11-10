# DMIT — Submodule Specification

**Module:** Healthy Lifestyle
**Submodule:** DMIT (Dermatoglyphics Multiple Intelligence Test)
**Date:** 2026-11-09

---

## 1. Market Context

### What DMIT Is
DMIT is a fingerprint-based assessment that maps brain lobe distribution, learning styles, personality types, and multiple intelligences (Howard Gardner's 8 types) from ridge patterns of all 10 fingers. It produces a multi-page report (24–56 pages) covering brain dominance, VAK learning styles, intelligence profiles, career recommendations, and parenting tips.

### Market Landscape (India-focused)
- **Market size:** ₹80,000 crore career counseling market (industry claim), 3.5 crore students seeking guidance
- **Test pricing:** ₹2,000–₹7,000 per report to end client
- **Franchise entry:** ₹1–5 lakh (low barrier)
- **Major players:** Brainwonders (largest franchise), DMIT Lab, MindTech International, MindGroom, MindGenics
- **Operations:** Home-based, small centers, school partnerships
- **Key revenue:** Per-test fees, franchise licensing, school bulk programs, counselor certification

### Report Sections (Standard)
1. Brain lobe distribution (% per lobe)
2. Left/Right brain dominance ratio
3. 8 Multiple Intelligences scores (linguistic, logical, spatial, musical, bodily, interpersonal, intrapersonal, naturalistic)
4. Learning styles (Visual / Auditory / Kinesthetic)
5. Personality type (4 types)
6. IQ/EQ/AQ/CQ indicators
7. RIASEC career model fit
8. Parenting tips (age-appropriate)
9. Extracurricular recommendations
10. Career path suggestions

### Our Advantage
Most DMIT businesses use standalone software (₹5,000–₹24,000 one-time purchase) that does ONLY report generation. No CRM integration, no client management, no follow-up automation, no multi-center management. Our platform gives them the full business management stack on top.

---

## 2. Features

### 2.1 Client Registration

**What:** Register a new client (usually parent + child) for DMIT testing.

| Field | Type | CRM Mapping | Required |
|-------|------|-------------|----------|
| Parent Name | text | `{{contact.first_name}}` `{{contact.last_name}}` | Yes |
| Parent Phone | phone | `{{contact.phone}}` | Yes |
| Parent Email | email | `{{contact.email}}` | No |
| Child Name | text | `{{contact.child_name}}` (custom) | Yes |
| Child Age | number | `{{contact.child_age}}` (custom) | Yes |
| Child DOB | date | `{{contact.child_dob}}` (custom) | Yes |
| School Name | text | `{{contact.school_name}}` (custom) | No |
| Class/Grade | dropdown | `{{contact.class_grade}}` (custom) | No |
| Test Type | dropdown | `{{contact.dmit_test_type}}` (custom) | Yes |
| Referral Source | text | `{{contact.source}}` | No |
| Center/Branch | dropdown | `{{contact.dmit_center}}` (custom) | No |

**Test Type options:** Child (3–10), Student (11–17), Adult (18+), Career (18+), Corporate

### 2.2 Test Management

**What:** Track the full DMIT test lifecycle from scheduling to report delivery.

**Test record fields:**

| Field | Type | Description |
|-------|------|-------------|
| Test ID | auto | Unique test identifier |
| Client | reference | Link to contact record |
| Test Type | dropdown | Child, Student, Adult, Career, Corporate |
| Report Tier | dropdown | Basic (24 pages), Standard (36 pages), Premium (56 pages) |
| Status | dropdown | Scheduled → Scan Collected → Processing → Report Ready → Delivered → Counseled |
| Scheduled Date | datetime | When the test is scheduled |
| Scan Date | datetime | When fingerprints were collected |
| Report Generated | datetime | When report was generated |
| Delivered Date | datetime | When report was shared with client |
| Counseling Date | datetime | When post-report counseling happened |
| Assigned Counselor | user | Who will interpret the report |
| Scan Method | dropdown | Biometric scanner, Mobile app, Ink-based |
| Fingerprint Files | files | 10 fingerprint images (stored in CRM Vault) |
| Report PDF | file | Generated report (stored in CRM Vault) |
| Price Paid | currency | Amount collected |
| Payment Status | dropdown | Pending, Partial, Paid, Refunded |
| Notes | textarea | Internal notes |

**Status Flow:**
```
Scheduled ──► Scan Collected ──► Processing ──► Report Ready ──► Delivered ──► Counseled
                                     │
                                     └──► Re-scan Required (if quality issues)
```

### 2.3 Report Management

**What:** View, manage, and deliver DMIT reports.

**Report display (in-app):**

| Section | What It Shows |
|---------|--------------|
| **Summary Card** | Child name, age, test date, report tier, counselor |
| **Intelligence Profile** | 8 intelligences as a radar/spider chart with scores |
| **Brain Dominance** | Left vs Right brain % as a visual split |
| **Learning Style** | VAK distribution as a pie/bar chart |
| **Personality Type** | Type label + description |
| **Career Aptitude** | Top 5 career recommendations |
| **Recommendations** | Extracurricular suggestions, study tips |

**Report delivery options:**
- In-app viewing (parent portal)
- PDF download
- WhatsApp (send PDF link)
- Email (attach PDF or link)
- Print (formatted for A4)

**Report tiers:**

| Tier | Pages | Price (typical) | Content |
|------|-------|----------------|---------|
| Basic | 24 | ₹2,000–₹3,000 | 8 intelligences, brain dominance, learning style |
| Standard | 36 | ₹4,000–₹5,000 | + personality, career aptitude, parenting tips |
| Premium | 56 | ₹6,000–₹7,000 | + detailed analysis, comparison charts, counselor notes |

### 2.4 Counseling Sessions

**What:** Post-report counseling where a certified counselor interprets the DMIT report with the parent.

| Field | Type | Description |
|-------|------|-------------|
| Session ID | auto | Unique |
| Test ID | reference | Linked DMIT test |
| Client | reference | Parent contact |
| Counselor | user | Assigned counselor |
| Date & Time | datetime | Scheduled time |
| Duration | number | Minutes (default 30–60) |
| Mode | dropdown | In-person, Video call, Phone |
| Status | dropdown | Scheduled, Completed, Cancelled, No-show |
| Key Discussion Points | textarea | What was covered |
| Recommendations Given | textarea | Counselor's advice |
| Parent Questions | textarea | Questions asked by parent |
| Follow-up Needed | boolean | Whether another session is needed |
| Follow-up Date | date | When to follow up |
| Parent Satisfaction | rating | 1–5 star rating |

### 2.5 Batch Testing (School Programs)

**What:** Schools hire DMIT practitioners to test entire classes (30–200+ students).

| Field | Type | Description |
|-------|------|-------------|
| Batch ID | auto | Unique |
| School Name | text | School name |
| School Contact | reference | Contact person |
| Class/Grade | text | e.g., "Class 8 Section A" |
| Student Count | number | Total students |
| Test Date(s) | date range | When scanning happens |
| Report Tier | dropdown | Usually Standard for schools |
| Price Per Student | currency | Bulk rate |
| Total Amount | currency | Auto-calculated |
| Status | dropdown | Proposed → Confirmed → Scanning → Reports Generating → Delivered → Counseling Complete |
| Assigned Team | users | Counselors assigned |
| Completion % | auto | Students tested / Total |

**Workflow:**
1. School agrees → create batch record
2. Import student list (CSV) → auto-create contact records
3. On test day → mark each student as "Scan Collected"
4. Generate reports in bulk
5. Schedule group parent meetings or individual counseling
6. Track delivery completion

### 2.6 Center/Franchise Management

**What:** For DMIT businesses with multiple locations or franchise operators.

| Field | Type | Description |
|-------|------|-------------|
| Center Name | text | Branch/franchise name |
| Location | text | City, address |
| Manager | user | Center manager |
| Counselors | users | Staff at this center |
| Active Since | date | When center opened |
| Status | dropdown | Active, Paused, Closed |
| Tests This Month | auto | Count |
| Revenue This Month | auto | Sum of payments |
| Report Credits | number | Available credits for report generation |

**Note:** This maps to the existing Organizations feature. Each center = a sub-organization under the main business.

### 2.7 Credit System

**What:** DMIT businesses often work on a credit model — buy report credits in bulk, use them to generate reports.

| Action | Credits |
|--------|---------|
| Basic report generation | 1 credit |
| Standard report generation | 2 credits |
| Premium report generation | 3 credits |
| Bulk purchase (100 credits) | ₹10,000 (₹100/credit) |
| Bulk purchase (500 credits) | ₹40,000 (₹80/credit) |

**Implementation:** Track credits per organization. Deduct on report generation. Alert when low. This can use the existing CRM Wallet concept.

---

## 3. CRM Custom Fields Needed

### Contact Object (Additional Fields)

| Field Name | Type | Merge Tag |
|-----------|------|-----------|
| Child Name | Single Line | `{{contact.child_name}}` |
| Child Age | Number | `{{contact.child_age}}` |
| Child DOB | Date Picker | `{{contact.child_dob}}` |
| School Name | Single Line | `{{contact.school_name}}` |
| Class/Grade | Dropdown | `{{contact.class_grade}}` |
| DMIT Test Type | Dropdown | `{{contact.dmit_test_type}}` |
| DMIT Test ID | Single Line | `{{contact.dmit_test_id}}` |
| DMIT Report Tier | Dropdown | `{{contact.dmit_report_tier}}` |
| DMIT Test Status | Dropdown | `{{contact.dmit_test_status}}` |
| DMIT Report URL | Single Line | `{{contact.dmit_report_url}}` |
| Counselor Assigned | Single Line | `{{contact.counselor_assigned}}` |
| Counseling Status | Dropdown | `{{contact.counseling_status}}` |
| Follow-up Date | Date Picker | `{{contact.follow_up_date}}` |
| DMIT Center | Dropdown | `{{contact.dmit_center}}` |
| Dominant Intelligence | Dropdown | `{{contact.dominant_intelligence}}` |
| Learning Style | Dropdown | `{{contact.learning_style}}` |
| Brain Dominance | Dropdown | `{{contact.brain_dominance}}` |

### Shared Fields with Parenting Coaching
`child_name`, `child_age`, `child_dob` are shared — only create once in CRM.

---

## 4. Events (Frontend → CRM)

| Event | When | CRM Action |
|-------|------|-----------|
| `dmit.client.registered` | New DMIT client created | Create Contact + Lead |
| `dmit.test.scheduled` | Test appointment set | Create Appointment |
| `dmit.scan.collected` | Fingerprints captured | Update test status, log activity |
| `dmit.report.generated` | Report PDF ready | Update status, attach report URL |
| `dmit.report.delivered` | Report sent to client | Log activity, trigger satisfaction survey |
| `dmit.counseling.scheduled` | Post-report session booked | Create Appointment |
| `dmit.counseling.completed` | Counseling done | Update status, log notes |
| `dmit.batch.created` | School batch registered | Create contacts in bulk |
| `dmit.payment.verified` | Payment confirmed | Update payment status |

---

## 5. Screens (UI Pages)

| Page | URL | Description |
|------|-----|-------------|
| Tests list | `/dmit/tests` | All DMIT tests with status filters, search |
| Test detail | `/dmit/tests/[id]` | Full test record: client info, status timeline, fingerprints, report |
| New test | `/dmit/tests/new` | Registration + scheduling form |
| Reports list | `/dmit/reports` | All generated reports, download/share actions |
| Report viewer | `/dmit/reports/[id]` | In-app report display with charts |
| Counseling list | `/dmit/counseling` | Scheduled/completed sessions |
| Batch list | `/dmit/batches` | School program management |
| Batch detail | `/dmit/batches/[id]` | Student list, progress, bulk actions |
| Dashboard widget | `/dashboard` | DMIT KPIs: tests pending, reports ready, revenue |

---

## 6. Report Visualization (In-App)

Instead of just showing a PDF, the frontend renders key DMIT data as interactive charts:

### Spider/Radar Chart — 8 Intelligences
```
         Linguistic
            ▲
    Natural/ \  Logic/Math
         /    \
   Inter-     Spatial
   personal──────►
         \    /
    Intra- \  / Musical
   personal ▼
         Bodily
```

### Brain Dominance Bar
```
Left Brain ████████░░░░░░░░ Right Brain
           58%              42%
```

### Learning Style Donut
```
Visual:    45% ████████░░
Auditory:  30% ██████░░░░
Kinesthetic: 25% █████░░░░░
```

These charts are rendered from stored data points, not from the PDF. The PDF is the formal document; the in-app view is the interactive, CEO-friendly version.

---

## 7. Automated Follow-ups

| Trigger | Action | Template |
|---------|--------|----------|
| Test scheduled | WhatsApp: appointment reminder (1 day before) | Test reminder |
| Report ready | WhatsApp: "Your child's DMIT report is ready" | Report ready |
| Report delivered, no counseling booked | 3 days later: "Book your counseling session" | Counseling nudge |
| Counseling completed | Email: summary + recommendations PDF | Post-counseling summary |
| 6 months after test | WhatsApp: "Time for a re-assessment?" | Re-assessment offer |
| School batch completed | Email to school contact: completion report | Batch completion |
