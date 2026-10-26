import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, inQuietHours, planReminders, type ScheduledDose } from "../src";

const at = (h: number, m = 0, dayOffset = 0) => { const d = new Date(2026, 9, 26 + dayOffset, h, m, 0, 0); return d; };
const dose = (id: string, med: string, d: Date, taken: Date | null = null): ScheduledDose => ({ id, medication: med, scheduledFor: d.toISOString(), takenAt: taken ? taken.toISOString() : null });

describe("dose reminders", () => {
  const tonight = [dose("a", "Gonal-f", at(20)), dose("b", "Menopur", at(20)), dose("c", "Cetrotide", at(20))];

  it("groups same-time doses into one reminder, 15 minutes early", () => {
    const r = planReminders(tonight, DEFAULT_PREFS, at(9), "Bayside Fertility");
    const doseR = r.filter((x) => x.kind === "dose");
    expect(doseR).toHaveLength(1);
    expect(new Date(doseR[0]!.at).getHours()).toBe(19);
    expect(new Date(doseR[0]!.at).getMinutes()).toBe(45);
    expect(doseR[0]!.doseIds).toEqual(["a", "b", "c"]);
  });

  it("never names medications on the lock screen by default", () => {
    const r = planReminders(tonight, DEFAULT_PREFS, at(9), "Bayside Fertility");
    for (const x of r) {
      expect(x.body).not.toMatch(/Gonal|Menopur|Cetrotide|IVF|fertility/i);
      expect(x.body).toBe("You have a reminder.");
    }
  });

  it("in quiet mode keeps dose reminders but drops the follow-up nudges", () => {
    const normal = planReminders(tonight, DEFAULT_PREFS, at(9), "Bayside Fertility");
    const quiet = planReminders(tonight, DEFAULT_PREFS, at(9), "Bayside Fertility", { quiet: true });
    expect(normal.some((x) => x.kind === "follow_up")).toBe(true);
    expect(quiet.map((x) => x.kind)).toEqual(["dose"]);
  });

  it("shows names only when the patient turns that on, in her language", () => {
    const r = planReminders(tonight, { ...DEFAULT_PREFS, lockScreenDetail: true, lang: "es" }, at(9), "Bayside");
    expect(r[0]!.body).toBe("Pronto: Gonal-f, Menopur, Cetrotide");
  });

  it("never silences a dose reminder, even inside quiet hours", () => {
    const late = [dose("x", "Ovidrel", at(22, 30))]; // trigger shots are often late at night
    const r = planReminders(late, DEFAULT_PREFS, at(9), "Bayside");
    const d = r.find((x) => x.kind === "dose")!;
    expect(new Date(d.at).getHours()).toBe(22);
    expect(new Date(d.at).getMinutes()).toBe(15);
  });

  it("moves the follow-up out of quiet hours", () => {
    const late = [dose("x", "Ovidrel", at(22, 30))];
    const f = planReminders(late, DEFAULT_PREFS, at(9), "Bayside").find((x) => x.kind === "follow_up")!;
    const when = new Date(f.at);
    expect(when.getHours()).toBe(7);
    expect(when.getDate()).toBe(27);
  });

  it("drops reminders for doses already logged", () => {
    const r = planReminders([dose("a", "Gonal-f", at(20), at(20, 5))], DEFAULT_PREFS, at(9), "Bayside");
    expect(r).toHaveLength(0);
  });

  it("handles quiet hours that cross midnight", () => {
    expect(inQuietHours(at(23), DEFAULT_PREFS)).toBe(true);
    expect(inQuietHours(at(6, 59), DEFAULT_PREFS)).toBe(true);
    expect(inQuietHours(at(7), DEFAULT_PREFS)).toBe(false);
    expect(inQuietHours(at(12), { quietStart: "12:00", quietEnd: "13:00" })).toBe(true);
  });
});
