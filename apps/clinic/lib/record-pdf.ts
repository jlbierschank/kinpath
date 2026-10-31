import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PersonalSummary } from "@kinpath/db";
import { CONCEPTION } from "@kinpath/core";

/**
 * The readable half of a shared record: a plain PDF of the sections she chose, each item labeled by
 * who entered it. The data half is the FHIR file. Standard PDF fonts, so text outside Latin-1 is
 * simplified (curly quotes, dashes) rather than dropped.
 */
const BY: Record<string, string> = { you: "Added by the patient", read: "Read from her document, checked by her", clinic: "From the clinic's records" };
const d = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Not given");
const money = (c: number | null) => (c === null ? "Not given" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/·/g, "-").replace(/[^\x20-\x7E -ÿ]/g, "?");

export async function recordPdf(s: PersonalSummary): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Patient record summary: ${s.patient}`); doc.setProducer("Pumpkin"); doc.setCreator("Pumpkin");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.137, 0.102, 0.086), stone = rgb(0.36, 0.31, 0.28);
  let page: PDFPage = doc.addPage([612, 792]); let y = 740;
  const M = 56, W = 612 - M * 2;
  const newPage = () => { page = doc.addPage([612, 792]); y = 740; };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = []; let line = "";
    for (const word of safe(text).split(/\s+/)) { const t = line ? `${line} ${word}` : word; if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = word; } else line = t; }
    if (line) out.push(line); return out;
  };
  const text = (t: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; x?: number; width?: number } = {}) => {
    const f = o.f ?? font, size = o.size ?? 10.5;
    for (const l of wrap(t, f, size, o.width ?? W)) { if (y < 70) newPage(); page.drawText(l, { x: o.x ?? M, y, size, font: f, color: o.color ?? ink }); y -= size * 1.35; }
    y -= o.gap ?? 0;
  };
  const row = (left: string, right: string, by?: string) => {
    if (y < 90) newPage();
    const top = y;
    text(left, { width: W * 0.62 });
    const after = y; y = top;
    text(right, { f: bold, x: M + W * 0.65, width: W * 0.35 });
    y = Math.min(after, y);
    if (by) text(by, { size: 8.5, color: stone });
    y -= 4;
  };
  const section = (title: string) => { y -= 8; if (y < 110) newPage(); text(title.toUpperCase(), { f: bold, size: 9.5, color: stone, gap: 4 }); };

  text("Patient record summary", { f: bold, size: 20, gap: 2 });
  text(s.patient, { f: bold, size: 13, gap: 4 });
  text(`Shared by the patient with ${s.recipient} on ${d(s.createdAt)}.${s.clinic ? ` Fertility clinic: ${s.clinic}.` : ""}`, { color: stone });
  text("The patient keeps this record herself in Pumpkin. It is her copy, not a clinic's official record. Each item says who entered it.", { color: stone, gap: 6 });

  if (s.sections.includes("pregnancy") && (s.pregnancy.conceivedOn || s.pregnancy.dueDate)) {
    section("Pregnancy");
    const how = CONCEPTION.find(([k]) => k === s.pregnancy.how)?.[1];
    row(how ?? "Transfer or insemination date", d(s.pregnancy.conceivedOn), BY.you);
    row("Estimated due date", d(s.pregnancy.dueDate), "Calculated by Pumpkin from the date she entered. Please confirm with her fertility clinic.");
  }
  if (s.results) { section("Test results"); if (!s.results.length) text("None in her record.", { color: stone }); for (const r of s.results) row(`${d(r.on)} - ${r.test}`, `${r.value} ${r.unit}`, BY[r.by]); }
  if (s.meds) { section("Medications"); if (!s.meds.length) text("None in her record.", { color: stone }); for (const m of s.meds) row(`${m.medication} - ${m.dose} at ${m.time}`, m.active ? `Until ${d(m.endsOn)}` : "Stopped", BY[m.by]); }
  if (s.sections.includes("visits")) { section("Visits"); if (!s.appointments.length) text("None in her record.", { color: stone }); for (const a of s.appointments) row(`${a.title}${a.location ? ` - ${a.location}` : ""}`, d(a.at), BY[a.by]); }
  if (s.coverage) {
    section("Insurance coverage");
    if (!s.coverage.length) text("None in her record.", { color: stone });
    for (const c of s.coverage) {
      text(`${c.payer ?? "Insurer not given"}${c.plan ? `, ${c.plan}` : ""}${c.asOf ? ` (statement of ${d(c.asOf)})` : ""}`, { f: bold, gap: 2 });
      if (c.fertilityMaxCents !== null || c.fertilityUsedCents) row("Fertility benefit used", `${money(c.fertilityUsedCents)} of ${money(c.fertilityMaxCents)}`);
      if (c.deductibleCents !== null) row("Deductible met", `${money(c.deductibleMetCents)} of ${money(c.deductibleCents)}`);
      if (c.oopMaxCents !== null) row("Out-of-pocket met", `${money(c.oopMetCents)} of ${money(c.oopMaxCents)}`);
      text(BY[c.by] ?? "", { size: 8.5, color: stone, gap: 4 });
    }
  }
  if (s.costs) { section("Costs"); if (!s.costs.length) text("None in her record.", { color: stone }); for (const c of s.costs) row(`${d(c.on)} - ${c.description}`, `${c.kind === "payment" ? "Paid" : c.kind === "charge" ? "Charge" : c.kind} ${money(c.amountCents)}`, BY[c.by]); }

  y -= 10;
  text(`This link expires ${d(s.expiresAt)}. Each view and download is recorded, and the patient can stop sharing anytime. A matching data file (FHIR R4) is available from the same link.`, { size: 8.5, color: stone });
  return doc.save();
}
