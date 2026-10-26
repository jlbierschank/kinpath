/**
 * Checks on clinic-edited content. The settings screens and the server both run these,
 * so a bad edit is refused before it can reach a patient.
 */
import type { Lang } from "./ranges";
import { normalize } from "./triage";

export class ContentError extends Error {
  constructor(message: string) { super(message); this.name = "ContentError"; }
}

export interface RangeInput { analyte: string; unit: string; dayFrom: number; dayTo: number; low: number; high: number; inRangeEn: string; inRangeEs: string }

export function checkRange(r: RangeInput): RangeInput {
  const analyte = r.analyte.trim().toLowerCase();
  const unit = r.unit.trim();
  if (!analyte) throw new ContentError("Name the test, for example estradiol.");
  if (!unit) throw new ContentError("Add the unit, for example pg/mL.");
  for (const [k, v] of [["Low", r.low], ["High", r.high], ["First day", r.dayFrom], ["Last day", r.dayTo]] as const) {
    if (!Number.isFinite(v)) throw new ContentError(`${k} must be a number.`);
  }
  if (r.low < 0) throw new ContentError("Low can't be negative.");
  if (r.low > r.high) throw new ContentError("Low must be at or below high.");
  if (!Number.isInteger(r.dayFrom) || !Number.isInteger(r.dayTo) || r.dayFrom < 0) throw new ContentError("Days must be whole numbers, 0 or more.");
  if (r.dayFrom > r.dayTo) throw new ContentError("The first day must be on or before the last day.");
  checkPatientText(r.inRangeEn, "English explanation");
  checkPatientText(r.inRangeEs, "Spanish explanation");
  return { ...r, analyte, unit, inRangeEn: r.inRangeEn.trim(), inRangeEs: r.inRangeEs.trim() };
}

export function checkPatientText(text: string, label: string, max = 1200): string {
  const t = text.trim();
  if (t.length < 10) throw new ContentError(`${label} is too short.`);
  if (t.length > max) throw new ContentError(`${label} is too long (${max} characters at most).`);
  return t;
}

export function checkSteps(steps: Record<Lang, string>[]): Record<Lang, string>[] {
  const cleaned = steps.map((s) => ({ en: s.en.trim(), es: s.es.trim() })).filter((s) => s.en || s.es);
  if (cleaned.length === 0) throw new ContentError("Add at least one step.");
  if (cleaned.length > 15) throw new ContentError("Keep it to 15 steps or fewer.");
  cleaned.forEach((s, i) => {
    if (!s.en) throw new ContentError(`Step ${i + 1} needs English text.`);
    if (!s.es) throw new ContentError(`Step ${i + 1} needs Spanish text (a medical translator should review it).`);
  });
  return cleaned;
}

/** Turn two textareas (one step per line) into paired steps. Both must have the same number of lines. */
export function pairSteps(en: string, es: string): Record<Lang, string>[] {
  const a = en.split("\n").map((s) => s.trim()).filter(Boolean);
  const b = es.split("\n").map((s) => s.trim()).filter(Boolean);
  if (a.length !== b.length) throw new ContentError(`English has ${a.length} steps and Spanish has ${b.length}. They need to match, one per line.`);
  return checkSteps(a.map((x, i) => ({ en: x, es: b[i]! })));
}

export function checkVideoUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  let parsed: URL;
  try { parsed = new URL(u); } catch { throw new ContentError("The video link isn't a valid web address."); }
  if (parsed.protocol !== "https:") throw new ContentError("Video links must start with https://");
  return u;
}

export function checkTriageTerm(term: string): string {
  const t = normalize(term);
  if (t.length < 3) throw new ContentError("Use at least 3 letters.");
  if (t.length > 60) throw new ContentError("Keep it under 60 characters.");
  return term.trim();
}
