import { describe, expect, it } from "vitest";
import { suggestMeds } from "../src";

const names = (q: string) => suggestMeds(q).map((m) => m.name);
describe("medication suggestions", () => {
  it("suggests from the first letters", () => {
    expect(names("gon")[0]).toBe("Gonal-f");
    expect(names("men")[0]).toBe("Menopur");
    expect(names("prog")).toContain("Progesterone in oil");
  });
  it("finds a med by its other name", () => {
    expect(names("lupron")).toEqual(["Leuprolide"]);
    expect(names("clomid")).toEqual(["Clomiphene"]);
    expect(names("pio")).toContain("Progesterone in oil");
  });
  it("forgives common misspellings", () => {
    expect(names("folistim")).toContain("Follistim AQ");
    expect(names("menapur")).toContain("Menopur");
    expect(names("cetrotid")).toContain("Cetrotide");
  });
  it("waits for 2 letters, and stops once it matches exactly", () => {
    expect(names("g")).toEqual([]);
    expect(names("Menopur")).toEqual([]);
    expect(names("zzzz")).toEqual([]);
  });
  it("never suggests a dose", () => {
    for (const m of suggestMeds("e", 50).concat(suggestMeds("pro", 50))) expect(`${m.name} ${m.also ?? ""}`).not.toMatch(/\d+\s*(mg|iu|mcg|ml|units?)\b/i);
  });
});
