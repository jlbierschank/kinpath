/**
 * Stage kits for people on their own: the first-consult kit, the workup test calendar, and the
 * handoff from the fertility clinic to an OB. What she checks off lives in personal_profiles.kit.
 *
 * Plain facts and timing only, never what a result means or what she should do medically.
 * The clinic's own instructions always come first, and the app says so.
 */

export type KitSection = "consult" | "tests" | "ob";
export type Conception = "day5" | "day6" | "day3" | "insemination" | "other";

export interface StageKit {
  consult: { on: string | null; bring: string[]; notes: string; next: string[] };
  tests: { day1: string | null; length: number; irregular: boolean; done: string[]; hidden: string[] };
  ob: { conceivedOn: string | null; how: Conception | null; obName: string; records: string[]; movedOn: string | null };
}

export const EMPTY_KIT: StageKit = {
  consult: { on: null, bring: [], notes: "", next: [] },
  tests: { day1: null, length: 28, irregular: false, done: [], hidden: [] },
  ob: { conceivedOn: null, how: null, obName: "", records: [], movedOn: null },
};

// ---------- first consult ----------

export const CONSULT_COVERS = [
  "Your health and cycle history, and any past tests or treatment.",
  "The tests to plan. Some happen on certain days of your cycle, others any day.",
  "Your options, and what the doctor suggests for you.",
  "What it could cost, and what your insurance or benefit might cover.",
];
export const CONSULT_BRING: [string, string][] = [
  ["insurance", "Your insurance card, or your fertility benefit details"],
  ["id", "A photo ID"],
  ["cycle", "The first day of your last period, and how long your cycles usually are"],
  ["results", "Any past test results or records"],
  ["meds", "A list of medications and supplements you take"],
  ["history", "Past pregnancies or treatment, if any"],
  ["person", "Someone to come with you or join by phone, if you'd like"],
];
/** What usually comes after a first consult. Order varies by clinic and by person. */
export const CONSULT_NEXT: [string, string, string][] = [
  ["tests", "Testing", "Blood work, ultrasounds and other tests, some on set days of your cycle."],
  ["review", "A visit to go over results", "The doctor explains what the tests found and the options."],
  ["cost", "Cost and coverage", "A quote from the clinic, and checking what your plan covers."],
  ["consents", "Consent forms and any counseling", "Some paths, like donor eggs, sperm or embryos, add counseling or legal steps."],
  ["start", "A start date", "Often set around your cycle."],
];

// ---------- workup test calendar ----------

/**
 * When each test usually happens. "days" are cycle days (day 1 = the first day of full bleeding).
 * Sources: ASRM Practice Committee, Fertility evaluation of infertile women (Fertil Steril 2021;116:1255-65)
 * for FSH/estradiol days 2-4, AMH any day and mid-luteal progesterone about a week before the next period;
 * UCSF Health for HSG in the first half of the cycle; WHO laboratory manual (2021) for semen analysis.
 * DRAFT: needs sign-off from the clinical reviewers before it shows outside demo builds.
 */
export type TestWhen = { kind: "days"; from: number; to: number; label: string } | { kind: "luteal"; label: string } | { kind: "any"; label: string };
/** `results`: the numbers she can enter for it (test name as labs print it, and Pumpkin's key for it). */
export interface WorkupTest { id: string; name: string; measures: string; when: TestWhen; note?: string; results?: { test: string; key: string }[] }
export const WORKUP_REVIEWED_BY: string | null = null;
export const WORKUP_SOURCE = "Typical timing from the American Society for Reproductive Medicine (2021), UCSF Health and the World Health Organization (2021). Your clinic's own instructions come first.";
export const WORKUP: WorkupTest[] = [
  { id: "fsh", name: "FSH and estradiol blood test", measures: "Hormones that show how the ovaries respond at the start of a cycle.", when: { kind: "days", from: 2, to: 4, label: "Cycle day 2 to 4" }, results: [{ test: "FSH", key: "fsh" }, { test: "Estradiol", key: "estradiol" }] },
  { id: "afc", name: "Antral follicle count", measures: "An ultrasound that counts the small follicles on the ovaries.", when: { kind: "days", from: 2, to: 4, label: "Early in your cycle, often with the blood test" } },
  { id: "hsg", name: "HSG or saline ultrasound", measures: "Looks at the inside of the uterus, and with an HSG, whether the tubes are open.", when: { kind: "days", from: 6, to: 12, label: "After bleeding stops, before ovulation" }, note: "Your clinic gives the exact day." },
  { id: "progesterone", name: "Progesterone blood test", measures: "Shows whether ovulation happened this cycle.", when: { kind: "luteal", label: "About a week before your next period" }, results: [{ test: "Progesterone", key: "progesterone" }] },
  { id: "amh", name: "AMH blood test", measures: "A hormone made by small follicles. It's one estimate of egg supply.", when: { kind: "any", label: "Any day" }, results: [{ test: "AMH", key: "amh" }] },
  { id: "blood", name: "Other blood work", measures: "Often thyroid, prolactin, blood type and infection screening.", when: { kind: "any", label: "Any day" }, results: [{ test: "TSH", key: "tsh" }, { test: "Prolactin", key: "prolactin" }] },
  { id: "carrier", name: "Genetic carrier screening", measures: "A blood or saliva test for genes that could be passed on to a child.", when: { kind: "any", label: "Any day" } },
  { id: "semen", name: "Semen analysis", measures: "Sperm count, movement and shape.", when: { kind: "any", label: "Any day" }, note: "If sperm is coming from a partner. The clinic says how many days to wait beforehand, usually 2 to 7." },
];

const DAY = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => ymd(at(s) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);

/**
 * The next window for a cycle-day test, counting forward whole cycles from day 1 until the window
 * hasn't ended yet. Returns null without a day 1, for any-day tests, or when cycles are irregular.
 */
export function testWindow(t: WorkupTest, day1: string | null, length: number, today: string): { from: string; to: string; nextCycle: boolean } | null {
  if (!day1 || t.when.kind === "any") return null;
  const len = Math.min(45, Math.max(21, Math.round(length) || 28));
  const [a, b] = t.when.kind === "days" ? [t.when.from, t.when.to] : [len - 8, len - 6];
  let start = day1, cycles = 0;
  while (addDays(start, b - 1) < today && cycles < 24) { start = addDays(start, len); cycles++; }
  return { from: addDays(start, a - 1), to: addDays(start, b - 1), nextCycle: cycles > 0 };
}

// ---------- clinic to OB ----------

/**
 * Estimated due date. After IVF, ACOG dates the pregnancy from the transfer: 266 days minus the
 * embryo's age (day-5: 261 days, day-3: 263; ACOG Committee Opinion 700, 2017). For insemination,
 * the insemination date is used as the conception date (266 days). It's an estimate to confirm.
 */
export const CONCEPTION: [Conception, string][] = [
  ["day5", "Embryo transfer, day 5"],
  ["day6", "Embryo transfer, day 6"],
  ["day3", "Embryo transfer, day 3"],
  ["insemination", "IUI or insemination"],
  ["other", "Something else, or not sure"],
];
export function dueDate(conceivedOn: string, how: Conception): string | null {
  const days = { day5: 261, day6: 260, day3: 263, insemination: 266, other: 0 }[how];
  return days ? addDays(conceivedOn, days) : null;
}
/** Weeks and days of pregnancy today, counted the usual way (from 280 days before the due date). */
export function weeksToday(due: string, today: string): { weeks: number; days: number } | null {
  const d = daysBetween(addDays(due, -280), today);
  if (d < 0 || d > 300) return null;
  return { weeks: Math.floor(d / 7), days: d % 7 };
}
export const OB_RECORDS: [string, string][] = [
  ["betas", "Pregnancy blood test results"],
  ["scans", "Early ultrasound reports"],
  ["procedure", "Your transfer or insemination record"],
  ["meds", "Your medication list, with stop dates"],
  ["donor", "Donor information, if it applies"],
];
export const RECORDS_HOW = "To get your clinic's official records, ask their medical records team. Under HIPAA you have a right to a copy, and they generally have 30 days to respond.";

// ---------- cleaning a change she sends ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ids = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : undefined);
const date = (v: unknown) => (v === null ? null : typeof v === "string" && DATE.test(v) && !Number.isNaN(at(v)) ? v : undefined);

/** Merge a change into her kit. Unknown keys and bad values are dropped, never stored. */
export function mergeKit(current: Partial<StageKit> | null, patch: Record<string, unknown>): StageKit {
  const k: StageKit = {
    consult: { ...EMPTY_KIT.consult, ...(current?.consult ?? {}) },
    tests: { ...EMPTY_KIT.tests, ...(current?.tests ?? {}) },
    ob: { ...EMPTY_KIT.ob, ...(current?.ob ?? {}) },
  };
  const c = (patch.consult ?? {}) as Record<string, unknown>, t = (patch.tests ?? {}) as Record<string, unknown>, o = (patch.ob ?? {}) as Record<string, unknown>;
  const on = date(c.on); if (on !== undefined) k.consult.on = on;
  const bring = ids(c.bring, CONSULT_BRING.map((x) => x[0])); if (bring) k.consult.bring = bring;
  if (typeof c.notes === "string") k.consult.notes = c.notes.slice(0, 4000);
  const next = ids(c.next, CONSULT_NEXT.map((x) => x[0])); if (next) k.consult.next = next;
  const d1 = date(t.day1); if (d1 !== undefined) k.tests.day1 = d1;
  if (typeof t.length === "number" && t.length >= 21 && t.length <= 45) k.tests.length = Math.round(t.length);
  if (typeof t.irregular === "boolean") k.tests.irregular = t.irregular;
  const done = ids(t.done, WORKUP.map((x) => x.id)); if (done) k.tests.done = done;
  const hidden = ids(t.hidden, WORKUP.map((x) => x.id)); if (hidden) k.tests.hidden = hidden;
  const co = date(o.conceivedOn); if (co !== undefined) k.ob.conceivedOn = co;
  if (o.how === null || CONCEPTION.some(([x]) => x === o.how)) k.ob.how = o.how as Conception | null;
  if (typeof o.obName === "string") k.ob.obName = o.obName.trim().slice(0, 120);
  const rec = ids(o.records, OB_RECORDS.map((x) => x[0])); if (rec) k.ob.records = rec;
  const moved = date(o.movedOn); if (moved !== undefined) k.ob.movedOn = moved;
  return k;
}
