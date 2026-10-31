import { describe, expect, it } from "vitest";
import { checkFhirBundle, recordToFhirBundle, type FhirRecordInput } from "../src";

const rec: FhirRecordInput = {
  id: "11111111-2222-4333-8444-555555555555", patient: { name: "Alex Rivera" }, createdAt: "2026-10-31T12:00:00Z",
  recipient: "Dr. Example, OB", expiresAt: "2026-11-30T12:00:00Z", sections: ["results", "meds", "visits", "coverage", "costs", "pregnancy"],
  results: [{ test: "Estradiol (E2)", analyte: "estradiol", value: 412, unit: "pg/mL", on: "2026-10-28", by: "read" }, { test: "Odd test", analyte: "other", value: 3, unit: "units", on: "2026-10-28", by: "you" }],
  meds: [{ medication: "Follistim", dose: "200 IU", time: "20:00", startsOn: "2026-10-27", endsOn: "2026-11-03", active: true, by: "you" }],
  appointments: [{ title: "Monitoring visit", at: "2026-11-01T11:30:00Z", location: "Coastal Fertility", by: "you" }],
  coverage: [{ payer: "Example Health Plan", plan: null, asOf: "2026-10-20", fertilityUsedCents: 850000, fertilityMaxCents: 2500000, deductibleCents: 200000, deductibleMetCents: 120000, oopMaxCents: null, oopMetCents: null, by: "read" }],
  costs: [{ kind: "charge", description: "Monitoring ultrasound", amountCents: 18000, on: "2026-10-20", dueOn: null, by: "read" }],
  pregnancy: { conceivedOn: "2026-11-10", how: null, dueDate: "2027-07-28", ob: null },
};

describe("her record as FHIR", () => {
  const b = recordToFhirBundle(rec);
  const res = (b.entry as { resource: Record<string, unknown> }[]).map((e) => e.resource);
  const of = (t: string) => res.filter((r) => r.resourceType === t);

  it("is a valid-shaped R4 bundle with every reference resolving and every item traced", () => {
    expect(b.resourceType).toBe("Bundle");
    expect(checkFhirBundle(b)).toEqual([]);
  });

  it("uses LOINC and UCUM where Pumpkin knows the test, and always keeps the printed name", () => {
    const [e2, odd] = of("Observation");
    expect(e2).toMatchObject({ code: { coding: [{ system: "http://loinc.org", code: "2243-4" }], text: "Estradiol (E2)" }, valueQuantity: { value: 412, system: "http://unitsofmeasure.org", code: "pg/mL" } });
    expect(odd!.code).toEqual({ text: "Odd test" });
  });

  it("says who entered each item, and never presents her entry as a clinic's", () => {
    const pv = of("Provenance");
    expect(pv).toHaveLength(of("Observation").length + of("MedicationStatement").length + of("Appointment").length + of("Coverage").length + of("Basic").length);
    const forE2 = pv.find((p) => (p.target as { reference: string }[])[0]!.reference === "Observation/result-1")!;
    expect(forE2.activity).toMatchObject({ coding: [{ code: "document-extracted" }] });
    expect(JSON.stringify(pv)).not.toContain("clinic-sent");
  });

  it("carries the consent it was shared under: who, what and until when", () => {
    expect(of("Consent")[0]).toMatchObject({ status: "active", provision: { type: "permit", period: { end: "2026-11-30T12:00:00.000Z" }, actor: [{ reference: { display: "Dr. Example, OB" } }] } });
  });

  it("never assumes gender, and leaves embryo details out unless she included them", () => {
    expect(of("Patient")[0]!.gender).toBe("unknown");
    expect(JSON.stringify(b)).not.toContain("conception-method");
    expect(JSON.stringify(recordToFhirBundle({ ...rec, pregnancy: { ...rec.pregnancy!, how: "day5" } }))).toContain("conception-method");
  });

  it("the checker catches a broken reference and an untraced item", () => {
    const bad = JSON.parse(JSON.stringify(b));
    bad.entry = bad.entry.filter((e: { resource: { resourceType: string } }) => e.resource.resourceType !== "Provenance");
    bad.entry[1].resource.subject = { reference: "Patient/nobody" };
    const p = checkFhirBundle(bad);
    expect(p.some((x) => /isn't in the bundle/.test(x))).toBe(true);
    expect(p.some((x) => /no Provenance/.test(x))).toBe(true);
  });
});
