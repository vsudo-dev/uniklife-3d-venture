import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { isUuid } from "@/lib/services/common";
import { changeStaffRole, setStaffStatus } from "@/lib/services/staff";

const schema = z.union([
  z.object({ role: z.enum(["org_admin", "venture_manager", "sales_manager", "sales_executive"]) }),
  z.object({ status: z.enum(["active", "disabled"]) }),
]);

export const PATCH = authed<{ memberId: string }>(async (req, ctx, { memberId }) => {
  if (!isUuid(memberId)) throw notFound("Staff member");
  const input = await body(req, schema);
  if ("role" in input) return json(await changeStaffRole(ctx, memberId, input.role));
  return json(await setStaffStatus(ctx, memberId, input.status));
});
