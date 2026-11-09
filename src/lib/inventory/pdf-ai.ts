import "server-only";
import { env } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { PLOT_CSV_HEADERS, recordsToCsv, type ExtractedPlots } from "@/lib/inventory/pdf-plots";

export function aiExtractionAvailable() {
  return env.AI_PROVIDER === "anthropic" && !!env.ANTHROPIC_API_KEY;
}

const PROMPT = `Extract the plot inventory table(s) from this layout/price-list PDF.
Return ONLY a JSON array. One object per plot with these string keys (omit a key if the PDF does not state it, never guess):
${PLOT_CSV_HEADERS.join(", ")}.
Rules: plot_number is required; area_sq_yards is the plot area in square yards (if the PDF only gives square feet, divide by 9); facing is one of N,S,E,W,NE,NW,SE,SW; is_corner is yes/no; prices are numbers without currency symbols or commas.`;

/** Optional fallback for scanned/messy PDFs. Sends the PDF to the Claude API — only when AI_PROVIDER=anthropic. */
export async function extractPlotsWithAi(pdf: Buffer): Promise<ExtractedPlots> {
  if (!aiExtractionAvailable()) throw badRequest("AI extraction is not enabled (set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY).");
  if (pdf.length > 20 * 1024 * 1024) throw badRequest("PDF is too large for AI extraction (20 MB max).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.AI_MODEL,
      max_tokens: 16000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) throw badRequest(`AI extraction failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  const match = text.match(/\[[\s\S]*\]/);
  let parsed: unknown;
  try { parsed = JSON.parse(match?.[0] ?? ""); } catch { throw badRequest("AI returned a table that could not be read. Try the CSV import."); }
  if (!Array.isArray(parsed)) throw badRequest("AI returned an unexpected shape.");
  const allowed = new Set<string>(PLOT_CSV_HEADERS);
  const records = parsed
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => allowed.has(k) && (typeof v === "string" || typeof v === "number")).map(([k, v]) => [k, String(v)])))
    .filter((r) => r.plot_number);
  return {
    csv: records.length ? recordsToCsv(records as never) : "",
    rows: records.length,
    method: "ai",
    warnings: ["Values were read by AI — check every row in the preview before applying."],
  };
}
