/**
 * "Make Pumpkin yours": who she is, how she's building her family, and how Pumpkin should talk to her.
 * Every answer is optional. Pumpkin uses them to address her the way she asked, to tailor what it
 * shows, and to prepare her for visits. It never uses them to judge, diagnose or advise.
 */
import { HandoffError } from "./handoff";

export const PRONOUNS = ["she/her", "they/them", "he/him", "she/they", "he/they"] as const;
export const PARTNER_TITLES = ["partner", "wife", "husband", "spouse", "girlfriend", "boyfriend", "fiancée", "fiancé"] as const;

export const FAMILY_PATHS = {
  solo_by_choice: "On my own (single parent by choice)",
  with_partner: "With a partner",
  donor_eggs: "Using donor eggs",
  donor_sperm: "Using donor sperm",
  donor_embryos: "Using donor embryos",
  gestational_carrier: "With a gestational carrier",
  preserving: "Freezing eggs or embryos for later",
  growing_again: "Growing our family again",
  prefer_not: "I'd rather not say",
} as const;
export type FamilyPath = keyof typeof FAMILY_PATHS;

export const CONDITIONS = {
  pcos: "PCOS",
  endometriosis: "Endometriosis",
  low_reserve: "Low ovarian reserve",
  unexplained: "Unexplained infertility",
  fibroids: "Fibroids or polyps",
  tubal: "Blocked or damaged tubes",
  thyroid: "A thyroid condition",
  recurrent_loss: "Recurrent pregnancy loss",
  male_factor: "Sperm-related factors",
} as const;
export type Condition = keyof typeof CONDITIONS;

/** Fields that are identity or health information. Saving any of them needs her consent first. */
export const SENSITIVE_FIELDS = ["gender", "familyPath", "partnerName", "partnerPronouns", "partnerTitle", "conditions", "conditionsOther", "pastCycles", "pastLoss", "allergies"] as const;

/** Steps of "Make Pumpkin yours", shown a few at a time on Today. */
export const ABOUT_STEPS = {
  name: "What to call you",
  path: "How you're building your family",
  person: "Your person",
  background: "Your background",
  talk: "How Pumpkin talks to you",
} as const;
export type AboutStep = keyof typeof ABOUT_STEPS;

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Pronouns: one of the common sets, or her own words (letters, slashes, spaces). */
export function cleanPronouns(v: unknown): string | null {
  const s = clean(v, 40).toLowerCase();
  if (!s) return null;
  if (!/^[a-zÀ-ɏ][a-zÀ-ɏ /,'-]*$/i.test(s)) throw new HandoffError("Pronouns can use letters, spaces and slashes, like she/her.");
  return s;
}
export function cleanTitle(v: unknown): string | null {
  const s = clean(v, 30).toLowerCase();
  if (!s) return null;
  if (!/^[a-zÀ-ɏ][a-zÀ-ɏ '-]*$/i.test(s)) throw new HandoffError("Use a word, like partner or wife.");
  return s;
}
export function cleanPaths(v: unknown): FamilyPath[] {
  const list = Array.isArray(v) ? v.filter((x): x is FamilyPath => typeof x === "string" && x in FAMILY_PATHS) : [];
  return list.includes("prefer_not") ? ["prefer_not"] : [...new Set(list)];
}
export function cleanConditions(v: unknown): Condition[] {
  return [...new Set(Array.isArray(v) ? v.filter((x): x is Condition => typeof x === "string" && x in CONDITIONS) : [])];
}

// ---------- questions she might want to ask at her next visit ----------

const BY_STAGE: Record<string, string[]> = {
  just_starting: [
    "What tests will I need before treatment, and what does each one check?",
    "What are my options, and which would you suggest for me?",
    "What might treatment cost, and what could my insurance cover?",
  ],
  in_cycle: [
    "When will I hear about my results, and from whom?",
    "What should I do if I'm late with a dose or miss one?",
    "Who do I call after hours?",
  ],
  two_week_wait: [
    "When is my blood test, and how will I get the result?",
    "Which symptoms mean I should call right away?",
  ],
  after_hard_result: [
    "Can we go over what happened in this cycle?",
    "What would you change next time?",
    "Are there tests that could help explain it?",
  ],
  freezing_eggs: [
    "How many eggs might you expect to retrieve for me?",
    "How long can eggs stay frozen, and what does storage cost each year?",
  ],
  between_cycles: [
    "What would you change for the next cycle?",
    "How long should I wait before starting again?",
  ],
};
const BY_PATH: Partial<Record<FamilyPath, string[]>> = {
  solo_by_choice: ["How do I choose a sperm donor, and what screening do donors have?", "Who can come with me to procedures, and can I drive myself home?"],
  with_partner: ["Does my partner need any tests or visits?"],
  donor_eggs: ["What screening do egg donors go through?", "Do you offer counseling about donor conception?"],
  donor_sperm: ["What screening do sperm donors go through?", "What legal steps should I know about with a donor?"],
  donor_embryos: ["What do I need to know about the legal side of donated embryos?", "Do you offer counseling about donor conception?"],
  gestational_carrier: ["How does the clinic work with my carrier and her care team?", "What legal steps come first with a carrier?"],
  preserving: ["How long can eggs or embryos stay frozen, and what does storage cost?"],
  growing_again: ["Could anything have changed since my last pregnancy?"],
};
const BY_CONDITION: Partial<Record<Condition, string>> = {
  pcos: "How does PCOS change my medication plan or monitoring?",
  endometriosis: "Does endometriosis change how you'd approach my treatment?",
  low_reserve: "What does my ovarian reserve testing mean for my plan?",
  unexplained: "Are there other tests that could help explain things?",
  fibroids: "Do my fibroids or polyps need treatment before a transfer?",
  tubal: "Do my tubes need to be treated before IVF?",
  thyroid: "Should my thyroid be checked before or during treatment?",
  recurrent_loss: "Are there tests you'd recommend because of my losses?",
  male_factor: "What would you suggest for the sperm-related factors?",
};

/** Up to 6 questions to consider, for her stage, path and background. Never ones she already has. */
export function suggestedQuestions(input: { stage: string; paths: FamilyPath[]; conditions: Condition[]; pastLoss?: string | null }, existing: string[] = []): string[] {
  const have = new Set(existing.map((q) => q.trim().toLowerCase()));
  const out: string[] = [];
  const add = (q: string | undefined) => { if (q && !have.has(q.toLowerCase()) && !out.includes(q)) out.push(q); };
  for (const c of input.conditions) add(BY_CONDITION[c]);
  if (input.pastLoss === "yes" && !input.conditions.includes("recurrent_loss")) add("Are there tests you'd recommend because of my past losses?");
  for (const p of input.paths) for (const q of BY_PATH[p] ?? []) add(q);
  for (const q of BY_STAGE[input.stage] ?? []) add(q);
  return out.slice(0, 6);
}

// ---------- tender dates ----------

export interface TenderDate { month: number; day: number; year: number | null; mode: "quiet" | "gentle"; label: string | null }
/** The tender date that falls on `today` (YYYY-MM-DD), if any. Quiet wins over gentle. */
export function tenderOn(today: string, dates: TenderDate[]): TenderDate | null {
  const [y, m, d] = today.split("-").map(Number);
  const hits = dates.filter((t) => t.month === m && t.day === d && (t.year === null || t.year === y));
  return hits.find((t) => t.mode === "quiet") ?? hits[0] ?? null;
}
export function validTenderDate(month: number, day: number, year: number | null): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  const max = new Date(Date.UTC(year ?? 2024, month, 0)).getUTCDate(); // 2024: allows Feb 29 for every-year dates
  return day <= max && (year === null || (Number.isInteger(year) && year >= 2000 && year <= 2100));
}
