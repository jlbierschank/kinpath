import { describe, expect, it } from "vitest";
import { CONSULT_BRING, dueDate, EMPTY_KIT, mergeKit, testWindow, weeksToday, WORKUP, WORKUP_REVIEWED_BY } from "../src";

const test = (id: string) => WORKUP.find((t) => t.id === id)!;

describe("test calendar", () => {
  it("puts day 2 to 4 tests on the right dates", () => {
    expect(testWindow(test("fsh"), "2026-11-01", 28, "2026-10-28")).toEqual({ from: "2026-11-02", to: "2026-11-04", nextCycle: false });
  });
  it("times progesterone about a week before the next period, by her cycle length", () => {
    expect(testWindow(test("progesterone"), "2026-11-01", 28, "2026-11-01")).toEqual({ from: "2026-11-20", to: "2026-11-22", nextCycle: false });
    expect(testWindow(test("progesterone"), "2026-11-01", 32, "2026-11-01")!.from).toBe("2026-11-24");
  });
  it("rolls a missed window into the next cycle", () => {
    expect(testWindow(test("fsh"), "2026-10-01", 28, "2026-10-28")).toEqual({ from: "2026-10-30", to: "2026-11-01", nextCycle: true });
  });
  it("has no dates for any-day tests or without a day 1", () => {
    expect(testWindow(test("amh"), "2026-11-01", 28, "2026-10-28")).toBeNull();
    expect(testWindow(test("fsh"), null, 28, "2026-10-28")).toBeNull();
  });
  it("describes tests without saying what a number means", () => {
    for (const t of WORKUP) expect(`${t.measures} ${t.note ?? ""}`).not.toMatch(/\b(normal|abnormal|good|bad|healthy|too high|too low|infertile)\b/i);
  });
  it("is marked unreviewed until the clinical reviewers sign off", () => {
    expect(WORKUP_REVIEWED_BY).toBeNull();
  });
});

describe("due date", () => {
  it("follows ACOG's transfer dating", () => {
    expect(dueDate("2026-10-01", "day5")).toBe("2027-06-19"); // 261 days
    expect(dueDate("2026-10-01", "day3")).toBe("2027-06-21"); // 263 days
    expect(dueDate("2026-10-01", "insemination")).toBe("2027-06-24"); // 266 days
    expect(dueDate("2026-10-01", "other")).toBeNull();
  });
  it("counts weeks the usual way", () => {
    // A day-5 transfer is 2 weeks 5 days of pregnancy on the day of transfer.
    expect(weeksToday(dueDate("2026-10-01", "day5")!, "2026-10-01")).toEqual({ weeks: 2, days: 5 });
    expect(weeksToday(dueDate("2026-10-01", "day5")!, "2026-11-12")).toEqual({ weeks: 8, days: 5 });
  });
});

describe("saving her kit", () => {
  it("keeps known values and drops everything else", () => {
    const k = mergeKit(null, { consult: { bring: ["insurance", "nope"], on: "2026-11-05", hack: 1 }, tests: { length: 99, day1: "bad", done: ["amh"] }, ob: { how: "day5", obName: "  Dr. Reyes  ", records: ["betas"] }, extra: true });
    expect(k.consult).toEqual({ ...EMPTY_KIT.consult, bring: ["insurance"], on: "2026-11-05" });
    expect(k.tests).toEqual({ ...EMPTY_KIT.tests, done: ["amh"] });
    expect(k.ob).toMatchObject({ how: "day5", obName: "Dr. Reyes", records: ["betas"] });
    expect(Object.keys(k)).toEqual(["consult", "tests", "ob"]);
  });
  it("merges onto what's already saved, and can clear a date", () => {
    const a = mergeKit(null, { tests: { day1: "2026-11-01" }, consult: { bring: CONSULT_BRING.map((x) => x[0]) } });
    const b = mergeKit(a, { tests: { day1: null } });
    expect(b.tests.day1).toBeNull();
    expect(b.consult.bring).toHaveLength(CONSULT_BRING.length);
  });
});
