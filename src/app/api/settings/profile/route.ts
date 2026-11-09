import { authed, body, json } from "@/lib/api";
import { getMyProfile, profileSchema, updateMyProfile } from "@/lib/services/staff";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => {
  const p = await getMyProfile(ctx);
  return json({ profile: { email: p.email, fullName: p.full_name, phone: p.phone } });
});

export const PUT = authed(async (req, ctx) => {
  const input = await body(req, profileSchema);
  return json({ profile: await updateMyProfile(ctx, input) });
});
