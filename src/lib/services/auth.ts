import { z } from "zod";
import { env } from "@/lib/env";
import { unauthorized } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { signSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { db } from "./common";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

async function supabaseSignIn(email: string, password: string): Promise<string | null> {
  // Supabase Auth provider (AUTH_PROVIDER=supabase). UNTESTED until a Supabase project is configured.
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("Supabase Auth is not configured");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  return data.user.id; // app_users.id must equal auth.users.id
}

/**
 * Verifies credentials and returns a signed session token. On a tenant-bound host
 * the user must belong to that tenant (platform admins excepted).
 */
export async function login(input: z.infer<typeof loginSchema>, hostOrgId: string | null, ip: string | null) {
  const q = await db();
  const [user] = await q.query<{ id: string; password_hash: string | null; status: string; is_platform_admin: boolean }>(
    "select id, password_hash, status, is_platform_admin from app_users where lower(email) = $1",
    [input.email],
  );
  let ok = false;
  if (env.AUTH_PROVIDER === "supabase") {
    const sbId = await supabaseSignIn(input.email, input.password);
    ok = !!sbId && sbId === user?.id;
  } else {
    ok = await verifyPassword(input.password, user?.password_hash);
  }
  if (!user || !ok || user.status !== "active") throw unauthorized("Invalid email or password");

  const memberships = await q.query<{ organization_id: string; role: string }>(
    `select m.organization_id, m.role from organization_members m join organizations o on o.id = m.organization_id
      where m.user_id = $1 and m.status = 'active' and o.status = 'active' order by m.created_at`,
    [user.id],
  );
  let org: string | null = memberships[0]?.organization_id ?? null;
  if (hostOrgId) {
    if (!user.is_platform_admin && !memberships.some((m) => m.organization_id === hostOrgId)) throw unauthorized("Invalid email or password");
    org = hostOrgId;
  }
  if (!org && !user.is_platform_admin) throw unauthorized("Your account has no active organization");

  await q.query("update app_users set last_login_at = now() where id = $1", [user.id]);
  await writeAudit(q, { system: true, organizationId: org }, { action: "auth.login", entityType: "user", entityId: user.id, metadata: { ip } });
  const role = memberships.find((m) => m.organization_id === org)?.role ?? (user.is_platform_admin ? "platform_admin" : null);
  return { token: await signSession({ sub: user.id, org }), role };
}
