import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor, demoVenture, key, plotIds } from "../support/db";
import { createDiscount, decideDiscount, discountDashboard, discountInputSchema, getDiscount, listDiscounts, updateDiscount, validateDiscounts } from "@/lib/services/discounts";
import { getBooking, placeHold, requestBooking } from "@/lib/services/bookings";
import { initiatePayment, simulateMockGateway } from "@/lib/services/payments";
import { AppError } from "@/lib/errors";

let db: Database;
let ventureId: string;

beforeAll(async () => {
  db = await createTestDb();
  ventureId = (await demoVenture(db)).id;
});

const input = (over: Record<string, unknown>) => discountInputSchema.parse({ name: "Test discount", valueType: "percentage", category: "general", value: 3, ...over });

describe("discount administration", () => {
  it("sales executives cannot create discounts", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    await expect(createDiscount(anil, input({ name: "Exec discount" }))).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a percentage above the organization maximum", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    await expect(createDiscount(ceo, input({ name: "Too big", value: 35 }))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/organization limit/) });
  });

  it("the creator cannot approve their own pending discount (four-eyes)", async () => {
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const ceo = await ctxFor(db, "ceo@demo.local");
    const { discount, policy } = await createDiscount(lakshmi, input({ name: "Manager offer 3%" }));
    expect(discount.status).toBe("pending_approval");
    expect(policy.requiresApproval).toBe(true);
    await expect(decideDiscount(lakshmi, String(discount.id), "approve")).rejects.toMatchObject({ status: 403 });
    const approved = await decideDiscount(ceo, String(discount.id), "approve", "Looks fine");
    expect(approved.status).toBe("active");
    const detail = await getDiscount(ceo, String(discount.id));
    expect(detail.approvals.map((a) => a.action)).toEqual(["approved", "submitted"]);
  });

  it("whoever re-submits an edited discount cannot approve it either", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const lakshmi = await ctxFor(db, "lakshmi@demo.local");
    const { discount } = await createDiscount(ceo, input({ name: "Admin offer 2%", value: 2 }));
    expect(discount.status).toBe("active");
    const edited = await updateDiscount(lakshmi, String(discount.id), input({ name: "Admin offer 2% (edited)", value: 2.5 }));
    expect(edited.discount.status).toBe("pending_approval");
    await expect(decideDiscount(lakshmi, String(discount.id), "approve")).rejects.toMatchObject({ status: 403 });
    // The original creator is also excluded; a third person approves.
    await expect(decideDiscount(ceo, String(discount.id), "approve")).rejects.toMatchObject({ status: 403 });
    const priya = await ctxFor(db, "priya@demo.local");
    expect((await decideDiscount(priya, String(discount.id), "approve")).status).toBe("active");
  });

  it("lists by status and reports KPIs", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const expired = await listDiscounts(ceo, { status: "expired" });
    expect(expired.some((d) => d.code === "MONSOON10")).toBe(true);
    const active = await listDiscounts(ceo, { status: "active" });
    expect(active.some((d) => d.code === "MONSOON10")).toBe(false);
    const kpi = await discountDashboard(ceo);
    expect(kpi.pendingApproval).toBeGreaterThanOrEqual(1);
    expect(kpi.settings.allowStacking).toBe(false);
  });
});

describe("discount use", () => {
  it("a coupon code cannot be applied by its id", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const [launch] = await db.query<{ id: string }>("select id from discounts where code = 'LAUNCH5'");
    const plots = await plotIds(db, ventureId, ["44"]);
    const byId = await validateDiscounts(anil, { plotIds: plots, discountRefs: [launch.id] });
    expect(byId.ok).toBe(false);
    expect(byId.lines[0].reason).toMatch(/invalid/i);
    const byCode = await validateDiscounts(anil, { plotIds: plots, discountRefs: ["launch5"] });
    expect(byCode.ok).toBe(true);
    expect(byCode.snapshot.discountTotal).toBeGreaterThan(0);
  });

  it("enforces the total usage limit under concurrent booking requests", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const anil = await ctxFor(db, "anil@demo.local");
    const { discount } = await createDiscount(ceo, input({ name: "Only once", code: "ONEONLY", valueType: "fixed_amount", value: 10_000, usageLimitTotal: 1 }));
    expect(discount.status).toBe("active");
    const [p1, p2] = await plotIds(db, ventureId, ["41", "42"]);
    const h1 = await placeHold(anil, { plotIds: [p1], customer: { fullName: "Buyer One", phone: "+919800000041" }, idempotencyKey: key("h") });
    const h2 = await placeHold(anil, { plotIds: [p2], customer: { fullName: "Buyer Two", phone: "+919800000042" }, idempotencyKey: key("h") });
    const results = await Promise.allSettled([
      requestBooking(anil, { holdGroupId: h1.holdGroupId, discountRefs: ["ONEONLY"], idempotencyKey: key("b") }),
      requestBooking(anil, { holdGroupId: h2.holdGroupId, discountRefs: ["ONEONLY"], idempotencyKey: key("b") }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AppError);
    expect(rejected[0].reason.status).toBe(422);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from discount_redemptions where discount_id = $1 and status in ('reserved','confirmed')", [discount.id]);
    expect(n).toBe(1);
  });

  it("re-validates at confirmation: a discount paused after the request blocks confirmation", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const anil = await ctxFor(db, "anil@demo.local");
    const { discount } = await createDiscount(ceo, input({ name: "Pause me", code: "PAUSEME", valueType: "fixed_amount", value: 5_000 }));
    const plots = await plotIds(db, ventureId, ["43"]);
    const hold = await placeHold(anil, { plotIds: plots, customer: { fullName: "Buyer Three", phone: "+919800000043" }, idempotencyKey: key("h") });
    const { bookingId } = await requestBooking(anil, { holdGroupId: hold.holdGroupId, discountRefs: ["PAUSEME"], idempotencyKey: key("b") });
    await decideDiscount(ceo, String(discount.id), "pause", "Campaign halted");

    const t = await initiatePayment(anil, bookingId, key("pay"));
    await simulateMockGateway(anil, t.transactionId, "success");

    const b = await getBooking(anil, bookingId);
    expect(b.booking.status).toBe("payment_pending");
    expect(String(b.booking.review_reason)).toMatch(/paused/i);
    expect(b.verifiedAmount).toBeGreaterThan(0);
    const [{ status }] = await db.query<{ status: string }>("select status from plots where id = $1", [plots[0]]);
    expect(status).toBe("reserved");
  });
});
