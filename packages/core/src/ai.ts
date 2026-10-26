/**
 * The AI drafting gate. Pure rules, tested on their own; the network call lives in @kinpath/db.
 *
 * Layers, in order:
 *  1. Urgent and crisis messages never reach the AI (deterministic triage runs first).
 *  2. The AI sees only the question (emails, phone numbers and links removed) and the clinic's
 *     approved protocol sections that match it. Never the patient's name or record.
 *  3. Every draft is checked in code: it must cite the sections it used; every number in it
 *     (doses, times) must appear in those sections; medication names must come from them; it
 *     may not interpret results, diagnose, or tell someone they don't need to call.
 *  4. A draft that fails any check is held back: the nurse sees the protocol text instead, with
 *     the reason. A nurse reviews and sends every reply either way.
 */
import { normalize } from "./triage";
import type { Lang } from "./ranges";

export interface ProtocolText { id: string; title: string; body: string }
export interface DraftProvider { name: string; complete(req: { system: string; user: string }): Promise<string> }

const STOP = new Set(("a an and are as at be but by can could did do does for from had has have how i if in is it its me my of on or our should so that the this to was we what when where which who why will with would you your " +
  "el la los las un una y o de del en que es por para con como mi me se si no lo al le").split(" "));
const words = (s: string) => normalize(s).replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** The protocol sections most related to the question (by shared words). None if nothing matches. */
export function pickSections(message: string, sections: ProtocolText[], k = 3): ProtocolText[] {
  const q = new Set(words(message));
  return sections
    .map((s) => ({ s, score: words(`${s.title} ${s.title} ${s.body}`).filter((w) => q.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
}

/** Removes contact details and links from what's sent to the AI. */
export function scrubForAI(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .slice(0, 1500);
}

export function buildDraftPrompt(input: { message: string; sections: ProtocolText[]; lang: Lang }): { system: string; user: string } {
  const language = input.lang === "es" ? "Spanish" : "English";
  const system = [
    "You draft replies for a fertility clinic's nurses. A nurse reads, edits and sends every reply; you never talk to the patient directly.",
    "Rules you must follow:",
    "- Use ONLY the clinic protocol sections provided. Do not add any medical fact, dose, time, medication or instruction that is not in them.",
    "- If the sections don't answer the question, reply with exactly: NO_ANSWER",
    "- Never interpret test results, never diagnose, never say whether someone is or isn't pregnant.",
    "- Never tell the patient they don't need to call or that something is nothing to worry about.",
    `- Write in plain, warm ${language} at about a 6th-grade reading level. 2 to 5 short sentences.`,
    "- No greeting and no sign-off; the app adds them.",
    "- End with a final line exactly like: SOURCES: <section id>, <section id>",
  ].join("\n");
  const user = [
    "Clinic protocol sections:",
    ...input.sections.map((s) => `[${s.id}] ${s.title}\n${s.body}`),
    "",
    "Patient's message:",
    scrubForAI(input.message),
  ].join("\n");
  return { system, user };
}

const FORBIDDEN: [RegExp, string][] = [
  [/\b(your|tu|tus)\s+(result|results|resultado|resultados|levels?|niveles?)\b/i, "interprets results"],
  [/\b(hcg|estradiol|progesterone|progesterona|beta)\b.{0,40}\b(is|was|means|es|significa)\b/i, "interprets results"],
  [/\b(you are|you're|estas|estás)\s+(pregnant|embarazada)\b/i, "talks about pregnancy status"],
  [/\b(not|no)\s+(pregnant|embarazada)\b/i, "talks about pregnancy status"],
  [/\bdiagnos/i, "diagnoses"],
  [/\b(no need to|don't need to|do not need to|no necesitas|no hace falta)\s+(call|llamar|come in|venir)/i, "tells the patient not to call"],
  [/\b(nothing to worry|nada de que preocupar|nada de qué preocupar|it's nothing|no es nada)\b/i, "dismisses a concern"],
];

export interface DraftCheck { ok: boolean; draft: string; sources: string[]; problems: string[] }

/** Checks an AI draft against the sections it was given. Plain-language problems for the nurse. */
export function checkAIDraft(output: string, sections: ProtocolText[], knownMedications: string[] = []): DraftCheck {
  const raw = output.trim();
  if (/^NO_ANSWER\b/i.test(raw)) return { ok: false, draft: "", sources: [], problems: ["Bayside's protocol doesn't cover this question"] };
  const m = raw.match(/\n?\s*SOURCES:\s*(.+)\s*$/i);
  const body = (m ? raw.slice(0, m.index) : raw).trim();
  const ids = new Set(sections.map((s) => s.id));
  const sources = m ? m[1]!.split(/[,\s]+/).map((x) => x.replace(/[[\]]/g, "").trim()).filter(Boolean) : [];
  const problems: string[] = [];
  if (sources.length === 0) problems.push("it didn't say which protocol section it used");
  if (sources.some((x) => !ids.has(x))) problems.push("it cited a protocol section it wasn't given");
  const cited = normalize(sections.filter((s) => sources.includes(s.id)).map((s) => `${s.title} ${s.body}`).join(" "));
  const numbers = body.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const strayNumbers = numbers.filter((n) => !cited.includes(n.replace(",", ".")) && !cited.includes(n));
  if (strayNumbers.length) problems.push(`it mentioned a number that isn't in Bayside's protocol (${[...new Set(strayNumbers)].join(", ")})`);
  const nb = normalize(body);
  const strayMeds = knownMedications.filter((med) => nb.includes(normalize(med)) && !cited.includes(normalize(med)));
  if (strayMeds.length) problems.push(`it mentioned a medication the protocol section doesn't (${strayMeds.join(", ")})`);
  for (const [re, why] of FORBIDDEN) if (re.test(body)) problems.push(`it ${why}`);
  if (body.length < 20) problems.push("it was too short to be useful");
  if (body.length > 1200) problems.push("it was too long");
  return { ok: problems.length === 0, draft: body, sources, problems: [...new Set(problems)] };
}
