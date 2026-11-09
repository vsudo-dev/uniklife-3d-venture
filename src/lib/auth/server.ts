import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { findOrganizationByHost, loadBranding, type Branding } from "@/lib/tenant";
import { loadAuthContext, type AuthContext, can } from "./context";
import type { Permission } from "./permissions";
import { SESSION_COOKIE, verifySession } from "./session";

export async function requestHost(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "";
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

/** Tenant bound to the current host (white-label domain), or null on the platform domain. */
export const getHostTenant = cache(async (): Promise<string | null> => {
  const db = await getDb();
  return findOrganizationByHost(db, await requestHost());
});

export const getBranding = cache(async (): Promise<Branding> => {
  const db = await getDb();
  const ctx = await getAuthContext();
  const orgId = (await getHostTenant()) ?? ctx?.organizationId ?? null;
  return loadBranding(db, orgId);
});

/**
 * Current user's context, or null. On a tenant-bound host the session may only
 * act inside that tenant — a member of another organization gets no context.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const db = await getDb();
  const hostOrg = await findOrganizationByHost(db, await requestHost());
  try {
    const ctx = await loadAuthContext(db, claims.sub, hostOrg ?? claims.org, await clientIp());
    if (hostOrg && ctx.organizationId !== hostOrg) return null;
    return ctx;
  } catch (e) {
    if (e instanceof AppError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
});

/** For server components/pages: redirect to login when unauthenticated or unauthorized. */
export async function requirePageContext(permission?: Permission | "staff" | "customer"): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (permission === "staff" && ctx.role === "customer") redirect("/portal");
  if (permission === "customer" && ctx.role !== "customer") redirect("/dashboard");
  if (permission && permission !== "staff" && permission !== "customer" && !can(ctx, permission)) redirect("/forbidden");
  return ctx;
}
