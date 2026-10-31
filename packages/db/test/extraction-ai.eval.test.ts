/**
 * Measures the AI document reader against the labeled test set (packages/core/test/fixtures/extraction.json).
 * It calls the AI service, so it only runs when asked:
 *   KINPATH_EVAL_AI=1 KINPATH_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @kinpath/db exec vitest run test/extraction-ai.eval.test.ts
 * The report is written to docs/EXTRACTION-ACCURACY.md. Launch bar: 95% of fields right, no invented items.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreDoc, summarize, type LabeledDoc } from "@kinpath/core";
import { extractorFromEnv } from "../src";

const run = process.env.KINPATH_EVAL_AI === "1" && !!extractorFromEnv();
const ROOT = join(__dirname, "../../..");

describe.skipIf(!run)("AI document reading accuracy", () => {
  it("meets the launch bar on the labeled test set", async () => {
    const set = JSON.parse(readFileSync(join(ROOT, "packages/core/test/fixtures/extraction.json"), "utf8")) as { docs: LabeledDoc[] };
    const ex = extractorFromEnv()!;
    const scores = [];
    for (const d of set.docs) scores.push(scoreDoc(d, await ex.read({ text: d.text, today: d.today })));
    const r = summarize(scores);
    const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
    writeFileSync(join(ROOT, "docs/EXTRACTION-ACCURACY.md"), [
      `# Document reading accuracy`, ``, `Reader: ${ex.name}. Run ${new Date().toISOString().slice(0, 10)} on ${set.docs.length} made-up documents.`, ``,
      `Overall: ${r.right} of ${r.fields} fields right (${pct(r.accuracy)}). Items missed: ${r.missingItems}. Items invented: ${r.extraItems}.`, ``,
      `| Type | Fields right |`, `|---|---|`, ...Object.entries(r.byType).map(([t, x]) => `| ${t} | ${x.right}/${x.fields} (${pct(x.accuracy)}) |`), ``,
      `## Misses`, ``, ...r.docs.flatMap((d) => d.wrong.map((w) => `- ${d.id}: ${w}`)), ``,
    ].join("\n"));
    expect(r.extraItems).toBe(0);
    expect(r.accuracy).toBeGreaterThanOrEqual(0.95);
  }, 300_000);
});
