import { SignJWT, jwtVerify } from "jose";
import { requireSecret } from "@/lib/env";

export const SESSION_COOKIE = "ul_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionClaims {
  sub: string; // app_users.id
  org: string | null; // active organization id
}

function key() {
  return new TextEncoder().encode(requireSecret("SESSION_SECRET"));
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ org: claims.org })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("uniklife-3d-venture")
    .setAudience("uniklife-3d-venture")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: "uniklife-3d-venture",
      audience: "uniklife-3d-venture",
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, org: typeof payload.org === "string" ? payload.org : null };
  } catch {
    return null;
  }
}
