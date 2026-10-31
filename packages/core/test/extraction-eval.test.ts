import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanItem, readPlainText, scoreDoc, summarize, type LabeledDoc } from "../src";

const set = JSON.parse(readFileSync(join(__dirname, "fixtures/extraction.json"), "utf8")) as { docs: LabeledDoc[] };

describe("the labeled test set for reading documents", () => {
  it("covers the December document types, two each, all made up", () => {
    const types = new Set(set.docs.map((d) => d.type));
    expect([...types].sort()).toEqual(["bill", "denial", "insurance", "lab", "med_sheet", "receipt"]);
    for (const t of types) expect(set.docs.filter((d) => d.type === t).length).toBeGreaterThanOrEqual(2);
  });

  it("scores field by field, and counts invented items", () => {
    const doc = set.docs.find((d) => d.id === "bill-1")!;
    expect(scoreDoc(doc, [{ kind: "cost", data: { type: "charge", amount: 3000, dueOn: "2026-11-15" } }])).toMatchObject({ fields: 3, right: 3, extraItems: 0 });
    expect(scoreDoc(doc, [{ kind: "cost", data: { type: "charge", amount: 3000, dueOn: "2026-11-16" } }, { kind: "question", data: { text: "?" } }])).toMatchObject({ right: 2, extraItems: 1 });
    expect(scoreDoc(doc, [])).toMatchObject({ right: 0, missingItems: 1 });
  });

  it("the basic reader (used when AI reading is off) meets its bar on every type", () => {
    const report = summarize(set.docs.map((d) => scoreDoc(d, readPlainText(d.text, d.today))));
    // The bar for the fallback reader. The AI reader is measured with scripts/eval-extraction.mjs.
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9);
    for (const [type, t] of Object.entries(report.byType)) expect(t.accuracy, type).toBeGreaterThanOrEqual(0.75);
    expect(report.extraItems).toBe(0);
  });

  it("insurance statements: totals become coverage; only what she may owe becomes a bill", () => {
    const items = readPlainText(set.docs.find((d) => d.id === "ins-1")!.text, "2026-10-30");
    expect(items.filter((i) => i.kind === "cost").map((i) => (i.data as { amount: number }).amount)).toEqual([180]);
  });

  it("denial letters: never a bill, and no deadline the letter doesn't print", () => {
    const items = readPlainText(set.docs.find((d) => d.id === "denial-2")!.text, "2026-10-30");
    expect(items.map((i) => i.kind)).toEqual(["denial"]);
    expect(items[0]!.data).not.toHaveProperty("appealBy");
    expect(items[0]!.unsure).toContain("appealBy");
  });

  it("keeps where each item came from, and drops a page that makes no sense", () => {
    expect(cleanItem({ kind: "question", data: { text: "Ask about ICSI?" }, from: { page: 2, quote: "Ask about ICSI?" } })).toMatchObject({ from: { page: 2, quote: "Ask about ICSI?" } });
    expect(cleanItem({ kind: "question", data: { text: "x?" }, from: { page: 0 } })).not.toHaveProperty("from");
    expect(cleanItem({ kind: "coverage", data: { payer: "Example", deductible: 100, deductibleMet: 500 } })!.unsure).toEqual(expect.arrayContaining(["deductible", "deductibleMet"]));
  });
});
