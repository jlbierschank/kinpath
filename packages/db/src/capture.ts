/**
 * "Add anything." She snaps a photo, uploads a PDF, talks, types, or forwards an email. Pumpkin reads
 * it into proposed items (meds, results, visits, costs, questions). Nothing is saved to her record
 * until she confirms each item, and medications always need her explicit check against the original.
 *
 * Reading uses the same AI vendor as drafting (KINPATH_AI_PROVIDER=anthropic). Without it, typed and
 * spoken notes still work through a basic reader; photos and PDFs wait for her to enter by hand.
 * Urgent symptoms in anything she types or says skip all of this and go straight to the urgent screen.
 */
import {
  captureSystemPrompt, cleanItem, HandoffError, parseCaptureReply, readPlainText, triage,
  type AppointmentItem, type CaptureItem, type CostItem, type MedicationItem, type ResultItem,
} from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { AIServiceError } from "./ai";
import * as solo from "./solo";
const { isPersonalSpace } = solo;

export type CaptureInputKind = "photo" | "pdf" | "text" | "voice" | "email" | "sample";
export interface CaptureInput { kind: CaptureInputKind; mime?: string; filename?: string; base64?: string; text?: string; sampleId?: string }

export interface Extractor {
  name: string;
  read(input: { mime?: string; base64?: string; text?: string; today: string }): Promise<CaptureItem[]>;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE = 5_000_000, MAX_PDF = 10_000_000;

export class AnthropicExtractor implements Extractor {
  name: string;
  constructor(private apiKey: string, private model: string, private timeoutMs = 60_000) { this.name = `anthropic:${model}`; }
  async read(input: { mime?: string; base64?: string; text?: string; today: string }): Promise<CaptureItem[]> {
    const content: unknown[] = [];
    if (input.base64 && input.mime && IMAGE_TYPES.includes(input.mime)) content.push({ type: "image", source: { type: "base64", media_type: input.mime, data: input.base64 } });
    else if (input.base64 && input.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } });
    content.push({ type: "text", text: input.text ? `Her note or email:\n${input.text}` : "Read this document." });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctrl.signal,
        headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, max_tokens: 3000, system: captureSystemPrompt(input.today), messages: [{ role: "user", content }] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new AIServiceError(res.status === 401 || res.status === 403 ? "the AI key was rejected" : res.status === 429 || res.status === 529 ? "the AI service is busy" : `the AI service returned an error (${res.status}${body?.error?.message ? `: ${body.error.message.slice(0, 120)}` : ""})`);
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return parseCaptureReply((data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""));
    } finally { clearTimeout(t); }
  }
}

/** The configured reader, or null (typed and spoken notes still work without it). */
export function extractorFromEnv(): Extractor | null {
  if (process.env.KINPATH_AI_PROVIDER !== "anthropic" || !process.env.ANTHROPIC_API_KEY) return null;
  return new AnthropicExtractor(process.env.ANTHROPIC_API_KEY, process.env.KINPATH_AI_MODEL ?? "claude-sonnet-5-5");
}

// ---------- samples, so the demo works without a real document ----------

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const SAMPLES: Record<string, { label: string; description: string; items: (today: string) => CaptureItem[] }> = {
  "med-sheet": {
    label: "Medication instructions", description: "A sample stimulation instruction sheet",
    items: (d) => [
      { kind: "medication", data: { name: "Gonal-f", dose: "225 IU", times: ["20:00"], startsOn: d, endsOn: addDays(d, 7), instructions: "Inject under the skin of your belly. Rotate sides." }, unsure: [] },
      { kind: "medication", data: { name: "Menopur", dose: "75 IU", times: ["20:00"], startsOn: d, endsOn: addDays(d, 7), instructions: "Mix with the diluent provided." }, unsure: [] },
      { kind: "medication", data: { name: "Cetrotide", dose: "0.25 mg", times: ["08:00"], startsOn: addDays(d, 4), endsOn: addDays(d, 7) }, unsure: ["startsOn"] },
      { kind: "appointment", data: { title: "Monitoring visit: ultrasound and blood work", startsAt: `${addDays(d, 3)}T07:30`, location: "Sample Fertility Center" }, unsure: [] },
    ],
  },
  "protocol-calendar": {
    label: "Meds calendar", description: "A sample stimulation calendar with a dose change and a trigger shot",
    items: (d) => [
      { kind: "medication", data: { name: "Gonal-f", dose: "225 IU", times: ["20:00"], startsOn: d, endsOn: addDays(d, 3), instructions: "Inject under the skin of your belly." }, unsure: [] },
      { kind: "medication", data: { name: "Gonal-f", dose: "150 IU", times: ["20:00"], startsOn: addDays(d, 4), endsOn: addDays(d, 8) }, unsure: [] },
      { kind: "medication", data: { name: "Menopur", dose: "75 IU", times: ["20:00"], startsOn: d, endsOn: addDays(d, 8), instructions: "Mix with the diluent provided." }, unsure: [] },
      { kind: "medication", data: { name: "Cetrotide", dose: "0.25 mg", times: ["08:00"], startsOn: addDays(d, 5), endsOn: addDays(d, 8) }, unsure: [] },
      { kind: "medication", data: { name: "Ovidrel", dose: "250 mcg", times: ["21:30"], startsOn: addDays(d, 9), endsOn: addDays(d, 9), instructions: "Trigger shot. Take at exactly this time." }, unsure: [] },
      { kind: "appointment", data: { title: "Monitoring visit: ultrasound and blood work", startsAt: `${addDays(d, 4)}T07:30`, location: "Sample Fertility Center" }, unsure: [] },
      { kind: "appointment", data: { title: "Monitoring visit: ultrasound and blood work", startsAt: `${addDays(d, 7)}T07:30`, location: "Sample Fertility Center" }, unsure: [] },
    ],
  },
  "lab-report": {
    label: "Lab results", description: "A sample lab report with reference ranges",
    items: (d) => [
      { kind: "result", data: { test: "Estradiol", value: 612, unit: "pg/mL", collectedOn: d, refLow: 27, refHigh: 433, refText: "Follicular phase 27-433 pg/mL" }, unsure: [] },
      { kind: "result", data: { test: "Progesterone", value: 0.6, unit: "ng/mL", collectedOn: d, refText: "Follicular phase < 1.4 ng/mL" }, unsure: [] },
      { kind: "result", data: { test: "LH", value: 2.1, unit: "mIU/mL", collectedOn: d }, unsure: [] },
    ],
  },
  "payment-plan": {
    label: "Payment plan email", description: "A sample payment plan from a clinic's billing office",
    items: (d) => [
      { kind: "cost", data: { type: "charge", description: "IVF cycle, payment 2 of 3", amount: 6133, date: d, dueOn: addDays(d, 6) }, unsure: [] },
      { kind: "cost", data: { type: "charge", description: "IVF cycle, payment 3 of 3", amount: 6133, date: d, dueOn: addDays(d, 36) }, unsure: [] },
      { kind: "cost", data: { type: "payment", description: "IVF cycle, payment 1 of 3", amount: 6134, date: addDays(d, -24), method: "card" }, unsure: [] },
    ],
  },
};

// ---------- adding something ----------

async function clinicTerms(tx: Tx) {
  return (await tx.query<{ term: string; level: "urgent" | "crisis" }>(`SELECT term, level FROM clinic_triage_terms`)).rows;
}
async function localToday(tx: Tx) {
  return (await tx.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id = kp_clinic()), 'YYYY-MM-DD') AS d`)).rows[0]!.d;
}

export interface CaptureResult {
  captureId: string; status: "ready" | "failed" | "urgent";
  urgent: "urgent" | "crisis" | null; items: number; problem: string | null; engine: string;
  /** Free AI reads left this month after this one (null on premium, or when AI reading is off). */
  readsLeft: number | null;
}

export async function addCapture(db: Db, actor: Actor, patientId: string, input: CaptureInput, opts: { extractor?: Extractor | null } = {}): Promise<CaptureResult> {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can add to her record.");
  if (!(await isPersonalSpace(db, actor.clinicId))) throw new HandoffError("Your clinic keeps your record. Send them a message instead.");
  const extractor = opts.extractor === undefined ? extractorFromEnv() : opts.extractor;
  const kind = input.kind;
  if (!["photo", "pdf", "text", "voice", "email", "sample"].includes(kind)) throw new HandoffError("That kind of file isn't supported yet.");
  const text = (input.text ?? "").trim().slice(0, 20000);
  let bytes: Buffer | null = null;
  let mime = input.mime ?? null;
  if (kind === "photo" || kind === "pdf") {
    if (!input.base64) throw new HandoffError("Choose a photo or file.");
    bytes = Buffer.from(input.base64, "base64");
    if (kind === "pdf") mime = "application/pdf";
    if (kind === "photo" && !IMAGE_TYPES.includes(mime ?? "")) throw new HandoffError("Use a JPEG or PNG photo. (On iPhone, a screenshot works too.)");
    if (bytes.length > (kind === "pdf" ? MAX_PDF : MAX_IMAGE)) throw new HandoffError(kind === "pdf" ? "That PDF is over 10 MB. Try a smaller one." : "That photo is over 5 MB. Try again, or take a screenshot of it.");
  } else if (kind === "sample") {
    if (!input.sampleId || !SAMPLES[input.sampleId]) throw new HandoffError("Pick a sample.");
  } else if (!text) throw new HandoffError(kind === "voice" ? "We didn't catch anything. Try again, or type it." : "Write something first.");

  // 1. Urgent symptoms come first, before anything is read or stored as items.
  const first = await asActor(db, actor, async (tx) => {
    const t = text ? triage(text, await clinicTerms(tx)) : { level: "routine" as const };
    const r = await tx.query<{ id: string }>(
      `INSERT INTO captures (clinic_id, patient_id, kind, filename, mime, bytes, text_input, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [actor.clinicId, patientId, kind, input.filename?.slice(0, 200) ?? (kind === "sample" ? SAMPLES[input.sampleId!]!.description : null), mime, bytes, text || null, t.level === "routine" ? "reading" : "urgent"]);
    await audit(tx, actor, "patient.added_capture", patientId, { kind, urgent: t.level !== "routine" });
    return { id: r.rows[0]!.id, level: t.level, today: await localToday(tx), reads: await solo.aiReads(tx, patientId) };
  });
  const readsLeft = (n: number) => (extractor && first.reads.left !== null ? Math.max(0, first.reads.left - n) : null);
  if (first.level !== "routine") return { captureId: first.id, status: "urgent", urgent: first.level === "crisis" ? "crisis" : "urgent", items: 0, problem: null, engine: "triage", readsLeft: readsLeft(0) };
  // The free allowance: once it's used up this month, typed and spoken notes use the basic reader.
  const outOfReads = !!extractor && first.reads.left === 0;

  // 2. Read it.
  let items: CaptureItem[] = [];
  let problem: string | null = null;
  let engine = "pumpkin-basic";
  try {
    if (kind === "sample") { items = SAMPLES[input.sampleId!]!.items(first.today); engine = "sample"; }
    else if (extractor && !outOfReads) { items = await extractor.read({ mime: mime ?? undefined, base64: input.base64, text: text || undefined, today: first.today }); engine = extractor.name; }
    else if (text) items = readPlainText(text, first.today);
    else if (outOfReads) problem = `You've used your ${first.reads.limit} free reads for this month. You can add it by hand, and typed or spoken notes still work. Your free reads start again on the 1st.`;
    else problem = "Reading photos and files isn't turned on here yet. You can add it by hand.";
  } catch (e) {
    problem = e instanceof AIServiceError ? `We couldn't read it right now (${e.message}). Try again in a minute, or add it by hand.` : "We couldn't read that. Try again, or add it by hand.";
    // Typed and spoken notes always fall back to the basic reader.
    if (text) { items = readPlainText(text, first.today); engine = "pumpkin-basic"; }
  }
  if (!problem && !items.length) problem = kind === "photo" || kind === "pdf" ? "We didn't find meds, results, visits or costs in that. You can add it by hand." : "We didn't find anything to add. Try saying the medication, test, visit or amount.";

  await asActor(db, actor, async (tx) => {
    for (const it of items) {
      await tx.query(`INSERT INTO capture_items (capture_id, clinic_id, patient_id, kind, data, unsure) VALUES ($1,$2,$3,$4,$5,$6)`,
        [first.id, actor.clinicId, patientId, it.kind, JSON.stringify(it.data), it.unsure]);
    }
    await tx.query(`UPDATE captures SET status = $2, problem = $3, engine = $4, ai_read = $5 WHERE id = $1`, [first.id, items.length ? "ready" : "failed", problem, engine, !!extractor && engine === extractor.name]);
  });
  const usedOne = !!extractor && engine === extractor.name ? 1 : 0;
  return { captureId: first.id, status: items.length ? "ready" : "failed", urgent: null, items: items.length, problem: items.length ? null : problem, engine, readsLeft: readsLeft(usedOne) };
}

export interface PendingItem { id: string; captureId: string; kind: CaptureItem["kind"]; data: Record<string, unknown>; unsure: string[]; source: { kind: CaptureInputKind; filename: string | null; at: string; hasFile: boolean; engine: string | null } }

export async function itemsToCheck(db: Db, actor: Actor, patientId: string): Promise<PendingItem[]> {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; capture_id: string; kind: CaptureItem["kind"]; data: Record<string, unknown>; unsure: string[]; ckind: CaptureInputKind; filename: string | null; created_at: Date; has_file: boolean; engine: string | null }>(
      `SELECT i.id, i.capture_id, i.kind, i.data, i.unsure, c.kind AS ckind, c.filename, c.created_at, c.bytes IS NOT NULL AS has_file, c.engine
         FROM capture_items i JOIN captures c ON c.id = i.capture_id WHERE i.patient_id = $1 AND i.status = 'pending'
        ORDER BY c.created_at DESC, CASE i.kind WHEN 'medication' THEN 0 WHEN 'result' THEN 1 WHEN 'appointment' THEN 2 WHEN 'cost' THEN 3 ELSE 4 END, i.created_at`, [patientId]);
    return r.rows.map((x) => ({ id: x.id, captureId: x.capture_id, kind: x.kind, data: typeof x.data === "string" ? JSON.parse(x.data) : x.data, unsure: x.unsure ?? [],
      source: { kind: x.ckind, filename: x.filename, at: new Date(x.created_at).toISOString(), hasFile: x.has_file, engine: x.engine } }));
  });
}

export async function captureFile(db: Db, actor: Actor, patientId: string, captureId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ mime: string | null; bytes: Uint8Array | null; filename: string | null }>(`SELECT mime, bytes, filename FROM captures WHERE id = $1 AND patient_id = $2`, [captureId, patientId]);
    const x = r.rows[0];
    if (!x?.bytes) return null;
    return { mime: x.mime ?? "application/octet-stream", bytes: Buffer.from(x.bytes), filename: x.filename ?? "original" };
  });
}

/**
 * She confirms one item, with any edits. Medications need `checked: true` (she compared them with the
 * original). Returns the id of what was saved to her record.
 */
export async function saveItem(db: Db, actor: Actor, patientId: string, itemId: string, edited: Record<string, unknown> | null, opts: { checked?: boolean } = {}) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ kind: CaptureItem["kind"]; data: Record<string, unknown>; capture_id: string; status: string }>(
      `SELECT kind, data, capture_id, status FROM capture_items WHERE id = $1 AND patient_id = $2`, [itemId, patientId]);
    const row = r.rows[0];
    if (!row) throw new HandoffError("That item is gone.");
    if (row.status !== "pending") throw new HandoffError("You already took care of this one.");
    const base = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    const item = cleanItem({ kind: row.kind, data: { ...base, ...(edited ?? {}) } });
    if (!item) throw new HandoffError("Something's missing. Check the details and try again.");
    let ref: string;
    if (item.kind === "medication") {
      if (!opts.checked) throw new HandoffError("Check the name, dose and time against your instructions, then tick the box.");
      ref = await solo.insertMedication(tx, actor, patientId, item.data as MedicationItem, row.capture_id);
    } else if (item.kind === "result") ref = await solo.insertResult(tx, actor, patientId, item.data as ResultItem, row.capture_id);
    else if (item.kind === "appointment") ref = await solo.insertAppointment(tx, actor, patientId, item.data as AppointmentItem);
    else if (item.kind === "cost") ref = await solo.insertCost(tx, actor, patientId, item.data as CostItem, row.capture_id);
    else ref = (await tx.query<{ id: string }>(`INSERT INTO visit_questions (clinic_id, patient_id, question) VALUES ($1,$2,$3) RETURNING id`, [actor.clinicId, patientId, (item.data as { text: string }).text])).rows[0]!.id;
    await tx.query(`UPDATE capture_items SET status = 'saved', data = $2, saved_ref = $3, decided_at = now() WHERE id = $1`, [itemId, JSON.stringify(item.data), ref]);
    return { savedId: ref, kind: item.kind };
  });
}

export async function dismissItem(db: Db, actor: Actor, patientId: string, itemId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query(`UPDATE capture_items SET status = 'dismissed', decided_at = now() WHERE id = $1 AND patient_id = $2 AND status = 'pending' RETURNING id`, [itemId, patientId]);
    if (!r.rows[0]) throw new HandoffError("You already took care of this one.");
  });
}

// ---------- forwarded email ----------

/**
 * An email forwarded to her private address (add+<token>@...). Whatever it holds lands as items she
 * must confirm, so a stranger who learns the address can't change her record.
 */
export async function receiveForwardedEmail(db: Db, msg: { to: string; subject?: string; text?: string; attachments?: { filename?: string; contentType?: string; contentBase64: string }[] }, opts: { extractor?: Extractor | null } = {}) {
  const m = /add\+([a-z0-9]{6,32})@/i.exec(msg.to ?? "");
  if (!m) return { accepted: false };
  const p = await db.query<{ patient_id: string; clinic_id: string; user_id: string }>(
    `SELECT f.patient_id, f.clinic_id, p.user_id FROM personal_profiles f JOIN patients p ON p.id = f.patient_id WHERE f.inbox_token = $1`, [m[1]!.toLowerCase()]);
  const who = p.rows[0];
  if (!who) return { accepted: false };
  const actor: Actor = { userId: who.user_id, clinicId: who.clinic_id, role: "patient" };
  const text = [msg.subject ? `Subject: ${msg.subject}` : "", msg.text ?? ""].filter(Boolean).join("\n").slice(0, 20000);
  let added = 0;
  if (text.trim()) { const r = await addCapture(db, actor, who.patient_id, { kind: "email", text, filename: msg.subject?.slice(0, 200) }, opts); added += r.items; }
  for (const a of (msg.attachments ?? []).slice(0, 5)) {
    const ct = (a.contentType ?? "").toLowerCase();
    const kind = ct === "application/pdf" ? "pdf" : IMAGE_TYPES.includes(ct) ? "photo" : null;
    if (!kind) continue;
    try { const r = await addCapture(db, actor, who.patient_id, { kind, mime: ct, base64: a.contentBase64, filename: a.filename }, opts); added += r.items; } catch { /* skip a bad attachment */ }
  }
  return { accepted: true, items: added };
}

