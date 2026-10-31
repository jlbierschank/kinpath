import { describe, expect, it } from "vitest";
import { costCategory, groupPayments, packetCsv } from "../src";

describe("year-end packet", () => {
  it("groups costs by what they were for", () => {
    expect(costCategory("Egg retrieval cycle fee")).toBe("procedure");
    expect(costCategory("Specialty pharmacy: Menopur")).toBe("medication");
    expect(costCategory("Monitoring ultrasound")).toBe("tests_monitoring");
    expect(costCategory("Annual embryo storage")).toBe("storage");
    expect(costCategory("New patient consult")).toBe("consult_visit");
    expect(costCategory("Hotel near clinic")).toBe("travel");
    expect(costCategory("Something")).toBe("other");
  });
  it("totals each group and the year", () => {
    const p = (id: string, d: string, c: number) => ({ id, description: d, amountCents: c, paidOn: "2026-03-01", method: "card", captureId: null, category: costCategory(d) });
    const g = groupPayments([p("a", "Menopur", 1000), p("b", "Pharmacy refill", 500), p("c", "Embryo transfer", 4000)]);
    expect(g.totalCents).toBe(5500);
    expect(g.groups.map((x) => [x.category, x.totalCents])).toEqual([["procedure", 4000], ["medication", 1500]]);
  });
  it("writes a CSV a spreadsheet can't run as a formula", () => {
    const csv = packetCsv([{ id: "a", description: "=HYPERLINK(\"x\")", amountCents: 12345, paidOn: "2026-02-01", method: null, captureId: "r", category: "other" }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"123.45"`);
  });
});
