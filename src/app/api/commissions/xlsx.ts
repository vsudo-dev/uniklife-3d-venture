export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function xlsxResponse(buffer: Buffer, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store, private",
    },
  });
}
