import { authed, json } from "@/lib/api";
import { getMyNetwork } from "@/lib/services/employees";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

/** The caller's own tree (self + descendants), or a descendant's subtree via ?root=. Never uplines. */
export const GET = authed(async (req, ctx) => {
  const root = req.nextUrl.searchParams.get("root") || undefined;
  if (root && !isUuid(root)) throw notFound("Employee");
  return json(await getMyNetwork(ctx, root));
});
