import type { NextRequest } from "next/server";
import { assertSameOrigin, json, publicRoute } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const POST = publicRoute(async (req: NextRequest) => {
  assertSameOrigin(req);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax" });
  // Ask the service worker/browser to drop any cached authenticated data.
  res.headers.set("Clear-Site-Data", '"cache"');
  return res;
});
