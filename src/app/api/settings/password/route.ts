import { authed, body, json, rateLimit } from "@/lib/api";
import { changeMyPassword, changePasswordSchema } from "@/lib/services/staff";

export const POST = authed(async (req, ctx) => {
  rateLimit(`pw-change:${ctx.user.id}`, 8, 15 * 60_000);
  const input = await body(req, changePasswordSchema);
  return json(await changeMyPassword(ctx, input));
});
