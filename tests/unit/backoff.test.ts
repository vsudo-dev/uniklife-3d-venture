import { describe, expect, it } from "vitest";
import { BACKOFF_CAP_MS, computeBackoff, computeRetryDelay } from "@/lib/integration/backoff";
import { sanitizeText } from "@/lib/integration/sanitize";

describe("computeBackoff", () => {
  it("doubles from 30s", () => {
    expect(computeBackoff(1)).toBe(30_000);
    expect(computeBackoff(2)).toBe(60_000);
    expect(computeBackoff(3)).toBe(120_000);
    expect(computeBackoff(4)).toBe(240_000);
    expect(computeBackoff(6)).toBe(960_000);
  });

  it("caps at one hour and handles odd input", () => {
    expect(computeBackoff(8)).toBe(BACKOFF_CAP_MS);
    expect(computeBackoff(100)).toBe(BACKOFF_CAP_MS);
    expect(computeBackoff(0)).toBe(30_000);
    expect(computeBackoff(-5)).toBe(30_000);
    expect(computeBackoff(Number.NaN)).toBe(30_000);
  });

  it("jitter stays within ±20% and never exceeds the cap", () => {
    expect(computeRetryDelay(1, () => 0)).toBe(24_000);
    expect(computeRetryDelay(1, () => 1)).toBe(36_000);
    expect(computeRetryDelay(1, () => 0.5)).toBe(30_000);
    expect(computeRetryDelay(50, () => 1)).toBe(BACKOFF_CAP_MS);
    for (let i = 0; i < 50; i++) {
      const d = computeRetryDelay(3);
      expect(d).toBeGreaterThanOrEqual(96_000);
      expect(d).toBeLessThanOrEqual(144_000);
    }
  });
});

describe("sanitizeText", () => {
  it("redacts secrets and truncates to 500 chars", () => {
    const s = sanitizeText(`Authorization: Bearer abc.def-123 token=xyz secret-value-123456`, { secrets: ["secret-value-123456"] });
    expect(s).not.toContain("abc.def-123");
    expect(s).not.toContain("xyz");
    expect(s).not.toContain("secret-value-123456");
    expect(sanitizeText("x".repeat(2000)).length).toBe(500);
  });
});
