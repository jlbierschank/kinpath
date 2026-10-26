import { describe, expect, it } from "vitest";
import { hl7Ack, hl7Time, parseFhirBundle, parseHl7 } from "../src";

const ORU = [
  "MSH|^~\\&|LIS|BAYSIDE|PUMPKIN|BAYSIDE|202610260800||ORU^R01|MSG0001|P|2.5.1",
  "PID|1||ACCT-77^^^BAYSIDE^AN~BF-100231^^^BAYSIDE^MR||Torres^Maya||19910402|F",
  "OBR|1|PL-1|FL-9001|83003^Estradiol^L|||202610260745-0400",
  "OBX|1|NM|2243-4^Estradiol^LN||412|pg/mL^pg/mL^UCUM|||||F|||202610260745-0400",
  "OBX|2|NM|2839-9^Progesterone^LN||1.9|ng/mL|||||C",
  "OBX|3|NM|3016-3^TSH^LN||1.2|m[IU]/L|||||F",
  "OBX|4|NM|21198-7^hCG^LN||212|m[IU]/mL|||||P",
].join("\r");

describe("HL7 v2 lab results (ORU^R01)", () => {
  const r = parseHl7(ORU);
  it("reads the MRN from the MR-typed identifier and the last name", () => {
    expect(r.records[0]).toMatchObject({ mrn: "BF-100231", lastName: "Torres" });
  });
  it("reads LOINC-coded results with units, times and corrections", () => {
    expect(r.records).toHaveLength(2);
    expect(r.records[0]).toMatchObject({ kind: "result", analyte: "estradiol", value: 412, unit: "pg/mL", collectedAt: "2026-10-26T07:45:00-04:00", corrected: false, externalId: "FL-9001:2243-4:1" });
    expect(r.records[1]).toMatchObject({ analyte: "progesterone", value: 1.9, corrected: true, collectedAt: "2026-10-26T07:45:00-04:00" });
  });
  it("skips untracked and preliminary results, and says why", () => {
    expect(r.skipped).toEqual(["a result Pumpkin doesn't track", "a result that isn't final yet (P)"]);
  });
  it("acknowledges each message", () => {
    expect(r.messages).toEqual([{ controlId: "MSG0001", type: "ORU^R01" }]);
    expect(hl7Ack(r.messages, true)).toMatch(/^MSH\|\^~\\&\|PUMPKIN\|PUMPKIN\|\|\|\d{14}\|\|ACK\^R01\|ACKMSG0001\|P\|2\.5\.1\rMSA\|AA\|MSG0001$/);
  });
});

describe("HL7 v2 pharmacy orders (RDE^O11)", () => {
  const msg = (control: string) => [
    "MSH|^~\\&|EHR|BAYSIDE|PUMPKIN|BAYSIDE|202610261000||RDE^O11|RX1|P|2.5.1",
    "PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya",
    `ORC|${control}|PO-55|FO-55`,
    "TQ1|1||||||202610272130|202610272130",
    "RXE||OVI250^Ovidrel^LOCAL|250||mcg^mcg",
  ].join("\n");
  it("reads a new order with dose, time and dates", () => {
    expect(parseHl7(msg("NW")).records[0]).toEqual({ kind: "med_order", externalId: "FO-55", mrn: "BF-100231", lastName: "Torres", medication: "Ovidrel", dose: "250 mcg", timeOfDay: "21:30", startsOn: "2026-10-27", endsOn: "2026-10-27" });
  });
  it("reads a discontinue as a stop", () => {
    expect(parseHl7(msg("DC")).records[0]).toMatchObject({ kind: "med_stop", externalId: "FO-55" });
  });
});

describe("appointments", () => {
  it("reads HL7 scheduling (SIU^S12 and S15)", () => {
    const siu = (ev: string) => [
      `MSH|^~\\&|SCHED|BAYSIDE|PUMPKIN|BAYSIDE|202610261000||SIU^${ev}|S1|P|2.5.1`,
      "SCH|PA-1|FA-1||||||^Monitoring ultrasound",
      "PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya",
      "AIS|1||US^Monitoring ultrasound and blood work|202610280730-0400",
      "AIL|1||Bayside Tampa, 2nd floor",
    ].join("\r");
    expect(parseHl7(siu("S12")).records[0]).toEqual({ kind: "appointment", externalId: "FA-1", mrn: "BF-100231", lastName: "Torres", startsAt: "2026-10-28T07:30:00-04:00", apptKind: "monitoring", title: "Monitoring ultrasound and blood work", location: "Bayside Tampa, 2nd floor", cancelled: false });
    expect(parseHl7(siu("S15")).records[0]).toMatchObject({ cancelled: true });
  });

  it("reads FHIR Appointments", () => {
    const r = parseFhirBundle({ resourceType: "Bundle", type: "collection", entry: [
      { fullUrl: "urn:uuid:p", resource: { resourceType: "Patient", identifier: [{ value: "BF-100231" }], name: [{ family: "Torres" }] } },
      { resource: { resourceType: "Appointment", id: "ap-1", status: "booked", start: "2026-10-30T09:00:00-04:00", appointmentType: { text: "Egg retrieval" },
        participant: [{ actor: { reference: "urn:uuid:p" } }, { actor: { reference: "Location/1", display: "Bayside surgery center" } }] } },
      { resource: { resourceType: "Appointment", id: "ap-2", status: "proposed", start: "2026-10-30T09:00:00-04:00", participant: [] } },
    ] });
    expect(r.records[0]).toEqual({ kind: "appointment", externalId: "ap-1", mrn: "BF-100231", lastName: "Torres", startsAt: "2026-10-30T09:00:00-04:00", apptKind: "retrieval", title: "Egg retrieval", location: "Bayside surgery center", cancelled: false });
    expect(r.skipped).toEqual(["an appointment that isn't booked (proposed)"]);
  });
});

it("reads HL7 times, with or without a zone", () => {
  expect(hl7Time("202610260745-0400")).toBe("2026-10-26T07:45:00-04:00");
  expect(hl7Time("20261026")).toBe("2026-10-26T00:00:00");
  expect(hl7Time("nonsense")).toBeNull();
});

it("refuses text that isn't HL7", () => {
  expect(() => parseHl7("hello")).toThrow(/MSH/);
});
