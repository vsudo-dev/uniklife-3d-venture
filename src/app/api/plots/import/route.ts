import { z } from "zod";
import { authed, body, json, rateLimit } from "@/lib/api";
import { applyPlotCsvImport, csvImportSchema, previewPlotCsvImport } from "@/lib/services/plots";

const schema = csvImportSchema.extend({ mode: z.enum(["preview", "apply"]) });

/** CSV bulk import: `mode: "preview"` validates without writing; `mode: "apply"` re-validates and upserts in one transaction. */
export const POST = authed(async (req, ctx) => {
  rateLimit(`plot-import:${ctx.user.id}`, 30, 60_000);
  const { mode, ...input } = await body(req, schema);
  return json(mode === "preview" ? await previewPlotCsvImport(ctx, input) : await applyPlotCsvImport(ctx, input));
});
