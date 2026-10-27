import { describe, expect, it } from "vitest";
import { analyteKey, cleanItem, cleanItems, findDate, parseCaptureReply, readPlainText, testInfo, TESTS, toClock } from "../src";

const today = "2026-10-26"; // a Monday

describe("what each test measures", () => {
  it("recognizes the names labs use", () => {
    expect(analyteKey("Estradiol, serum")).toBe("estradiol");
    expect(analyteKey("E2")).toBe("estradiol");
    expect(analyteKey("Beta hCG (quantitative)")).toBe("hcg");
    expect(analyteKey("Anti-Müllerian Hormone")).toBe("amh");
    expect(analyteKey("Vitamin D")).toBe("other");
  });
  it("never says what a number means", () => {
    for (const t of TESTS) expect(`${t.measures} ${t.inTreatment}`).not.toMatch(/\b(normal|abnormal|good|bad|healthy|too high|too low)\b/i);
    expect(testInfo("amh")!.inTreatment).toMatch(/doesn't measure egg quality/);
  });
  it("is marked unreviewed until a clinician signs off", () => {
    expect(TESTS.every((t) => t.reviewedBy === null)).toBe(true);
  });
});

describe("checking proposed items", () => {
  it("a medication without a dose or time is flagged, never filled in", () => {
    const m = cleanItem({ kind: "medication", data: { name: "Menopur" } })!;
    expect(m.unsure).toEqual(expect.arrayContaining(["dose", "times", "startsOn"]));
    expect(m.data).toEqual({ name: "Menopur", dose: "", times: [] });
  });
  it("times become 24-hour clock times; bad ones are dropped", () => {
    const m = cleanItem({ kind: "medication", data: { name: "Gonal-f", dose: "225 IU", times: ["8 pm", "25:00", "07:30"], startsOn: "2026-10-27", endsOn: "2026-10-20" } })!;
    expect(m.data).toMatchObject({ times: ["20:00", "07:30"], startsOn: "2026-10-27" });
    expect((m.data as { endsOn?: string }).endsOn).toBeUndefined();
  });
  it("keeps the lab's reference range only when it makes sense", () => {
    expect(cleanItem({ kind: "result", data: { test: "Estradiol", value: "612", unit: "pg/mL", collectedOn: today, refLow: 30, refHigh: 400, refText: "Follicular 30-400" } })!.data)
      .toMatchObject({ value: 612, refLow: 30, refHigh: 400, refText: "Follicular 30-400" });
    expect(cleanItem({ kind: "result", data: { test: "E2", value: 5, unit: "x", collectedOn: today, refLow: 9, refHigh: 1 } })!.data).not.toHaveProperty("refLow");
    expect(cleanItem({ kind: "result", data: { test: "E2", value: "n/a" } })).toBeNull();
  });
  it("costs are dollars, due dates only on charges", () => {
    expect(cleanItem({ kind: "cost", data: { type: "payment", amount: "$1,790.00", description: "Deposit", date: today, dueOn: "2026-11-01", method: "Card" } })!.data)
      .toEqual({ type: "payment", description: "Deposit", amount: 1790, date: today, method: "card" });
    expect(cleanItem({ kind: "cost", data: { amount: -5 } })).toBeNull();
  });
  it("unknown kinds and junk are ignored", () => {
    expect(cleanItems({ items: [{ kind: "diagnosis", data: {} }, null, 7, { kind: "question", data: { text: "Can I exercise?" } }] })).toHaveLength(1);
  });
  it("reads the AI's JSON even inside a code fence", () => {
    expect(parseCaptureReply('```json\n{"items":[{"kind":"question","data":{"text":"Why?"},"unsure":[]}]}\n```')).toHaveLength(1);
    expect(parseCaptureReply("Sorry, I can't")).toEqual([]);
  });
});

describe("plain dates and times", () => {
  it("understands the ways people write them", () => {
    expect(toClock("8:30pm")).toBe("20:30");
    expect(toClock("12 am")).toBe("00:00");
    expect(findDate("due Nov 3", today)).toBe("2026-11-03");
    expect(findDate("on 11/3", today)).toBe("2026-11-03");
    expect(findDate("tomorrow at 7", today)).toBe("2026-10-27");
    expect(findDate("on Thursday", today)).toBe("2026-10-29");
    expect(findDate("Jan 5", today)).toBe("2027-01-05");
    expect(findDate("Feb 30", today)).toBeUndefined();
  });
});

describe("reading a typed or spoken note", () => {
  it("splits a note into items she can confirm", () => {
    const items = readPlainText([
      "Gonal-f 225 IU at 8 pm starting tomorrow",
      "Estradiol 612 pg/mL today",
      "Monitoring ultrasound Thursday at 7:30 am",
      "$1,790 due Nov 1 for the cycle balance",
      "I paid $250 for embryo storage on Oct 20",
      "Can I keep running during stims?",
    ].join("\n"), today);
    expect(items.map((i) => i.kind)).toEqual(["medication", "result", "appointment", "cost", "cost", "question"]);
    expect(items[0]!.data).toMatchObject({ name: "Gonal-f", dose: "225 IU", times: ["20:00"], startsOn: "2026-10-27" });
    expect(items[1]!.data).toMatchObject({ test: "Estradiol", value: 612, unit: "pg/mL", collectedOn: today });
    expect(items[2]!.data).toMatchObject({ startsAt: "2026-10-29T07:30" });
    expect(items[3]!.data).toMatchObject({ type: "charge", amount: 1790, dueOn: "2026-11-01", description: "The cycle balance" });
    expect(items[4]!.data).toMatchObject({ type: "payment", amount: 250, date: "2026-10-20", description: "Embryo storage" });
    expect(readPlainText("$250 due Nov 30 for embryo storage", today)[0]!.data).toMatchObject({ description: "Embryo storage", dueOn: "2026-11-30" });
  });
  it("progesterone as a medication isn't read as a result", () => {
    expect(readPlainText("Progesterone in oil 1 mL inject at 9 pm", today)[0]!.kind).toBe("medication");
    expect(readPlainText("Progesterone 14.2 ng/mL", today)[0]!.kind).toBe("result");
  });
});
