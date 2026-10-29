/**
 * Pumpkin on your own: rules for patients who use Pumpkin before (or without) a clinic.
 *
 * - What each test measures, in everyday words. Never a verdict ("normal", "high"). The only
 *   range shown is the lab's own reference range as printed on her report.
 * - "Add anything": what Pumpkin read from a photo, PDF, voice note or email is a list of
 *   proposed items. She confirms each one. Medications are never saved without her check.
 */

export const SOLO_STAGES = {
  trying: { en: "Trying on my own", hint: "Before a clinic, or deciding when to see one" },
  just_starting: { en: "Getting started with a clinic", hint: "A first consult and tests" },
  freezing_eggs: { en: "Freezing eggs", hint: "Meds, visits and costs" },
  in_cycle: { en: "In a cycle", hint: "Meds, monitoring visits and results" },
  two_week_wait: { en: "In the two-week wait", hint: "After a transfer or IUI" },
  pregnant: { en: "Pregnant after treatment", hint: "Early scans, then your OB" },
  after_hard_result: { en: "After a hard result", hint: "Taking it one day at a time" },
  between_cycles: { en: "Between cycles", hint: "Planning what comes next" },
  storage: { en: "Eggs or embryos in storage", hint: "Storage, renewals and records" },
} as const;
export type SoloStage = keyof typeof SOLO_STAGES;
export const isSoloStage = (s: unknown): s is SoloStage => typeof s === "string" && s in SOLO_STAGES;

/** Cycle kind and stage to start a personal space with. */
export function cycleForStage(stage: SoloStage): { kind: "ivf" | "egg_freezing"; stage: string } {
  if (stage === "freezing_eggs") return { kind: "egg_freezing", stage: "stimulation" };
  return { kind: "ivf", stage: ({ trying: "trying", just_starting: "consult", in_cycle: "stimulation", two_week_wait: "wait", pregnant: "pregnant", after_hard_result: "result", between_cycles: "consult", storage: "storage" } as const)[stage] };
}

// ---------- what each test measures ----------

export interface TestInfo {
  key: string;
  name: string;
  aka: string[];
  measures: string;
  inTreatment: string;
  /** Who on Pumpkin's clinical advisory team approved this text. Null until reviewed. */
  reviewedBy: string | null;
}

/**
 * DRAFT education text. Not yet reviewed by a clinician; the app only shows it in demo builds
 * (or once reviewedBy is filled in). Plain facts about what each test is, never what a number means.
 */
export const TESTS: TestInfo[] = [
  { key: "estradiol", name: "Estradiol (E2)", aka: ["e2", "estradiol", "oestradiol", "estrogen"], measures: "Estradiol is a form of estrogen. Growing follicles make it.", inTreatment: "During stimulation it usually rises as follicles grow. Your care team reads it alongside your ultrasound to adjust doses and time the trigger.", reviewedBy: null },
  { key: "progesterone", name: "Progesterone (P4)", aka: ["p4", "progesterone"], measures: "Progesterone is a hormone that prepares the lining of the uterus.", inTreatment: "It may be checked during stimulation, before a transfer, and in early pregnancy. Your care team decides what the number means for your plan.", reviewedBy: null },
  { key: "lh", name: "LH (luteinizing hormone)", aka: ["lh", "luteinizing hormone"], measures: "LH is a hormone from the pituitary gland. A surge of LH triggers ovulation.", inTreatment: "During stimulation it's watched so ovulation doesn't happen before retrieval.", reviewedBy: null },
  { key: "fsh", name: "FSH (follicle-stimulating hormone)", aka: ["fsh", "follicle stimulating hormone", "follicle-stimulating hormone"], measures: "FSH is a hormone from the pituitary gland that helps follicles grow.", inTreatment: "It's often checked early in a cycle (day 2 or 3) as one part of ovarian reserve testing.", reviewedBy: null },
  { key: "hcg", name: "hCG", aka: ["hcg", "beta hcg", "beta", "b-hcg", "bhcg", "quantitative hcg"], measures: "hCG is the hormone a pregnancy test measures.", inTreatment: "The pregnancy blood test (often called a beta) measures it. Some trigger shots are hCG, so it can show up for a few days after a trigger.", reviewedBy: null },
  { key: "amh", name: "AMH (anti-Müllerian hormone)", aka: ["amh", "anti-mullerian hormone", "anti-müllerian hormone", "anti mullerian hormone"], measures: "AMH is made by small follicles in the ovaries.", inTreatment: "It's used to estimate egg supply (ovarian reserve) and plan medication doses. It doesn't measure egg quality, and on its own it doesn't tell you whether you can get pregnant.", reviewedBy: null },
  { key: "tsh", name: "TSH (thyroid-stimulating hormone)", aka: ["tsh", "thyroid stimulating hormone"], measures: "TSH is a pituitary hormone that shows how hard it's working to drive your thyroid.", inTreatment: "Thyroid function is often checked before treatment.", reviewedBy: null },
  { key: "prolactin", name: "Prolactin", aka: ["prolactin", "prl"], measures: "Prolactin is a hormone from the pituitary gland.", inTreatment: "It's often checked before treatment because it can affect ovulation.", reviewedBy: null },
];

export function testInfo(key: string): TestInfo | null { return TESTS.find((t) => t.key === key) ?? null; }

/** "E2", "Estradiol, serum" → "estradiol". Unknown tests keep their own name under "other". */
export function analyteKey(name: string): string {
  const n = name.toLowerCase().replace(/[,.;:()]/g, " ").replace(/\s+/g, " ").trim();
  for (const t of TESTS) {
    for (const a of t.aka) {
      if (n === a || n.startsWith(`${a} `) || n.includes(` ${a} `) || n.endsWith(` ${a}`)) return t.key;
    }
  }
  return "other";
}

// ---------- "Add anything": proposed items ----------

export type CaptureKind = "medication" | "result" | "appointment" | "cost" | "question";
export interface MedicationItem { name: string; dose: string; times: string[]; startsOn?: string; endsOn?: string; instructions?: string }
export interface ResultItem { test: string; value: number; unit: string; collectedOn?: string; refLow?: number; refHigh?: number; refText?: string }
export interface AppointmentItem { title: string; startsAt: string; location?: string }
export interface CostItem { type: "charge" | "payment"; description: string; amount: number; date?: string; dueOn?: string; method?: string }
export interface QuestionItem { text: string }
export type CaptureItem =
  | { kind: "medication"; data: MedicationItem; unsure: string[] }
  | { kind: "result"; data: ResultItem; unsure: string[] }
  | { kind: "appointment"; data: AppointmentItem; unsure: string[] }
  | { kind: "cost"; data: CostItem; unsure: string[] }
  | { kind: "question"; data: QuestionItem; unsure: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[$,]/g, ""))) ? Number(v.replace(/[$,]/g, "")) : null);
const realDate = (v: unknown) => { const s = str(v, 10); return DATE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) ? s : undefined; };
export const METHODS = ["card", "check", "cash", "bank", "financing", "insurance", "other"] as const;

/**
 * Checks one proposed item (from the AI, the plain-text reader, or her edits). Returns null if
 * there's nothing usable. Anything missing that she must supply is listed in `unsure`.
 */
export function cleanItem(raw: unknown): CaptureItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const d = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  const unsure = new Set(Array.isArray(r.unsure) ? r.unsure.filter((x): x is string => typeof x === "string").slice(0, 10) : []);
  switch (r.kind) {
    case "medication": {
      const name = str(d.name, 80);
      if (!name) return null;
      const dose = str(d.dose, 40);
      const times = (Array.isArray(d.times) ? d.times : []).map((t) => toClock(String(t))).filter((t): t is string => !!t).slice(0, 4);
      const startsOn = realDate(d.startsOn), endsOn = realDate(d.endsOn);
      if (!dose) unsure.add("dose");
      if (!times.length) unsure.add("times");
      if (!startsOn) unsure.add("startsOn");
      const data: MedicationItem = { name, dose, times: [...new Set(times)] };
      if (startsOn) data.startsOn = startsOn;
      if (endsOn && (!startsOn || endsOn >= startsOn)) data.endsOn = endsOn;
      const instructions = str(d.instructions, 500); if (instructions) data.instructions = instructions;
      return { kind: "medication", data, unsure: [...unsure] };
    }
    case "result": {
      const test = str(d.test, 80); const value = num(d.value);
      if (!test || value === null || value < 0) return null;
      const data: ResultItem = { test, value, unit: str(d.unit, 20) };
      if (!data.unit) unsure.add("unit");
      const collectedOn = realDate(d.collectedOn); if (collectedOn) data.collectedOn = collectedOn; else unsure.add("collectedOn");
      const lo = num(d.refLow), hi = num(d.refHigh);
      if (lo !== null) data.refLow = lo;
      if (hi !== null) data.refHigh = hi;
      if (lo !== null && hi !== null && lo > hi) { delete data.refLow; delete data.refHigh; }
      const refText = str(d.refText, 80); if (refText) data.refText = refText;
      return { kind: "result", data, unsure: [...unsure] };
    }
    case "appointment": {
      const title = str(d.title, 120);
      const startsAt = str(d.startsAt, 16);
      if (!title) return null;
      const data: AppointmentItem = { title, startsAt: LOCAL.test(startsAt) ? startsAt : "" };
      if (!data.startsAt) unsure.add("startsAt");
      const location = str(d.location, 160); if (location) data.location = location;
      return { kind: "appointment", data, unsure: [...unsure] };
    }
    case "cost": {
      const amount = num(d.amount);
      const description = str(d.description, 160);
      if (amount === null || amount <= 0 || amount > 1_000_000) return null;
      const type = d.type === "payment" ? "payment" : "charge";
      const data: CostItem = { type, description: description || (type === "payment" ? "Payment" : "Charge"), amount: Math.round(amount * 100) / 100 };
      if (!description) unsure.add("description");
      const date = realDate(d.date); if (date) data.date = date; else unsure.add("date");
      const dueOn = realDate(d.dueOn); if (dueOn && type === "charge") data.dueOn = dueOn;
      const method = str(d.method, 20).toLowerCase(); if ((METHODS as readonly string[]).includes(method) && type === "payment") data.method = method;
      return { kind: "cost", data, unsure: [...unsure] };
    }
    case "question": {
      const text = str(d.text, 500);
      return text ? { kind: "question", data: { text }, unsure: [] } : null;
    }
    default:
      return null;
  }
}

export function cleanItems(raw: unknown): CaptureItem[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  return list.slice(0, 40).map(cleanItem).filter((x): x is CaptureItem => x !== null);
}

/** "8 pm", "8:30pm", "20:00", "8:00 PM" → "20:00". */
export function toClock(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/\./g, "");
  if (CLOCK.test(t)) return t;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; if (m[3].startsWith("p") && h !== 12) h += 12; if (m[3].startsWith("a") && h === 12) h = 0; }
  else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Loose dates in a sentence, relative to `today` (YYYY-MM-DD). Picks the next such date when no year is given. */
export function findDate(text: string, today: string): string | undefined {
  const t = text.toLowerCase();
  const base = new Date(`${today}T12:00:00Z`);
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t); if (iso) return realDate(iso[0]);
  if (/\btomorrow\b/.test(t)) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + 1); return ymd(d); }
  if (/\btoday\b|\btonight\b/.test(t)) return today;
  const fix = (y: number, m: number, d: number, explicitYear: boolean) => {
    const dt = new Date(Date.UTC(y, m, d, 12));
    if (dt.getUTCMonth() !== m) return undefined;
    if (!explicitYear && dt < new Date(base.getTime() - 60 * 86400_000)) dt.setUTCFullYear(y + 1);
    return ymd(dt);
  };
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (slash) { const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : base.getUTCFullYear(); return fix(y, Number(slash[1]) - 1, Number(slash[2]), !!slash[3]); }
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(t);
  if (named) return fix(named[3] ? Number(named[3]) : base.getUTCFullYear(), MONTHS.indexOf(named[1]!.slice(0, 3)), Number(named[2]), !!named[3]);
  const wd = /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/.exec(t);
  if (wd) { const want = DAYS.indexOf(wd[1]!.slice(0, 3)); const d = new Date(base); let add = (want - d.getUTCDay() + 7) % 7; if (add === 0) add = 7; d.setUTCDate(d.getUTCDate() + add); return ymd(d); }
  return undefined;
}
function findClock(text: string): string | undefined {
  const m = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))|\b([01]?\d|2[0-3]):[0-5]\d\b/i.exec(text);
  return m ? toClock(m[0].replace(/\s+/g, " ")) ?? undefined : undefined;
}

const MEDS = ["gonal-f", "gonal f", "follistim", "menopur", "cetrotide", "ganirelix", "ovidrel", "novarel", "pregnyl", "lupron", "leuprolide", "progesterone in oil", "pio", "endometrin", "crinone", "estrace", "estradiol valerate", "delestrogen", "clomid", "clomiphene", "letrozole", "femara", "dexamethasone", "doxycycline", "medrol", "prenatal", "omnitrope", "baby aspirin"];
const UNITS = "pg\\/ml|ng\\/ml|miu\\/ml|uiu\\/ml|µiu\\/ml|iu\\/l|ng\\/dl|pmol\\/l|nmol\\/l";

/**
 * A basic reader for typed or spoken notes, used when AI reading is off (and to double-check it).
 * One line, one item. It only proposes; she confirms.
 */
export function readPlainText(text: string, today: string): CaptureItem[] {
  const out: CaptureItem[] = [];
  for (const raw of text.split(/\n|(?<=[.;])\s+(?=[A-Z])/)) {
    const line = raw.trim();
    if (!line) continue;
    const low = line.toLowerCase();
    const money = /\$\s?([\d,]+(?:\.\d{1,2})?)/.exec(line);
    const result = new RegExp(`\\b(estradiol|e2|progesterone|p4|lh|fsh|beta hcg|hcg|amh|tsh|prolactin)\\b[^\\d$]{0,20}?(\\d+(?:\\.\\d+)?)\\s*(${UNITS})?`, "i").exec(line);
    const med = MEDS.find((m) => low.includes(m));
    if (money) {
      const paid = /\b(paid|payment|i paid|charged my|refund)\b/.test(low);
      const due = /\bdue\b/.test(low) ? findDate(low.slice(low.indexOf("due")), today) : undefined;
      const DATEWORDS = "(?:[a-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|tomorrow|today)";
      const description = line.replace(money[0], "")
        .replace(new RegExp(`\\b(?:due|paid|i paid|on|by)\\b\\s*(?:on|by)?\\s*${DATEWORDS}`, "gi"), " ")
        .replace(/\b(i paid|paid|payment of)\b/gi, " ")
        .replace(/\s+/g, " ").replace(/^[\s,:-]+|[\s,:.-]+$/g, "").replace(/^(for|toward|towards)\s+/i, "")
        .replace(/^\w/, (c) => c.toUpperCase()) || (paid ? "Payment" : "Charge");
      const item = cleanItem({ kind: "cost", data: { type: paid ? "payment" : "charge", description, amount: money[1], date: paid ? findDate(low, today) ?? today : today, dueOn: due } });
      if (item) out.push(item);
    } else if (result && !(med && /\b(mg|mcg|inject|shot|take)\b/.test(low))) {
      const item = cleanItem({ kind: "result", data: { test: result[1], value: result[2], unit: result[3] ?? "", collectedOn: findDate(low, today) } });
      if (item) out.push(item);
    } else if (med) {
      const dose = new RegExp(`${med.replace(/[-]/g, "[- ]?")}\\D{0,10}?(\\d+(?:\\.\\d+)?\\s*(?:iu|units?|mg|mcg|ml|cc|tablets?|pills?))`, "i").exec(line);
      const clock = findClock(line);
      const item = cleanItem({ kind: "medication", data: { name: line.slice(low.indexOf(med), low.indexOf(med) + med.length).replace(/^\w/, (c) => c.toUpperCase()), dose: dose?.[1] ?? "", times: clock ? [clock] : [], startsOn: findDate(low, today) }, unsure: ["name"] });
      if (item) out.push(item);
    } else if (/\b(appointment|appt|monitoring|ultrasound|blood ?work|blood draw|blood test|retrieval|transfer|consult|visit|scan)\b/.test(low) && (findDate(low, today) || findClock(line))) {
      const date = findDate(low, today); const clock = findClock(line);
      const title = line.replace(/\b(on|at)\b.*$/i, "").replace(/^(i have|i've got|my|next|reminder:?)\s+/i, "").trim() || "Appointment";
      const item = cleanItem({ kind: "appointment", data: { title: title.replace(/^\w/, (c) => c.toUpperCase()), startsAt: date && clock ? `${date}T${clock}` : "" } });
      if (item) out.push(item);
    } else if (line.endsWith("?")) {
      out.push({ kind: "question", data: { text: line }, unsure: [] });
    }
  }
  return out;
}

/** Instructions for the AI reader. It copies; it never interprets. */
export function captureSystemPrompt(today: string): string {
  return [
    "You read documents a fertility patient sends to her own private tracker: medication instruction sheets, lab reports, portal screenshots, payment plans, receipts, appointment emails, and her own notes.",
    "Copy what is written into structured items. You never interpret results, never say whether a number is normal, high or low, and never give medical advice.",
    `Today is ${today}. Use YYYY-MM-DD dates and 24-hour HH:MM times. Resolve relative dates (\"tomorrow\", \"day 3\" with a stated start date) only when the document makes them unambiguous.`,
    "If you can't read a value clearly, or it isn't written, leave it out and list the field name in \"unsure\". Never guess a medication name, dose or time.",
    "Item kinds and data fields:",
    "- medication: name, dose (with unit, e.g. \"225 IU\"), times (array of HH:MM), startsOn, endsOn, instructions (short, copied).",
    "Medication calendars (a protocol sheet with dates or cycle days, often a grid): make one medication item per medication for each stretch of days at the same dose and time. When the dose or time changes, start a new item for that medication with the new dose and its own startsOn and endsOn. A one-time shot (like a trigger) is one item with startsOn equal to endsOn and its exact time. If days are numbered (\"Day 1\", \"Stim day 3\") and the sheet gives the date of day 1, convert them to dates; if it doesn't, leave startsOn and endsOn out and list them in \"unsure\". Visits or blood work written on the calendar are appointment items.",
    "Pharmacy labels, medicine bottles and boxes (often a photo): make one medication item with the name and strength exactly as printed, and copy the directions into instructions. Fill dose, times, startsOn and endsOn only if the label states them plainly; otherwise leave them out and list them in \"unsure\". Never use the quantity, the number of refills, the Rx number or the fill date as a dose, time or start date.",
    "- result: test (as written), value (number), unit, collectedOn, refLow, refHigh, refText (the lab's printed reference range, copied exactly; omit if none is printed).",
    "- appointment: title, startsAt (YYYY-MM-DDTHH:MM local time), location.",
    "- cost: type (charge or payment), description, amount (dollars, number), date, dueOn (charges only), method (card, check, cash, bank, financing, insurance, other).",
    "- question: text (only questions she wrote for her care team).",
    "Reply with JSON only, no other text: {\"items\":[{\"kind\":\"...\",\"data\":{...},\"unsure\":[\"field\", ...]}]}. If nothing fits, reply {\"items\":[]}.",
  ].join("\n");
}

/** Pull the JSON object out of a model reply (tolerates code fences). */
export function parseCaptureReply(reply: string): CaptureItem[] {
  const s = reply.indexOf("{"), e = reply.lastIndexOf("}");
  if (s < 0 || e <= s) return [];
  try { return cleanItems(JSON.parse(reply.slice(s, e + 1))); } catch { return []; }
}
