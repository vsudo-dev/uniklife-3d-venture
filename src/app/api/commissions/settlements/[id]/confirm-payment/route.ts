import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { confirmSettlementPayment } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

const schema = z.object({ paymentReference: z.string().trim().min(3, "Payment reference is required").max(200) });

/** Authorized human confirmation that the settlement was paid (a webhook alone never marks it paid). */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Settlement");
  const { paymentReference } = await body(req, schema);
  return json(await confirmSettlementPayment(ctx, id, paymentReference));
});
