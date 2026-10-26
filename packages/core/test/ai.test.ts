import { describe, expect, it } from "vitest";
import { buildDraftPrompt, checkAIDraft, pickSections, scrubForAI, type ProtocolText } from "../src";

const gonal: ProtocolText = { id: "meds.missed_dose.gonal_f", title: "Missed Gonal-f dose", body: "If it has been less than 4 hours since your scheduled time, take your Gonal-f now. If it has been longer, skip it, take tonight's dose as planned, and keep your monitoring appointment." };
const cramp: ProtocolText = { id: "wait.cramping", title: "Is cramping normal?", body: "Mild cramping can be normal during the wait. Call the nurse line right away for heavy bleeding, severe pain, fever, or trouble breathing." };
const coffee: ProtocolText = { id: "life.coffee", title: "Coffee and caffeine", body: "One cup of coffee a day (about 200 mg of caffeine) is fine during treatment." };
const all = [gonal, cramp, coffee];
const MEDS = ["Gonal-f", "Menopur", "Cetrotide", "Progesterone"];

describe("AI drafting gate", () => {
  it("finds the protocol sections that match the question, and none for unrelated ones", () => {
    expect(pickSections("I forgot my Gonal-f last night, what do I do?", all)[0]!.id).toBe("meds.missed_dose.gonal_f");
    expect(pickSections("Can I have coffee?", all)[0]!.id).toBe("life.coffee");
    expect(pickSections("Where do I park?", all)).toEqual([]);
  });

  it("sends the AI no contact details, and only the sections it may use", () => {
    expect(scrubForAI("Call me at (813) 555-0142 or maya@example.com, see https://x.com/a")).toBe("Call me at [phone] or [email], see [link]");
    const p = buildDraftPrompt({ message: "Coffee ok? maya@example.com", sections: [coffee], lang: "en" });
    expect(p.user).toContain("[life.coffee]");
    expect(p.user).not.toContain("maya@example.com");
    expect(p.user).not.toContain("Gonal");
    expect(p.system).toMatch(/NO_ANSWER/);
  });

  it("accepts a draft that sticks to the cited protocol", () => {
    const r = checkAIDraft("Since it has been more than 4 hours, skip it and take tonight's dose as planned. Keep your monitoring appointment.\nSOURCES: meds.missed_dose.gonal_f", all, MEDS);
    expect(r).toMatchObject({ ok: true, sources: ["meds.missed_dose.gonal_f"], problems: [] });
    expect(r.draft).not.toMatch(/SOURCES/);
  });

  it("holds back a draft with a dose or time that isn't in the protocol", () => {
    const r = checkAIDraft("Take 150 IU of Gonal-f now, within 6 hours.\nSOURCES: meds.missed_dose.gonal_f", all, MEDS);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/number that isn't in Bayside's protocol \(150, 6\)/);
  });

  it("holds back a draft that brings in a medication the section doesn't mention", () => {
    const r = checkAIDraft("Skip it and add an extra Menopur tonight.\nSOURCES: meds.missed_dose.gonal_f", all, MEDS);
    expect(r.problems.join()).toMatch(/medication the protocol section doesn't \(Menopur\)/);
  });

  it("holds back drafts that interpret results, talk about pregnancy, diagnose or discourage calling", () => {
    for (const bad of [
      "Your results look great, nothing to worry about.",
      "Your estradiol is right on track for this point.",
      "It sounds like you are pregnant!",
      "This is probably OHSS, a diagnosis we see often.",
      "Mild cramping is normal so there's no need to call.",
      "Tus resultados están bien.",
    ]) {
      expect(checkAIDraft(`${bad}\nSOURCES: wait.cramping`, all, MEDS).ok, bad).toBe(false);
    }
  });

  it("holds back drafts without sources, with made-up sources, or with NO_ANSWER", () => {
    expect(checkAIDraft("Mild cramping can be normal during the wait.", all).problems.join()).toMatch(/didn't say which/);
    expect(checkAIDraft("Mild cramping can be normal.\nSOURCES: made.up", all).problems.join()).toMatch(/wasn't given/);
    expect(checkAIDraft("NO_ANSWER", all).problems).toEqual(["Bayside's protocol doesn't cover this question"]);
  });
});
