import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside the React server runtime; it is a no-op in tests.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "test-session-secret-0123456789-abcdefghijklmnop",
      PAYMENT_WEBHOOK_SECRET: "test-payment-webhook-secret-0123456789abcdef",
      UNIKLIFE_WEBHOOK_SECRET: "test-uniklife-inbound-secret-0123456789",
      UNIKLIFE_OUTBOUND_SECRET: "test-uniklife-outbound-secret-0123456789",
      CRON_SECRET: "test-cron-secret-0123456789-abcdefghijklmnop",
      AUTO_SEED_DEMO: "false",
    },
  },
});
