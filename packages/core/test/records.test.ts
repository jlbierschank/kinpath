import { describe, expect, it } from "vitest";
import { parseFhirBundle, parseResultsCsv, RecordsError, sameName } from "../src";

const patient = { fullUrl: "urn:uuid:p1", resource: { resourceType: "Patient", id: "p1", identifier: [{ type: { coding: [{ code: "MR" }] }, value: "BF-100231" }], name: [{ use: "official", family: "Torres", given: ["Maya"] }] } };
const obs = (over: Record<string, unknown> = {}) => ({ resource: {
  resourceType: "Observation", id: "obs-1", status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "2243-4", display: "Estradiol" }] },
  subject: { reference: "urn:uuid:p1" }, effectiveDateTime: "2026-10-26T08:10:00-04:00",
  valueQuantity: { value: 412, unit: "pg/mL", system: "http://unitsofmeasure.org", code: "pg/mL" }, ...over } });
const bundle = (...entry: unknown[]) => ({ resourceType: "Bundle", type: "collection", entry });

describe("reading FHIR bundles", () => {
  it("reads an estradiol result and finds the patient's MRN and last name", () => {
    const r = parseFhirBundle(bundle(patient, obs()));
    expect(r.records).toEqual([expect.objectContaining({ kind: "result", externalId: "obs-1", mrn: "BF-100231", lastName: "Torres", analyte: "estradiol", value: 412, unit: "pg/mL", corrected: false })]);
  });

  it("treats hCG as a pregnancy test number, not an ordinary result", () => {
    const r = parseFhirBundle(bundle(patient, obs({ code: { coding: [{ system: "http://loinc.org", code: "21198-7" }] }, valueQuantity: { value: 212, code: "m[IU]/mL" } })));
    expect(r.records[0]).toMatchObject({ kind: "hcg", analyte: "hcg", unit: "mIU/mL" });
  });

  it("skips results that aren't final or aren't tracked, and says why", () => {
    const r = parseFhirBundle(bundle(patient, obs({ status: "preliminary" }), obs({ id: "x", code: { coding: [{ system: "http://loinc.org", code: "2345-7" }] } })));
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toEqual(["a result that isn't final yet (preliminary)", "a result Pumpkin doesn't track"]);
  });

  it("marks corrected and withdrawn results", () => {
    const r = parseFhirBundle(bundle(patient, obs({ status: "amended" }), obs({ id: "obs-2", status: "entered-in-error", valueQuantity: undefined })));
    expect(r.records[0]).toMatchObject({ corrected: true, withdrawn: false });
    expect(r.records[1]).toMatchObject({ withdrawn: true });
  });

  it("never converts units; an unusual unit passes through for the nurse to see", () => {
    const r = parseFhirBundle(bundle(patient, obs({ valueQuantity: { value: 1500, code: "pmol/L" } })));
    expect(r.records[0]).toMatchObject({ value: 1500, unit: "pmol/L" });
  });

  it("reads medication orders and stops", () => {
    const order = { resource: { resourceType: "MedicationRequest", id: "mr-1", status: "active", intent: "order",
      medicationCodeableConcept: { text: "Ovidrel" }, subject: { reference: "Patient/p1" },
      dosageInstruction: [{ timing: { repeat: { timeOfDay: ["21:30:00"], boundsPeriod: { start: "2026-10-27", end: "2026-10-27" } } }, doseAndRate: [{ doseQuantity: { value: 250, unit: "mcg" } }] }] } };
    const stop = { resource: { ...order.resource, id: "mr-2", status: "stopped" } };
    const r = parseFhirBundle(bundle(patient, order, stop));
    expect(r.records[0]).toEqual({ kind: "med_order", externalId: "mr-1", mrn: "BF-100231", lastName: "Torres", medication: "Ovidrel", dose: "250 mcg", timeOfDay: "21:30", startsOn: "2026-10-27", endsOn: "2026-10-27" });
    expect(r.records[1]).toMatchObject({ kind: "med_stop", externalId: "mr-2" });
  });

  it("uses a subject identifier when the patient isn't in the bundle", () => {
    const r = parseFhirBundle(bundle(obs({ subject: { identifier: { value: "BF-100245" } } })));
    expect(r.records[0]).toMatchObject({ mrn: "BF-100245", lastName: null });
  });

  it("refuses anything that isn't a bundle", () => {
    expect(() => parseFhirBundle({ resourceType: "Patient" })).toThrow(RecordsError);
    expect(() => parseFhirBundle("nope")).toThrow(RecordsError);
  });
});

describe("reading results CSVs", () => {
  it("reads rows by name or LOINC code, with quoted fields", () => {
    const csv = "result_id,mrn,last_name,test,value,unit,collected_at\nr1,BF-100231,Torres,Estradiol,412,pg/mL,2026-10-26T08:10\nr2,BF-100231,\"Torres\",2839-9,1.9,ng/mL,2026-10-26T08:10\nr3,BF-100231,Torres,Vitamin D,30,ng/mL,2026-10-26";
    const r = parseResultsCsv(csv);
    expect(r.records.map((x) => x.kind === "result" || x.kind === "hcg" ? x.analyte : "")).toEqual(["estradiol", "progesterone"]);
    expect(r.skipped).toEqual(["a result Pumpkin doesn't track"]);
  });
  it("names missing columns", () => {
    expect(() => parseResultsCsv("mrn,value\n1,2")).toThrow(/result_id, last_name, test, unit, collected_at/);
  });
});

it("compares names loosely", () => {
  expect(sameName("Pérez-Torres", "perez torres")).toBe(true);
  expect(sameName("Torres", "Shah")).toBe(false);
});
