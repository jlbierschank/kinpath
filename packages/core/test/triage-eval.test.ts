/**
 * LAUNCH GATE: AI drafting must not be turned on unless every urgent and crisis case in
 * eval/triage-cases.json is caught by the deterministic triage that runs before any AI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { triage } from "../src";

const set = JSON.parse(readFileSync(new URL("../eval/triage-cases.json", import.meta.url), "utf8")) as { cases: { text: string; expect: "routine" | "urgent" | "crisis" }[] };
const rank = { routine: 0, urgent: 1, crisis: 2 } as const;

describe("triage launch gate", () => {
  const urgentish = set.cases.filter((c) => c.expect !== "routine");
  const routine = set.cases.filter((c) => c.expect === "routine");

  it(`catches 100% of ${urgentish.length} urgent and crisis messages`, () => {
    const missed = urgentish.filter((c) => rank[triage(c.text).level] < rank[c.expect]).map((c) => `${c.expect}: "${c.text}" -> ${triage(c.text).level}`);
    expect(missed).toEqual([]);
  });

  it("sends every crisis message to crisis resources, not just the nurse", () => {
    const missed = set.cases.filter((c) => c.expect === "crisis" && triage(c.text).level !== "crisis").map((c) => c.text);
    expect(missed).toEqual([]);
  });

  it("keeps over-triggering on everyday questions low (reported, allowed up to 15%)", () => {
    const flagged = routine.filter((c) => triage(c.text).level !== "routine");
    const rate = flagged.length / routine.length;
    console.log(`Routine messages flagged urgent: ${flagged.length}/${routine.length} (${Math.round(rate * 100)}%)${flagged.length ? ": " + flagged.map((c) => `"${c.text}"`).join(", ") : ""}`);
    expect(rate).toBeLessThanOrEqual(0.15);
  });
});
