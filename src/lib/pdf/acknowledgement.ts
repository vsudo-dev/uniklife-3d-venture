import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { num } from "@/lib/db/types";

const money = (n: unknown) => "INR " + num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Standard PDF fonts only cover WinAnsi; strip anything else.
const safe = (s: unknown) => String(s ?? "").replace(/[^\x20-\x7E]/g, (c) => (c === "—" || c === "–" ? "-" : "?"));

export async function buildAcknowledgementPdf(args: {
  orgName: string;
  booking: Record<string, unknown>;
  plots: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  verifiedAmount: number;
  outstanding: number;
}): Promise<Uint8Array> {
  const { booking: b, plots, payments } = args;
  const doc = await PDFDocument.create();
  doc.setTitle(`Booking acknowledgement ${safe(b.booking_number)}`);
  doc.setProducer("UNIKLIFE 3D Venture");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.043, 0.122, 0.361);
  const gold = rgb(0.788, 0.635, 0.153);
  const grey = rgb(0.35, 0.38, 0.5);
  let y = 800;
  const text = (t: string, x: number, size = 10, f = font, color = rgb(0.1, 0.1, 0.15)) => page.drawText(safe(t), { x, y, size, font: f, color });

  page.drawRectangle({ x: 0, y: 770, width: 595, height: 72, color: navy });
  page.drawRectangle({ x: 0, y: 768, width: 595, height: 2, color: gold });
  y = 812;
  text(args.orgName, 40, 16, bold, rgb(1, 1, 1));
  y = 792;
  text("Booking acknowledgement", 40, 11, font, rgb(0.85, 0.88, 1));

  const confirmed = b.status === "confirmed" || b.status === "completed";
  const simulated = payments.some((p) => p.status === "verified" && p.is_simulated);
  y = 740;
  text(`Booking reference: ${b.booking_number}`, 40, 13, bold, navy);
  y -= 18;
  text(`Status: ${String(b.status).replace(/_/g, " ").toUpperCase()}${confirmed ? "" : "  (NOT CONFIRMED - advance not yet verified)"}`, 40, 10, bold, confirmed ? rgb(0.08, 0.5, 0.25) : rgb(0.75, 0.4, 0.05));
  y -= 16;
  text(`Venture: ${b.venture_name} (${b.venture_code})`, 40);
  y -= 14;
  text(`Customer: ${b.customer_name}   Phone: ${b.customer_phone ?? "-"}`, 40);
  y -= 14;
  text(`Booked on: ${new Date(b.created_at as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 40);
  if (b.confirmed_at) {
    y -= 14;
    text(`Confirmed on: ${new Date(b.confirmed_at as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 40);
  }

  y -= 28;
  text("Plots", 40, 11, bold, navy);
  y -= 16;
  const cols = [40, 110, 200, 300, 400, 490];
  ["Plot", "Area (sq yd)", "Rate / sq yd", "Base", "Discount", "Net"].forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 9, font: bold, color: grey }));
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: grey });
  for (const p of plots) {
    y -= 14;
    [String(p.plot_number), num(p.area_sq_yards).toFixed(2), money(p.price_per_sq_yard), money(p.base_amount), money(p.discount_amount), money(p.net_amount)].forEach((v, i) =>
      page.drawText(safe(v), { x: cols[i], y, size: 9, font }),
    );
  }
  y -= 22;
  const row = (label: string, value: string, strong = false) => {
    page.drawText(safe(label), { x: 330, y, size: 10, font: strong ? bold : font, color: grey });
    page.drawText(safe(value), { x: 470, y, size: 10, font: strong ? bold : font });
    y -= 15;
  };
  row("Combined area", `${num(b.total_area_sq_yards).toFixed(2)} sq yd`);
  row("Base amount", money(b.base_amount));
  row("Discounts", `- ${money(b.discount_amount)}`);
  row("Net price", money(b.net_amount), true);
  row("Advance (booking amount)", money(b.booking_amount));
  row("Verified payments", money(args.verifiedAmount));
  row("Outstanding balance", money(args.outstanding), true);

  y -= 10;
  text("Notes", 40, 10, bold, navy);
  const notes = [
    "This acknowledgement records a plot booking. It is not a sale deed, agreement of sale or title document.",
    "Pricing shown is the immutable server-calculated snapshot captured for this booking.",
    "Regulatory approval references for the venture are as provided by the developer and should be independently verified.",
  ];
  if (b.venture_is_demo) notes.unshift("DEMONSTRATION VENTURE - sample data, not a real or legally approved layout.");
  if (simulated) notes.unshift("SIMULATED PAYMENT - recorded by the mock payment provider for testing. No money was received.");
  for (const n of notes) {
    y -= 13;
    text(`- ${n}`, 40, 8.5, font, grey);
  }

  if (simulated || b.venture_is_demo) {
    page.drawText(simulated ? "SIMULATED" : "DEMO", { x: 120, y: 330, size: 90, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
  }
  page.drawText(safe(`Generated ${new Date().toISOString()}`), { x: 40, y: 30, size: 7, font, color: grey });
  return doc.save();
}
