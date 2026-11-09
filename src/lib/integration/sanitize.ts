/** Helpers that keep secrets and oversized payloads out of logs and the database. */

export const EXCERPT_MAX = 500;

const SECRETISH: RegExp[] = [
  /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
  /((?:secret|token|password|api[_-]?key|signature)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
  /(t=\d+,v1=)[0-9a-f]{64}/gi,
];

/** Redacts known secret values and credential-looking fragments, strips control chars, truncates. */
export function sanitizeText(input: unknown, opts: { secrets?: (string | undefined)[]; max?: number } = {}): string {
  let s = typeof input === "string" ? input : input instanceof Error ? input.message : input == null ? "" : String(input);
  for (const secret of opts.secrets ?? []) {
    if (secret && secret.length >= 8) s = s.split(secret).join("[redacted]");
  }
  for (const re of SECRETISH) s = s.replace(re, "$1[redacted]");
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const max = opts.max ?? EXCERPT_MAX;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** True when the env var NAMED here is set (value never returned). Same rule as secretFromEnvName. */
export function envVarIsSet(name: string | null | undefined): boolean {
  if (!name || !ENV_NAME_RE.test(name)) return false;
  const v = process.env[name];
  return !!v && v.length >= 16;
}

/** Runtime check (read on every call so ops can flip it without a code change). */
export function liveRuntimeEnabled(): boolean {
  const v = (process.env.UNIKLIFE_LIVE_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}
