import type { NextRequest } from "next/server";
import { assertSameOrigin, body, ipOf, json, publicRoute, rateLimit } from "@/lib/api";
import { login, loginSchema } from "@/lib/services/auth";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { findOrganizationByHost } from "@/lib/tenant";
import { env } from "@/lib/env";

export const POST = publicRoute(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ip = ipOf(req);
  rateLimit(`login:${ip}`, 10, 60_000);
  const input = await body(req, loginSchema);
  rateLimit(`login-user:${input.email}`, 8, 5 * 60_000);
  const hostOrg = await findOrganizationByHost(await getDb(), req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "");
  const { token, role } = await login(input, hostOrg, ip);
  const res = json({ ok: true, redirectTo: role === "customer" ? "/portal" : "/dashboard" });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
