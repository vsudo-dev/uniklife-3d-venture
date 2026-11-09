import { authed, json } from "@/lib/api";
import { listPayments } from "@/lib/services/payments";

const STATUSES = ["pending", "verified", "failed", "refunded"];

export const GET = authed(async (req, ctx) => {
  const status = req.nextUrl.searchParams.get("status");
  return json(await listPayments(ctx, { status: status && STATUSES.includes(status) ? status : undefined }));
});
