import { getDb } from "@/lib/db";
import type { Queryable } from "@/lib/db/types";
import { num } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { badRequest } from "@/lib/errors";

export async function withTx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export async function db(): Promise<Queryable> {
  return getDb();
}

export interface OrgSettings {
  id: string;
  name: string;
  currency: string;
  holdMinutes: number;
  paymentWindowMinutes: number;
  bookingAmountPercent: number;
  allowDiscountStacking: boolean;
  maxDiscountPercent: number;
  discountApprovalThresholdPercent: number;
}

export async function loadOrgSettings(q: Queryable, orgId: string): Promise<OrgSettings> {
  const [o] = await q.query<Record<string, unknown>>("select * from organizations where id = $1", [orgId]);
  if (!o) throw badRequest("Organization not found");
  return {
    id: String(o.id),
    name: String(o.name),
    currency: String(o.currency),
    holdMinutes: num(o.hold_minutes),
    paymentWindowMinutes: num(o.payment_window_minutes),
    bookingAmountPercent: num(o.booking_amount_percent),
    allowDiscountStacking: Boolean(o.allow_discount_stacking),
    maxDiscountPercent: num(o.max_discount_percent),
    discountApprovalThresholdPercent: num(o.discount_approval_threshold_percent),
  };
}

export function idempotencyKeyOk(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(key);
}

export function requireIdempotencyKey(key: unknown): string {
  if (!idempotencyKeyOk(key)) throw badRequest("A valid idempotency key (8-128 chars) is required");
  return key;
}

export function ctxOrg(ctx: AuthContext): string {
  return ctx.organizationId;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
