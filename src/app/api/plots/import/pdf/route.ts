import { z } from "zod";
import { authed, body, json, rateLimit } from "@/lib/api";
import { assertPermission } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/services/common";
import { readPdfAsset } from "@/lib/services/assets";
import { extractPlotsFromPdfText } from "@/lib/inventory/pdf-plots";
import { aiExtractionAvailable, extractPlotsWithAi } from "@/lib/inventory/pdf-ai";

export const maxDuration = 120;

const schema = z.object({ ventureId: z.string().uuid(), assetId: z.string().uuid(), useAi: z.boolean().default(false) });

/**
 * Extracts plot rows from a venture's layout PDF and returns them as CSV text. NOTHING is written to the
 * inventory — the client loads the CSV into the normal preview → confirm → apply importer.
 * Text extraction runs first; AI is only used when explicitly requested (and configured).
 */
export const POST = authed(async (req, ctx) => {
  assertPermission(ctx, "plot.manage");
  rateLimit(`plot-pdf:${ctx.user.id}`, 10, 60_000);
  const input = await body(req, schema);
  const q = await db();
  const { data, fileName } = await readPdfAsset(ctx, q, input.ventureId, input.assetId);
  let result = await extractPlotsFromPdfText(data).catch(() => ({ csv: "", rows: 0, method: "text" as const, warnings: ["The PDF text layer could not be read."] }));
  let aiOffered = false;
  if (!result.rows) {
    if (input.useAi) result = await extractPlotsWithAi(data);
    else aiOffered = aiExtractionAvailable();
  }
  await writeAudit(q, ctx, {
    action: "plot.pdf_extracted", entityType: "venture", entityId: input.ventureId,
    summary: `Extracted ${result.rows} plot row(s) from "${fileName}" (${result.method}); not applied`, metadata: { asset_id: input.assetId, method: result.method, rows: result.rows },
  });
  return json({ ...result, fileName, aiOffered });
});
