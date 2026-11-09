import { authed } from "@/lib/api";
import { settlementWorkbook } from "@/lib/services/commissions";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";
import { xlsxResponse } from "../../../xlsx";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Settlement");
  const { buffer, filename } = await settlementWorkbook(ctx, id);
  return xlsxResponse(buffer, filename);
});
