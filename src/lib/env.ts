import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_DRIVER: z.enum(["pglite", "postgres"]).default("pglite"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default(".data/pglite"),
  AUTO_SEED_DEMO: bool(true),

  AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  SESSION_SECRET: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default(".data/uploads"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("venture-assets"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),

  PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  UNIKLIFE_LIVE_ENABLED: bool(false),
  UNIKLIFE_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  CRON_SECRET: z.string().optional(),
  /** TEST deployments only: list demo accounts + password on the login page. Never enable in production. */
  SHOW_TEST_ACCOUNTS: bool(false),
  TEST_ACCOUNTS_PASSWORD: z.string().optional(),
  /** "anthropic" enables the optional PDF-inventory AI fallback (needs ANTHROPIC_API_KEY). Off by default: no paid usage. */
  AI_PROVIDER: z.enum(["disabled", "anthropic"]).default("disabled"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-sonnet-5-5"),

  /** WhatsApp Business (Meta Cloud API). Secrets stay in env; the database only holds ids. */
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /** Google Maps JavaScript API *browser* key. Restrict it by HTTP referrer + API in Google Cloud; it is sent to signed-in staff browsers. */
  GOOGLE_MAPS_API_KEY: z.string().regex(/^[A-Za-z0-9_-]{20,80}$/).optional().or(z.literal("").transform(() => undefined)),
  /** >= 32 chars; encrypts stored WhatsApp tokens. Falls back to SESSION_SECRET in dev only. */
  WHATSAPP_TOKEN_KEY: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Never print values — only which keys are invalid.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  return parsed.data;
}

export const env: Env = load();

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-change-me-0123456789abcdef";

/** Returns a secret, refusing insecure fallbacks in production. */
export function requireSecret(name: "SESSION_SECRET" | "PAYMENT_WEBHOOK_SECRET" | "CRON_SECRET"): string {
  const v = env[name];
  if (v && v.length >= 32) return v;
  if (env.NODE_ENV === "production") {
    throw new Error(`${name} must be set (>= 32 chars) in production`);
  }
  return `${DEV_FALLBACK_SECRET}:${name}`;
}

/** Reads a secret whose env var NAME is stored in the database (integration connections). */
export function secretFromEnvName(envName: string | null | undefined): string | undefined {
  if (!envName || !/^[A-Z][A-Z0-9_]{2,63}$/.test(envName)) return undefined;
  const v = process.env[envName];
  return v && v.length >= 16 ? v : undefined;
}
