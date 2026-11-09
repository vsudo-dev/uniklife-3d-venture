import { authed, json } from "@/lib/api";
import { listEntries } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { badRequest } from "@/lib/errors";

const SCOPES = ["mine", "team", "all"] as const;
const STATUSES = ["calculated", "approved", "rejected", "settled", "paid", "reversed"];

/** Ledger: scope=mine (default) | team (descendants only) | all (commission.approve). Never upline entries. */
export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const scope = (sp.get("scope") ?? "mine") as (typeof SCOPES)[number];
  if (!SCOPES.includes(scope)) throw badRequest("Invalid scope");
  const status = sp.get("status") || undefined;
  if (status && !STATUSES.includes(status)) throw badRequest("Invalid status");
  const settlementId = sp.get("settlementId") || undefined;
  if (settlementId && !isUuid(settlementId)) throw badRequest("Invalid settlement id");
  return json(await listEntries(ctx, { scope, status, settlementId }));
});
