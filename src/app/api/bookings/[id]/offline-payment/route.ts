import { authed, body, json } from "@/lib/api";
import { offlinePaymentSchema, recordOfflinePayment } from "@/lib/services/payments";

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => json(await recordOfflinePayment(ctx, id, await body(req, offlinePaymentSchema)), 201));
