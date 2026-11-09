import type { NextRequest } from "next/server";
import { assertSameOrigin, body, ipOf, json, publicRoute, rateLimit } from "@/lib/api";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { findOrganizationByHost } from "@/lib/tenant";
import { badRequest } from "@/lib/errors";
import { env } from "@/lib/env";
import { registerCustomer, signupSchema } from "./signup";

/** Customer self-registration — only on a tenant-bound (white-label) host. */
export const POST = publicRoute(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ip = ipOf(req);
  rateLimit(`signup:${ip}`, 5, 60 * 60_000);
  const hostOrg = await findOrganizationByHost(await getDb(), req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "");
  if (!hostOrg) throw badRequest("Please use your developer's app link to register");
  const input = await body(req, signupSchema);
  rateLimit(`signup-email:${input.email}`, 3, 60 * 60_000);
  const { token } = await registerCustomer(input, hostOrg, ip);
  const res = json({ ok: true, redirectTo: "/portal" }, 201);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
