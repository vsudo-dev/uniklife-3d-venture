import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/lib/webhooks/signature";

const secret = "unit-test-secret-0123456789abcdef";
const body = JSON.stringify({ id: "evt_1", type: "ping", occurred_at: "2026-01-01T00:00:00Z", data: {} });

describe("webhook signatures", () => {
  it("accepts a valid signature", () => {
    const now = 1_800_000_000;
    const header = signPayload(secret, body, now);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, body, header, 300, now)).toEqual({ ok: true, timestamp: now });
  });

  it("rejects a tampered body", () => {
    const now = 1_800_000_000;
    const header = signPayload(secret, body, now);
    const r = verifySignature(secret, body.replace("ping", "lead.updated"), header, 300, now);
    expect(r.ok).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const now = 1_800_000_000;
    const header = signPayload("another-secret-0123456789abcdef", body, now);
    expect(verifySignature(secret, body, header, 300, now)).toMatchObject({ ok: false, reason: "Signature mismatch" });
  });

  it("rejects an expired timestamp (replay) and a future one", () => {
    const now = 1_800_000_000;
    const old = signPayload(secret, body, now - 301);
    expect(verifySignature(secret, body, old, 300, now)).toMatchObject({ ok: false });
    const future = signPayload(secret, body, now + 301);
    expect(verifySignature(secret, body, future, 300, now)).toMatchObject({ ok: false });
    // Inside the window is fine.
    expect(verifySignature(secret, body, signPayload(secret, body, now - 299), 300, now).ok).toBe(true);
  });

  it("rejects re-using a valid signature with a modified timestamp", () => {
    const now = 1_800_000_000;
    const header = signPayload(secret, body, now - 1000);
    const forged = header.replace(`t=${now - 1000}`, `t=${now}`);
    expect(verifySignature(secret, body, forged, 300, now)).toMatchObject({ ok: false, reason: "Signature mismatch" });
  });

  it("rejects malformed or missing headers and a missing secret", () => {
    const now = 1_800_000_000;
    expect(verifySignature(secret, body, null, 300, now)).toMatchObject({ ok: false });
    expect(verifySignature(secret, body, "garbage", 300, now)).toMatchObject({ ok: false, reason: "Malformed signature header" });
    expect(verifySignature(secret, body, "t=abc,v1=00", 300, now)).toMatchObject({ ok: false, reason: "Malformed signature header" });
    expect(verifySignature(secret, body, `t=${now},v1=${"z".repeat(64)}`, 300, now)).toMatchObject({ ok: false });
    expect(verifySignature(undefined, body, signPayload(secret, body, now), 300, now)).toMatchObject({ ok: false });
  });
});
