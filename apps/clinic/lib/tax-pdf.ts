import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PACKET_NOTE, type PacketGroup } from "@kinpath/core";

/**
 * The year-end packet: a summary page of what she paid, grouped, then each receipt she captured
 * (photos placed on a page, PDFs appended as they are). Pumpkin groups and totals; it never says
 * what qualifies for a deduction or an HSA/FSA.
 */
export interface Receipt { paymentId: string; mime: string; bytes: Buffer }
const d = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function taxPacketPdf(p: { year: number; patient: string; groups: PacketGroup[]; totalCents: number }, receipts: Receipt[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${p.year} care payments: ${p.patient}`); doc.setProducer("Pumpkin"); doc.setCreator("Pumpkin");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.137, 0.102, 0.086), stone = rgb(0.36, 0.31, 0.28), line = rgb(0.86, 0.83, 0.8);
  const M = 56, W = 612 - M * 2;
  let page: PDFPage = doc.addPage([612, 792]); let y = 740;
  const newPage = () => { page = doc.addPage([612, 792]); y = 740; };
  const wrap = (t: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = []; let l = "";
    for (const w of safe(t).split(/\s+/)) { const n = l ? `${l} ${w}` : w; if (f.widthOfTextAtSize(n, size) > width && l) { out.push(l); l = w; } else l = n; }
    if (l) out.push(l); return out;
  };
  const text = (t: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; x?: number; width?: number } = {}) => {
    const f = o.f ?? font, size = o.size ?? 10.5;
    for (const l of wrap(t, f, size, o.width ?? W)) { if (y < 70) newPage(); page.drawText(l, { x: o.x ?? M, y, size, font: f, color: o.color ?? ink }); y -= size * 1.35; }
    y -= o.gap ?? 0;
  };
  const right = (t: string, f: PDFFont, size: number, yy: number) => page.drawText(safe(t), { x: M + W - f.widthOfTextAtSize(safe(t), size), y: yy, size, font: f, color: ink });

  const numbered = new Map<string, number>();
  receipts.forEach((r, i) => numbered.set(r.paymentId, i + 1));

  text(`${p.year} care payments`, { f: bold, size: 20, gap: 2 });
  text(p.patient, { f: bold, size: 13, gap: 4 });
  text(PACKET_NOTE, { color: stone, gap: 2 });
  text("Groups are Pumpkin's best guess from each description. Receipts follow this summary, numbered to match.", { color: stone, gap: 8 });

  for (const g of p.groups) {
    if (y < 120) newPage();
    const top = y; text(g.label, { f: bold, size: 12 }); right(money(g.totalCents), bold, 12, top);
    for (const x of g.payments) {
      if (y < 80) newPage();
      const t = y; const n = numbered.get(x.id);
      text(`${d(x.paidOn)}   ${x.description}${n ? `   (receipt ${n})` : ""}`, { width: W * 0.78 });
      right(money(x.amountCents), font, 10.5, t);
    }
    y -= 4; page.drawLine({ start: { x: M, y: y + 6 }, end: { x: M + W, y: y + 6 }, thickness: 0.5, color: line }); y -= 8;
  }
  if (!p.groups.length) text(`No payments recorded for ${p.year}.`, { color: stone });
  else { const t = y; text("Total paid", { f: bold, size: 13 }); right(money(p.totalCents), bold, 13, t); }

  for (const [i, r] of receipts.entries()) {
    try {
      if (r.mime === "application/pdf") {
        const src = await PDFDocument.load(r.bytes, { ignoreEncryption: true });
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((pg, k) => { doc.addPage(pg); if (k === 0) pg.drawText(`Receipt ${i + 1}`, { x: 20, y: pg.getHeight() - 20, size: 9, font: bold, color: stone }); });
      } else if (r.mime === "image/jpeg" || r.mime === "image/png") {
        const img = r.mime === "image/png" ? await doc.embedPng(r.bytes) : await doc.embedJpg(r.bytes);
        newPage(); text(`Receipt ${i + 1}`, { f: bold, size: 11, gap: 6 });
        const scale = Math.min(W / img.width, (y - 50) / img.height, 1);
        page.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
      }
    } catch { newPage(); text(`Receipt ${i + 1} couldn't be added. You can download it from Pumpkin.`, { color: stone }); }
  }
  return doc.save();
}

/** The packet in the shape the app downloads: the list, a CSV, or a PDF with receipts. */
export async function taxPacketResponse(db: import("@kinpath/db").Db, s: import("@kinpath/db").Actor, pid: string, url: string) {
  const { taxPacket, captureFile } = await import("@kinpath/db");
  const { packetCsv } = await import("@kinpath/core");
  const q = new URL(url).searchParams, format = q.get("format");
  const year = Number(q.get("year")) || new Date().getFullYear();
  const p = await taxPacket(db, s, pid, year, format === "pdf" ? "pdf" : format === "csv" ? "csv" : "view");
  if (format === "csv") return { filename: `pumpkin-${year}-payments.csv`, mime: "text/csv", text: packetCsv(p.payments) };
  if (format === "pdf") {
    const receipts: Receipt[] = [];
    for (const x of p.payments) if (x.captureId) { const f = await captureFile(db, s, pid, x.captureId); if (f) receipts.push({ paymentId: x.id, mime: f.mime, bytes: f.bytes }); }
    return { filename: `pumpkin-${year}-payments.pdf`, mime: "application/pdf", base64: Buffer.from(await taxPacketPdf(p, receipts)).toString("base64") };
  }
  return p;
}
