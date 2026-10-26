import { describe, expect, it } from "vitest";
import { checkRange, checkTriageTerm, checkVideoUrl, classifyMessage, ContentError, pairSteps, triage } from "../src";

const range = { analyte: "Estradiol", unit: "pg/mL", dayFrom: 5, dayTo: 7, low: 300, high: 900, inRangeEn: "Right where we expect today.", inRangeEs: "Justo donde esperamos hoy." };

describe("clinic content checks", () => {
  it("accepts a good range and tidies it", () => expect(checkRange(range).analyte).toBe("estradiol"));
  it.each([
    [{ low: 900, high: 300 }, /at or below/],
    [{ dayFrom: 8, dayTo: 7 }, /first day/],
    [{ low: Number.NaN }, /number/],
    [{ inRangeEs: "corto" }, /Spanish explanation is too short/],
    [{ unit: " " }, /unit/],
  ])("refuses a bad range %o", (patch, msg) => expect(() => checkRange({ ...range, ...patch })).toThrow(msg));
  it("pairs English and Spanish steps line by line", () => {
    expect(pairSteps("Wash hands\nInject", "Lávate\nInyecta")).toEqual([{ en: "Wash hands", es: "Lávate" }, { en: "Inject", es: "Inyecta" }]);
    expect(() => pairSteps("One\nTwo", "Uno")).toThrow(ContentError);
  });
  it("only allows https video links", () => {
    expect(checkVideoUrl("")).toBeNull();
    expect(() => checkVideoUrl("http://example.com/v.mp4")).toThrow(/https/);
    expect(() => checkVideoUrl("javascript:alert(1)")).toThrow();
  });
  it("needs real words for urgent terms", () => expect(() => checkTriageTerm("ok")).toThrow());
});

describe("clinic-added urgent words", () => {
  const terms = [{ term: "dizzy", level: "urgent" as const }, { term: "mareada", level: "urgent" as const }];
  it("flag messages the built-ins would miss", () => {
    expect(triage("I feel dizzy after my shot").level).toBe("routine");
    expect(triage("I feel dizzy after my shot", terms).level).toBe("urgent");
    expect(triage("Estoy MAREADA", terms).ruleIds).toContain("clinic.mareada");
  });
  it("never weaken the built-ins", () => {
    expect(triage("I can't breathe", []).level).toBe("urgent");
    expect(classifyMessage("I can't breathe", { clinicTerms: terms }).kind).toBe("urgent_symptom");
  });
});
