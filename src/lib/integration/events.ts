/**
 * INTERNAL application event names. These are NOT claims about UNIKLIFE.AI's API.
 * They are mapped to UNIKLIFE.AI formats only after the real interface is verified
 * (see integration_connections.event_mappings and docs/INTEGRATION.md).
 */
export const OUTBOUND_EVENT_TYPES = [
  "employee.created",
  "employee.updated",
  "employee.manager_changed",
  "plot.enquiry.created",
  "plot.hold.created",
  "plot.booking.created",
  "plot.booking.confirmed",
  "plot.booking.cancelled",
  "plot.booking.attribution_changed",
  "plot.sold",
  "discount.applied",
  "payment.verified",
  "upline.booking.notification_requested",
  "upline.followup.reminder_due",
  "commission.calculated",
  "commission.approved",
  "commission.finance_requested",
  "commission.payment_confirmed",
  "site_visit.created",
  "site_visit.reminder_due",
  "site_visit.completed",
  "integration.test",
] as const;
export type OutboundEventType = (typeof OUTBOUND_EVENT_TYPES)[number];

export interface EventEnvelope<T = Record<string, unknown>> {
  id: string; // outbound_events.id
  type: OutboundEventType;
  /** Destination event name from the connection's event_mappings (PROPOSED, unverified), if one is configured. */
  mapped_type?: string;
  version: 1;
  source: "uniklife-3d-venture";
  occurred_at: string;
  organization_id: string;
  source_record_id: string | null;
  idempotency_key: string;
  simulated: boolean;
  test: boolean;
  data: T;
}

/**
 * Proposed INBOUND event types the local webhook accepts. Each may only touch
 * CRM-owned fields (lead/contact/deal references, enquiry follow-up status) or
 * submit a finance reconciliation for human review — never plot status, pricing,
 * bookings, payments or commission payment status directly.
 */
export const INBOUND_EVENT_TYPES = ["ping", "lead.updated", "contact.updated", "deal.updated", "finance.payout_reconciled"] as const;
export type InboundEventType = (typeof INBOUND_EVENT_TYPES)[number];

export const EVENT_SOURCE = "uniklife-3d-venture" as const;
