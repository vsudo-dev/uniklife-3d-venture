# Healthy Lifestyle — Module Overview

**Category:** Health & Wellness (Category 8 of 20)
**Industry:** Healthy Lifestyle
**Status:** First new industry module — proves the multi-industry pattern
**Date:** 2026-11-09

---

## What This Module Is

A CEO-friendly frontend for Healthy Lifestyle businesses that sell **Parenting Coaching** and **DMIT (Dermatoglyphics Multiple Intelligence Test)** services. The business owner logs into their branded PWA, manages clients, tracks sessions, delivers reports — and everything syncs to their MyAppz CRM automatically.

---

## Submodules

| # | Submodule | What It Does |
|---|-----------|-------------|
| 1 | **Parenting Coaching** | Client intake, session scheduling, progress tracking, resource sharing, package billing |
| 2 | **DMIT** | Test scheduling, fingerprint management, report delivery, counselor sessions, credit-based pricing |

---

## Sidebar Navigation (Proposed)

```
WORKSPACE
  ├── Home (Dashboard)

CLIENTS
  ├── Enquiries (Leads)
  ├── Clients (Active)
  ├── Appointments

PARENTING COACHING
  ├── Sessions
  ├── Programs
  ├── Progress Tracker
  ├── Resources

DMIT
  ├── Tests
  ├── Reports
  ├── Counseling

FINANCE
  ├── Packages & Pricing
  ├── Payments
  ├── Commissions

ADMINISTRATION
  ├── Staff & Access
  ├── Organizations

INTEGRATION
  ├── Uniklife AI Integration

PREFERENCES
  ├── Settings
```

---

## Reuse from Ventures (Reference Module)

| Ventures Feature | Healthy Lifestyle Equivalent | Reuse Level |
|-----------------|----------------------------|-------------|
| Dashboard | Dashboard (different KPIs) | Layout reuse, new KPI config |
| Enquiries | Enquiries (same flow) | 95% reuse |
| Bookings | Appointments | 80% reuse (remove plot/venture fields) |
| Site visits | Appointments (merged) | Concept reuse |
| Sales dashboard | Revenue dashboard | 70% reuse |
| Payments | Payments | 90% reuse |
| Commission Structure | Referral commissions | 80% reuse |
| Staff & Access | Staff & Access | 100% reuse |
| Organizations | Organizations | 100% reuse |
| Integration hub | Integration hub | 100% reuse |
| Settings/Branding | Settings/Branding | 100% reuse |
| Ventures (projects) | Programs (coaching) / Tests (DMIT) | **New UI, same pattern** |
| Plot inventory | N/A | Not needed |
| 3D viewer | N/A | Not needed |
| Trip tracking | N/A | Not needed |

**Estimated new code:** ~30% new, ~70% reused from Ventures patterns.

---

## CRM Field Strategy

### Option A: Manual First (Recommended for v1)
1. Manually create custom fields in CRM (Settings → Fields → Additional)
2. Map them in the frontend's `field_mappings` table
3. Test the sync

### Option B: Auto-Create via API (Production path)
1. Platform admin creates industry profile
2. System reads field definitions from profile
3. For each unmapped field → POST to CRM custom fields API
4. Store returned field ID in mapping table

**Start with Option A, build Option B once the pattern works.**

### Storage: CRM Vault First

| Data | Where to Store | Why |
|------|---------------|-----|
| Client documents | CRM Vault | Already exists, linked to contacts, shareable URLs |
| DMIT fingerprint scans | CRM Vault | File Upload field type on contact |
| DMIT reports (PDFs) | CRM Vault | Vault + shareable link (`storagev2.files-vault.com`) |
| Bulk exports (CSV, PDF) | CRM Vault | 177.79 GB used, public share URLs available |
| Session recordings | CRM Vault | If supported, otherwise external link |
| Coaching resources | CRM Vault | Shareable via client portal |
| Frontend assets (logos, branding, PWA icons) | Supabase Storage | Platform infra — not client data |

**No separate file storage needed for client data.** CRM Vault handles all client-facing files with shareable URLs. Supabase Storage only for platform assets (org logos, branding, PWA icons).

---

## Pipeline Stages (CRM)

```
New Lead → Consultation Booked → Assessment Done → Enrolled → Active → Completed → Alumni
```

Maps to frontend enquiry statuses:
- New → new
- Consultation Booked → contacted
- Assessment Done → qualified
- Enrolled → converted
- Active → active
- Completed → closed (success)
- Alumni → closed (graduated)

---

## Dashboard KPIs (Proposed)

| KPI | Source |
|-----|--------|
| Active Clients | Count of contacts with status=Active |
| Sessions This Week | Appointments completed this week |
| Upcoming Appointments | Scheduled appointments |
| Revenue This Month | Payments verified this month |
| DMIT Tests Pending | Tests in Processing/Scheduled status |
| New Enquiries | Leads in New status |
| Conversion Rate | Enrolled ÷ Total Leads |
| Pending Follow-ups | Overdue follow-up dates |

---

## Detailed Docs

- [01-PARENTING-COACHING.md](01-PARENTING-COACHING.md) — Full feature spec for the Parenting Coaching submodule
- [02-DMIT.md](02-DMIT.md) — Full feature spec for the DMIT submodule
- [03-BUILD-PLAN.md](03-BUILD-PLAN.md) — Step-by-step implementation plan with file paths and task breakdown
