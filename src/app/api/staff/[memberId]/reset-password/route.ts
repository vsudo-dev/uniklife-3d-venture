import { z } from "zod";
import { authed, body, json, rateLimit } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { isUuid } from "@/lib/services/common";
import { resetStaffPassword } from "@/lib/services/staff";

const schema = z.object({ temporaryPassword: z.string().min(1).max(200) });

export const POST = authed<{ memberId: string }>(async (req, ctx, { memberId }) => {
  if (!isUuid(memberId)) throw notFound("Staff member");
  rateLimit(`pw-reset:${ctx.user.id}`, 20, 60 * 60_000);
  const { temporaryPassword } = await body(req, schema);
  return json(await resetStaffPassword(ctx, memberId, temporaryPassword));
});
