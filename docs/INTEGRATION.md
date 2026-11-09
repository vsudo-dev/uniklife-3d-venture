# UNIKLIFE.AI integration guide

**Status: adapter built and tested against a MOCK connector. No UNIKLIFE.AI API documentation, endpoint, credential or event format has been provided or verified, so nothing here is a claim about UNIKLIFE.AI's real API.** Live delivery stays disabled until the items in "Going live" are completed and approved.

## Architecture

```
business change ──(same DB transaction)──▶ outbound_events (outbox)
                                              │  processOutbox(): claim (SKIP LOCKED) → send → record
                                              ▼
                               connector: mock (default) | http (live, disabled)
                                              │  retries: 30s·2^(n-1) ±20% jitter, max 1h, dead-letter after max_attempts
                                              ▼
                           outbound_delivery_attempts (sanitized logs)

CRM ──POST /api/webhooks/uniklife/incoming──▶ verify HMAC or bearer token → schema → dedupe → process → webhook_events
```

- Settings UI: **/integrations** (connection, env-var presence, event mappings, test event, dispatch now). Logs: **/integrations/logs** (outbound, inbound, mock CRM inbox; retry/replay).
- Internal dispatch endpoint (NOT a UNIKLIFE.AI URL): `POST /api/integrations/uniklife/sync`.
- Scheduler: `GET /api/cron/run` with `Authorization: Bearer $CRON_SECRET` (expiry sweep, reminders, outbox, push queue).

## Outbound events (internal names)

`employee.created`, `employee.updated`, `employee.manager_changed`, `plot.enquiry.created`, `plot.hold.created`, `plot.booking.created`, `plot.booking.confirmed`, `plot.booking.cancelled`, `plot.booking.attribution_changed`, `plot.sold`, `discount.applied`, `payment.verified`, `upline.booking.notification_requested`, `upline.followup.reminder_due`, `commission.calculated`, `commission.approved`, `commission.finance_requested`, `commission.payment_confirmed`, `site_visit.created`, `site_visit.reminder_due`, `site_visit.completed`, `integration.test`.

Envelope:

```json
{
  "id": "<outbound event uuid>", "type": "plot.booking.created", "mapped_type": "<optional, from event_mappings>",
  "version": 1, "source": "uniklife-3d-venture", "occurred_at": "…", "organization_id": "…",
  "source_record_id": "…", "idempotency_key": "booking.created:<id>", "simulated": false, "test": false,
  "data": { … }
}
```

HTTP connector headers: `Content-Type: application/json`, `Idempotency-Key`, `X-Uniklife-Event`, and either `X-Uniklife-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` (secret from the env var named in `outbound_secret_env`) or `Authorization: Bearer <secret>`.

## Inbound webhook

`POST /api/webhooks/uniklife/incoming`, header `X-Uniklife-Connection: <connection id>`, plus either a signature or bearer credential. Body `{ id, type, occurred_at, data, source? }`.

The receiver also accepts a shared secret as a bearer token in the `Authorization` header. This is the simplest option for CRM workflow actions with a built-in Auth setting. Both authentication methods use the secret from `inbound_secret_env`; use HTTPS and a unique event `id`.

Accepted (proposed) types and their **only** permitted effects:

| Type | Effect |
| --- | --- |
| `ping` | none (connectivity check) |
| `lead.updated` | sets `enquiries.crm_lead_id` / follow-up status (never `converted`) |
| `contact.updated` | sets `customers.crm_contact_id` |
| `deal.updated` | sets `bookings.crm_deal_id` |
| `finance.payout_reconciled` | creates a finance reconciliation **for human review** — never marks commissions paid |

Plot status, prices, bookings, payments and commissions can never be changed by a webhook. Events with `source = "uniklife-3d-venture"` are ignored (loop prevention); events caused by an inbound webhook are recorded but not echoed back. Duplicate event ids are acknowledged once (`duplicate: true`). Bad signatures get 401 and are not stored.

## Going live (requires your authorization)

1. Obtain UNIKLIFE.AI's documented endpoint(s), auth method, event formats and a sandbox account.
2. Set env vars (values only in Vercel): `UNIKLIFE_OUTBOUND_SECRET`, `UNIKLIFE_WEBHOOK_SECRET` (≥16 chars).
3. In /integrations: set destination URL (https), auth type, event mappings to the verified UNIKLIFE.AI names.
4. Test against the sandbox; review /integrations/logs.
5. An org admin performs **Verify live** (typed confirmation) and you set `UNIKLIFE_LIVE_ENABLED=true`.

## Quick connect in the CRM workflow builder

1. In CRM, create an **Incoming Webhook** trigger. Copy its generated HTTPS URL into **CRM Incoming Webhook URL** in **/integrations**. This sends app events to CRM.
2. Set the outbound authentication method and shared secret in the app/server environment; configure the matching authentication in CRM's incoming trigger if it requires it.
3. In CRM, add an **Outgoing Webhook** action: POST JSON to the **App webhook URL** shown in **/integrations**, include `X-Uniklife-Connection` with the displayed connection ID, and choose bearer authentication or HMAC.
4. Send a `ping` event to verify the CRM → app direction. For lead/contact/deal updates, include the app's record ID as `enquiry_id`, `customer_id`, or `booking_id` in `data`, along with the CRM record ID.
5. Verify the CRM's actual URL, authentication, and event format before switching from MOCK to LIVE.

## App → CRM parameters

These are user-facing parameter names available on the API tab. Actual values depend on the event.

- **Customer & enquiry:** Customer name, phone number, email address, enquiry message, lead source, customer ID, enquiry ID.
- **Project & plots:** Project name, project ID, plot number(s), plot area, base amount, net amount, total area.
- **Booking & payment:** Booking number, booking ID, payment status, booking amount, advance amount, discount amount, currency, payment due date, verified payment amount, payment ID, payment amount, payment provider, payment method, payment reference, refund review required.
- **Discount:** Discount name, discount code, discount amount, discount ID.
- **Sales team:** Employee name, employee code, designation, commission level, reporting manager ID, employment status, selling employee code.
- **Commission:** Commission total, commission basis, plan version, payee name, payee employee code, payee role, commission level, commission amount, commission rate, sale value, commission area, settlement ID, settlement reference, settlement period, payment confirmation reference.
- **Site visit:** Visitor name, visitor phone, visit date and time, visit status, visit outcome, completion date and time, project name, project ID, plot number(s), customer ID, trip timestamps.
- **Hold & follow-up:** Hold ID, hold expiry date and time, reminder date and time, follow-up type, reason.
- **Request details:** Event ID, event date and time, organization ID, record ID, idempotency key, test indicator, simulated indicator.
