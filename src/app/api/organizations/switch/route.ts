import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { resolveSwitchTarget } from "@/lib/services/organizations";
import { env } from "@/lib/env";

/**
 * Switches the active organization: platform admins to any organization, other
 * users only to organizations they are an active member of. Re-signs the session.
 */
export const POST = authed(async (req, ctx) => {
  const { organizationId } = await body(req, z.object({ organizationId: z.string().uuid() }));
  const org = await resolveSwitchTarget(ctx, organizationId);
  const token = await signSession({ sub: ctx.user.id, org });
  const res = json({ ok: true, organizationId: org, redirectTo: "/dashboard" });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
