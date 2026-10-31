/**
 * Measuring how well Pumpkin reads documents, against a labeled test set (made-up documents with the
 * answers written down by a person). Field by field: a field counts as right only if it matches the
 * label. Extra items Pumpkin invented are counted separately, because a wrong item is worse than a
 * missing one: she has to notice it and say "Not this".
 */
import type { CaptureItem } from "./solo";

export interface LabeledDoc { id: string; type: "lab" | "med_sheet" | "receipt" | "bill" | "insurance" | "denial"; today: string; text: string; expect: { kind: CaptureItem["kind"]; data: Record<string, unknown> }[] }
export interface DocScore { id: string; type: LabeledDoc["type"]; fields: number; right: number; missingItems: number; extraItems: number; wrong: string[] }
export interface EvalReport { docs: DocScore[]; fields: number; right: number; accuracy: number; missingItems: number; extraItems: number; byType: Record<string, { fields: number; right: number; accuracy: number }> }

const norm = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(v));
function same(want: unknown, got: unknown) {
  if (typeof want === "number") return typeof got === "number" && Math.abs(want - got) < 0.01;
  if (Array.isArray(want)) return Array.isArray(got) && want.length === got.length && want.every((w, i) => norm(w) === norm(got[i]));
  return norm(want) === norm(got);
}
const KEY: Record<CaptureItem["kind"], (d: Record<string, unknown>) => string> = {
  medication: (d) => String(d.name ?? "").toLowerCase().split(/\s+/)[0] ?? "",
  result: (d) => String(d.test ?? "").toLowerCase(),
  appointment: (d) => String(d.startsAt ?? "").slice(0, 10),
  cost: (d) => String(d.amount ?? ""),
  question: (d) => String(d.text ?? "").toLowerCase().slice(0, 20),
  coverage: () => "coverage",
  denial: () => "denial",
};

export function scoreDoc(doc: LabeledDoc, got: { kind: CaptureItem["kind"]; data: object }[]): DocScore {
  const pool = got.map((g) => ({ ...g, used: false }));
  const score: DocScore = { id: doc.id, type: doc.type, fields: 0, right: 0, missingItems: 0, extraItems: 0, wrong: [] };
  for (const e of doc.expect) {
    const key = KEY[e.kind](e.data);
    const match = pool.find((g) => !g.used && g.kind === e.kind && KEY[g.kind](g.data as Record<string, unknown>) === key);
    const fields = Object.keys(e.data);
    score.fields += fields.length;
    if (!match) { score.missingItems += 1; score.wrong.push(`${e.kind} ${key}: not found`); continue; }
    match.used = true;
    for (const f of fields) {
      const g = (match.data as Record<string, unknown>)[f];
      if (same(e.data[f], g)) score.right += 1; else score.wrong.push(`${e.kind} ${key}.${f}: expected ${JSON.stringify(e.data[f])}, got ${JSON.stringify(g)}`);
    }
  }
  score.extraItems = pool.filter((g) => !g.used).length;
  return score;
}

export function summarize(docs: DocScore[]): EvalReport {
  const fields = docs.reduce((a, d) => a + d.fields, 0), right = docs.reduce((a, d) => a + d.right, 0);
  const byType: EvalReport["byType"] = {};
  for (const d of docs) { const t = (byType[d.type] ??= { fields: 0, right: 0, accuracy: 0 }); t.fields += d.fields; t.right += d.right; }
  for (const t of Object.values(byType)) t.accuracy = t.fields ? t.right / t.fields : 0;
  return { docs, fields, right, accuracy: fields ? right / fields : 0, missingItems: docs.reduce((a, d) => a + d.missingItems, 0), extraItems: docs.reduce((a, d) => a + d.extraItems, 0), byType };
}
