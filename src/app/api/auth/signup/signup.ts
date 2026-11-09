import { z } from "zod";
import { env } from "@/lib/env";
import { badRequest, conflict, unprocessable } from "@/lib/errors";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { signSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { withTx } from "@/lib/services/common";
import { normalizePhone } from "@/lib/services/customers";
import { createNotification } from "@/lib/services/notifications";

export const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid mobile number"),
  password: z.string().min(1).max(200),
  website: z.string().max(0).optional(), // honeypot — must stay empty
});
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Customer self-registration on a tenant-bound host.
 *
 * Dedupe: an existing customer record (same organization, same phone, no linked user)
 * is linked ONLY when its email also matches the sign-up email. A phone number alone
 * is not proof of identity (no OTP verification exists yet), and linking on phone
 * alone would let anyone who knows a buyer's number see that buyer's bookings.
 * Phone-only matches create a new customer record and staff are asked to verify & merge.
 */
export async function registerCustomer(input: SignupInput, orgId: string, ip: string | null) {
  if (env.AUTH_PROVIDER !== "local") throw unprocessable("Self-registration is not available with the configured sign-in provider");
  const pwError = validatePasswordStrength(input.password);
  if (pwError) throw badRequest(pwError);
  const phone = normalizePhone(input.phone);
  const hash = await hashPassword(input.password);

  return withTx(async (q) => {
    const [existing] = await q.query<{ id: string }>("select id from app_users where lower(email) = $1", [input.email]);
    if (existing) throw conflict("An account with this email already exists — please sign in instead");
    const [user] = await q.query<{ id: string }>(
      "insert into app_users (email, full_name, phone, password_hash, auth_provider) values ($1,$2,$3,$4,'local') returning id",
      [input.email, input.fullName, phone, hash],
    );
    await q.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'customer')", [orgId, user.id]);

    const [match] = await q.query<{ id: string; email: string | null }>(
      `select id, email from customers where organization_id = $1 and phone = $2 and user_id is null order by created_at limit 1 for update`,
      [orgId, phone],
    );
    let customerId: string;
    let linked = false;
    if (match && match.email && match.email.toLowerCase() === input.email) {
      await q.query("update customers set user_id = $2, full_name = coalesce(nullif(full_name,''), $3) where id = $1", [match.id, user.id, input.fullName]);
      customerId = match.id;
      linked = true;
    } else {
      const [c] = await q.query<{ id: string }>(
        "insert into customers (organization_id, user_id, full_name, email, phone, notes) values ($1,$2,$3,$4,$5,$6) returning id",
        [orgId, user.id, input.fullName, input.email, phone, match ? `Self-registered. Possible duplicate of customer ${match.id} (same phone) — verify identity before merging.` : "Self-registered via the customer app"],
      );
      customerId = c.id;
      if (match) {
        const admins = await q.query<{ user_id: string }>(
          "select user_id from organization_members where organization_id = $1 and role in ('org_admin','sales_manager') and status = 'active'",
          [orgId],
        );
        for (const a of admins) {
          await createNotification(q, {
            organizationId: orgId, recipientUserId: a.user_id, type: "system", title: "Possible duplicate customer",
            body: `${input.fullName} registered with a phone number that matches an existing customer record. Verify their identity before merging the records.`,
            followUpAction: "Verify identity and merge customer records", dedupeKey: `signup-dup:${customerId}:${a.user_id}`,
          });
        }
      }
    }
    await writeAudit(q, { system: true, organizationId: orgId }, {
      action: "auth.signup", entityType: "user", entityId: user.id,
      summary: `Customer self-registration (${linked ? "linked to existing customer record" : "new customer record"})`,
      metadata: { ip, customer_id: customerId, linked_existing: linked, phone_match_unverified: !!match && !linked },
    });
    const token = await signSession({ sub: user.id, org: orgId });
    return { token, customerId, linked };
  });
}
