import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { AppError, rateLimited, unauthorized } from "@/lib/errors";
import { isPgError } from "@/lib/db/types";
import { getAuthContext } from "@/lib/auth/server";
import type { AuthContext } from "@/lib/auth/context";

export function json(data: unknown, init?: number | ResponseInit) {
  const res = NextResponse.json(data, typeof init === "number" ? { status: init } : init);
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  }
  if (e instanceof ZodError) {
    return json({ error: { code: "validation_error", message: "Invalid request", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, 400);
  }
  if (isPgError(e, "P0001")) {
    // Business rule enforced by a database trigger.
    return json({ error: { code: "conflict", message: (e as Error).message } }, 409);
  }
  if (isPgError(e, "23505")) return json({ error: { code: "conflict", message: "Duplicate record" } }, 409);
  if (isPgError(e, "40001") || isPgError(e, "40P01")) return json({ error: { code: "conflict", message: "Concurrent update — please retry" } }, 409);
  // Never leak internals; log server-side without request bodies or secrets.
  console.error("[api] unhandled error:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  return json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
}

type RouteCtx<P> = { params: Promise<P> };

/** Authenticated route handler wrapper. */
export function authed<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: AuthContext, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, route: RouteCtx<P>) => {
    try {
      assertSameOrigin(req);
      const ctx = await getAuthContext();
      if (!ctx) throw unauthorized();
      return await handler(req, ctx, await route.params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Public route handler wrapper (still error-mapped). */
export function publicRoute<P = Record<string, string>>(handler: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, route: RouteCtx<P>) => {
    try {
      return await handler(req, await route.params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

/** CSRF defence for cookie-authenticated mutations: require same-origin requests. */
export function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (no ambient cookies across origins)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new AppError(403, "forbidden", "Cross-origin request rejected");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(403, "forbidden", "Invalid origin");
  }
}

// Simple in-memory fixed-window rate limiter (per instance). Use a shared store in production.
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) throw rateLimited();
}

export function ipOf(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "local";
}
