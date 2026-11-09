import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { setApprovalVerification } from "@/lib/services/ventures";

const schema = z.object({ verified: z.boolean(), note: z.string().trim().max(1000).default("") });

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  const { verified, note } = await body(req, schema);
  return json(await setApprovalVerification(ctx, id, verified, note));
});
