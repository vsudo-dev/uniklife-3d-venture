# CRM Field Mapping Strategy

**Date:** 2026-11-09
**Status:** Draft — depends on MyAppz CRM API documentation

---

## How Field Mapping Works

```
┌──────────────────┐          field_mappings table           ┌──────────────────────┐
│  Frontend Field   │  ────────────────────────────────────▶  │   CRM Custom Field   │
│  (industry module)│                                         │   (MyAppz CRM)       │
│                   │  mapping row:                           │                      │
│  key: "patient_   │  frontend_field_key = "patient_name"    │  field_name:         │
│       name"       │  crm_field_name = "contact.full_name"   │  "contact.full_name" │
│  type: text       │  sync_direction = "both"                │  type: text          │
│                   │  is_custom_field = false                │                      │
└──────────────────┘                                         └──────────────────────┘
```

### Three Scenarios

**1. CRM field exists (standard field)**
- Map frontend field key → CRM standard field name
- `is_custom_field = false`, `auto_created = false`
- Example: Patient Name → `contact.full_name` (standard CRM contact field)

**2. CRM field exists (custom field already created)**
- Map frontend field key → CRM custom field name
- `is_custom_field = true`, `auto_created = false`
- Example: Blood Group → `contact.custom.blood_group` (previously created custom field)

**3. CRM field doesn't exist (auto-create)**
- Platform detects unmapped fields during onboarding
- Calls CRM API to create custom field → gets back field ID/name
- Creates mapping row with `is_custom_field = true`, `auto_created = true`
- Example: Bed Number → creates `custom.bed_number` in CRM → maps it

---

## Universal Fields (Every Industry)

These map to standard CRM contact/lead fields:

| Frontend Field | CRM Field (Proposed) | Type | Direction |
|---------------|---------------------|------|-----------|
| `contact_name` | `contact.full_name` | text | both |
| `contact_email` | `contact.email` | email | both |
| `contact_phone` | `contact.phone` | phone | both |
| `contact_company` | `contact.company_name` | text | both |
| `contact_address` | `contact.address` | text | both |
| `lead_source` | `lead.source` | select | app→crm |
| `lead_status` | `lead.status` | select | both |
| `lead_assigned_to` | `lead.assigned_to` | user | app→crm |
| `lead_notes` | `lead.notes` | textarea | both |
| `lead_value` | `lead.monetary_value` | currency | both |
| `created_at` | `contact.date_added` | datetime | app→crm |

---

## Industry-Specific Field Maps

### Hospital Management

| Frontend Field | CRM Field | Type | Direction | Custom? |
|---------------|-----------|------|-----------|---------|
| `patient_id` | `contact.custom.patient_id` | text | app→crm | yes |
| `blood_group` | `contact.custom.blood_group` | select | both | yes |
| `date_of_birth` | `contact.custom.dob` | date | both | yes |
| `emergency_contact` | `contact.custom.emergency_contact` | text | both | yes |
| `insurance_id` | `contact.custom.insurance_id` | text | both | yes |
| `department` | `lead.custom.department` | select | both | yes |
| `doctor_assigned` | `lead.custom.doctor` | user | both | yes |
| `diagnosis` | `lead.custom.diagnosis` | text | both | yes |
| `ward_bed` | `lead.custom.ward_bed` | text | app→crm | yes |
| `bill_amount` | `opportunity.value` | currency | app→crm | no |
| `payment_status` | `opportunity.stage` | select | both | no |

### School Management

| Frontend Field | CRM Field | Type | Direction | Custom? |
|---------------|-----------|------|-----------|---------|
| `student_id` | `contact.custom.student_id` | text | app→crm | yes |
| `parent_name` | `contact.custom.parent_name` | text | both | yes |
| `class` | `contact.custom.class` | select | both | yes |
| `section` | `contact.custom.section` | select | both | yes |
| `roll_number` | `contact.custom.roll_no` | text | app→crm | yes |
| `admission_date` | `contact.custom.admission_date` | date | app→crm | yes |
| `fee_amount` | `opportunity.value` | currency | app→crm | no |
| `fee_status` | `opportunity.stage` | select | both | no |
| `attendance_pct` | `contact.custom.attendance_pct` | number | app→crm | yes |

### Real Estate (Reference — Already Built)

| Frontend Field | CRM Field | Type | Direction | Custom? |
|---------------|-----------|------|-----------|---------|
| `customer_name` | `contact.full_name` | text | both | no |
| `customer_phone` | `contact.phone` | phone | both | no |
| `customer_email` | `contact.email` | email | both | no |
| `venture_name` | `opportunity.custom.project_name` | text | app→crm | yes |
| `plot_numbers` | `opportunity.custom.plot_numbers` | text | app→crm | yes |
| `plot_area` | `opportunity.custom.plot_area` | number | app→crm | yes |
| `base_amount` | `opportunity.value` | currency | app→crm | no |
| `net_amount` | `opportunity.custom.net_amount` | currency | app→crm | yes |
| `booking_status` | `opportunity.stage` | select | both | no |
| `discount_code` | `opportunity.custom.discount_code` | text | app→crm | yes |
| `payment_status` | `opportunity.custom.payment_status` | select | both | yes |
| `seller_code` | `opportunity.custom.seller_emp_code` | text | app→crm | yes |
| `commission_total` | `opportunity.custom.commission_total` | currency | app→crm | yes |

---

## Sync Direction Rules

| Direction | Meaning | When |
|-----------|---------|------|
| `app_to_crm` | Frontend → CRM only | Frontend is the source of truth (bookings, billing, system-generated IDs) |
| `crm_to_app` | CRM → Frontend only | CRM is the source of truth (lead status changes by staff, external updates) |
| `both` | Bi-directional sync | Either side can update (contact details, notes, status) |

### Conflict Resolution (for `both` direction)
1. Last-write-wins by default (configurable per org)
2. For critical fields (payment status, booking status): frontend wins (source of truth for business logic)
3. Conflicts queued for manual review (existing pattern from sync prototype)

---

## Webhook Event → CRM Field Update Matrix

When a frontend event fires, which CRM fields get updated:

| Event | CRM Action | Fields Updated |
|-------|-----------|---------------|
| `lead.created` | Create Lead + Contact | All mapped contact fields + lead_source, lead_status |
| `lead.updated` | Update Lead | Changed fields only |
| `lead.status_changed` | Update Lead stage | lead_status, stage_change_date |
| `booking.created` | Create Opportunity | All booking fields + link to Contact |
| `booking.confirmed` | Update Opportunity stage | stage = "Won", confirmation_date |
| `booking.cancelled` | Update Opportunity stage | stage = "Lost", cancel_reason |
| `payment.verified` | Update Opportunity custom fields | payment_status, payment_amount, payment_date |
| `appointment.created` | Create Task/Event | date, time, contact, staff, notes |
| `appointment.completed` | Update Task/Event | outcome, completion_notes |

---

## Auto-Create Custom Fields via CRM API

### Flow
```
1. Platform admin configures industry profile for a new client
2. System reads field_definitions from the industry profile
3. For each field, checks: does a mapping exist? → skip
4. For unmapped fields: calls CRM API to create custom field
   POST /api/v1/custom-fields
   {
     "object": "contact",
     "name": "blood_group",
     "label": "Blood Group",
     "type": "select",
     "options": ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]
   }
5. CRM returns field_id → store in module_field_mappings
6. Repeat for all unmapped fields
```

### Depends On
- MyAppz CRM API documentation for:
  - Custom field CRUD endpoints
  - Supported field types
  - Rate limits
  - Authentication method
  - Webhook configuration API (to auto-register webhook endpoints)

---

## Field Type Mapping

| Frontend Type | CRM Type | Notes |
|--------------|----------|-------|
| `text` | `text` / `single_line` | Max length varies by CRM |
| `textarea` | `textarea` / `multi_line` | |
| `number` | `number` / `decimal` | Precision configurable |
| `currency` | `monetary` / `currency` | Currency from org settings |
| `date` | `date` | ISO 8601 |
| `datetime` | `datetime` | ISO 8601 with timezone |
| `select` | `dropdown` / `select` | Options list must be synced |
| `multiselect` | `multi_select` / `checkbox` | |
| `email` | `email` | Validated |
| `phone` | `phone` | E.164 format preferred |
| `url` | `url` / `website` | |
| `boolean` | `checkbox` / `boolean` | |
| `user` | `user` / `owner` | Maps to CRM user ID |
| `file` | `file` / `attachment` | URL reference |
