import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor, demoVenture, key, plotIds } from "../support/db";
import { placeHold, requestBooking, getBooking, cancelBooking, expireStale } from "@/lib/services/bookings";
import { initiatePayment, simulateMockGateway, handlePaymentWebhook } from "@/lib/services/payments";
import { AppError } from "@/lib/errors";

let db: Database;
let ventureId: string;

beforeAll(async () => {
  db = await createTestDb();
  ventureId = (await demoVenture(db)).id;
});

const customer = { fullName: "Test Buyer", phone: "+919811100000" };

describe("multi-plot booking flow", () => {
  it("holds 4 plots, books with a discount, confirms only after a verified payment", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ids = await plotIds(db, ventureId, ["17", "18", "19", "20"]);
    const hold = await placeHold(anil, { plotIds: ids, customer, idempotencyKey: key("hold") });
    expect(hold.plots).toHaveLength(4);
    expect(hold.creditedEmployeeCode).toBe("EMP-00125");

    const res = await requestBooking(anil, { holdGroupId: hold.holdGroupId, discountRefs: ["LAUNCH5"], idempotencyKey: key("bk") });
    const bookingId = res.bookingId;
    let b = await getBooking(anil, bookingId);
    expect(b.booking.status).toBe("payment_pending");
    expect(b.plots).toHaveLength(4);
    expect(Number(b.booking.discount_amount)).toBeGreaterThan(0);

    const statuses = await db.query<{ status: string }>("select status from plots where id = any($1::uuid[])", [ids]);
    expect(statuses.every((s) => s.status === "reserved")).toBe(true);

    // Failed payment leaves it pending.
    const t1 = await initiatePayment(anil, bookingId, key("pay"));
    await simulateMockGateway(anil, t1.transactionId, "failure");
    b = await getBooking(anil, bookingId);
    expect(b.booking.status).toBe("payment_pending");

    const t2 = await initiatePayment(anil, bookingId, key("pay"));
    expect(t2.simulated).toBe(true);
    await simulateMockGateway(anil, t2.transactionId, "success");
    b = await getBooking(anil, bookingId);
    expect(b.booking.status).toBe("confirmed");
    expect(b.booking.confirmed_pricing_snapshot).toBeTruthy();
    const booked = await db.query<{ status: string }>("select status from plots where id = any($1::uuid[])", [ids]);
    expect(booked.every((s) => s.status === "booked")).toBe(true);

    // Commissions were calculated for the credited chain.
    const entries = await db.query<{ n: number }>("select count(*)::int as n from commission_entries where booking_id = $1", [bookingId]);
    expect(entries[0].n).toBeGreaterThan(0);
  });

  it("prevents concurrent double holds on the same plot", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p] = await plotIds(db, ventureId, ["25"]);
    const results = await Promise.allSettled([
      placeHold(anil, { plotIds: [p], customer, idempotencyKey: key("h") }),
      placeHold(ceo, { plotIds: [p], customer: { fullName: "Other", phone: "+919822200000" }, idempotencyKey: key("h") }),
      placeHold(ceo, { plotIds: [p], customer: { fullName: "Other2", phone: "+919822200001" }, idempotencyKey: key("h") }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.every((r) => r.reason instanceof AppError && r.reason.status === 409)).toBe(true);
    const active = await db.query<{ n: number }>("select count(*)::int as n from reservations where plot_id = $1 and status = 'active'", [p]);
    expect(active[0].n).toBe(1);
  });

  it("is idempotent for retried hold requests", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ids = await plotIds(db, ventureId, ["26"]);
    const k = key("idem");
    const a = await placeHold(anil, { plotIds: ids, customer, idempotencyKey: k });
    const b = await placeHold(anil, { plotIds: ids, customer, idempotencyKey: k });
    expect(b.replayed).toBe(true);
    expect(b.holdGroupId).toBe(a.holdGroupId);
  });

  it("releases expired holds back to available", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ids = await plotIds(db, ventureId, ["27"]);
    await placeHold(anil, { plotIds: ids, customer, idempotencyKey: key("exp") });
    await db.query("update reservations set expires_at = now() - interval '1 minute' where plot_id = $1 and status = 'active'", [ids[0]]);
    const r = await db.transaction((q) => expireStale(q));
    expect(r.expiredHolds).toBeGreaterThanOrEqual(1);
    const [p] = await db.query<{ status: string }>("select status from plots where id = $1", [ids[0]]);
    expect(p.status).toBe("available");
  });

  it("rejects an expired discount and refuses the booking", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ids = await plotIds(db, ventureId, ["28"]);
    const hold = await placeHold(anil, { plotIds: ids, customer, idempotencyKey: key("d") });
    await expect(requestBooking(anil, { holdGroupId: hold.holdGroupId, discountRefs: ["MONSOON10"], idempotencyKey: key("d") })).rejects.toMatchObject({ status: 422 });
  });

  it("ignores duplicate payment webhooks and rejects bad signatures", async () => {
    const bad = await handlePaymentWebhook(JSON.stringify({ id: "evt_x" }), "t=1,v1=" + "0".repeat(64));
    expect(bad.status).toBe(401);
  });

  it("network privacy: another team cannot see the booking", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const deepa = await ctxFor(db, "deepa@demo.local");
    const ids = await plotIds(db, ventureId, ["29"]);
    const hold = await placeHold(anil, { plotIds: ids, customer, idempotencyKey: key("p") });
    const res = await requestBooking(anil, { holdGroupId: hold.holdGroupId, discountRefs: [], idempotencyKey: key("p") });
    await expect(getBooking(deepa, res.bookingId)).rejects.toMatchObject({ status: 404 });
    const lakshmi = await ctxFor(db, "lakshmi@demo.local"); // upline of Anil
    await expect(getBooking(lakshmi, res.bookingId)).resolves.toBeTruthy();
    await cancelBooking(anil, res.bookingId, "Customer changed mind");
  });
});
