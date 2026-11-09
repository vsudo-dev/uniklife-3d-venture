import { spawn } from "node:child_process";

// Isolated local demo database; never use the production credentials in .env.local.
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3015"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_DRIVER: "pglite", PGLITE_DATA_DIR: ".data/sync-prototype", AUTO_SEED_DEMO: "true", ALLOW_DEMO_SEED: "false", STORAGE_DRIVER: "local", APP_BASE_URL: "http://localhost:3015", AUTH_PROVIDER: "local", SHOW_TEST_ACCOUNTS: "true", SESSION_SECRET: "local-sync-prototype-only-0123456789abcdef", UNIKLIFE_LIVE_ENABLED: "false" },
});
child.on("exit", code => process.exit(code ?? 0));
