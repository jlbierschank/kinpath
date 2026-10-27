import { describe, expect, it } from "vitest";
import { isFinanceCsv, parseFhirBundle, parseFinanceCsv, parseHl7 } from "../src";

const patient = { fullUrl: "urn:uuid:p", resource: { resourceType: "Patient", identifier: [{ value: "BF-100231" }], name: [{ family: "Torres" }] } };

describe("billing over FHIR", () => {
  it("reads Coverage, keeping only the last 4 of the member id", () => {
    const r = parseFhirBundle({ resourceType: "Bundle", entry: [patient, { resource: { resourceType: "Coverage", id: "cov-1", status: "active", subscriberId: "XJ99-2841-7",
      beneficiary: { reference: "urn:uuid:p" }, payor: [{ display: "Example Health Plan" }], period: { end: "2027-12-31" },
      class: [{ type: { coding: [{ code: "group" }] }, value: "G-1" }, { type: { coding: [{ code: "plan" }] }, value: "PPO-9", name: "Gold PPO" }] } }] });
    expect(r.records[0]).toEqual({ kind: "coverage", externalId: "cov-1", mrn: "BF-100231", lastName: "Torres", payerName: "Example Health Plan", planName: "Gold PPO", memberLast4: "8417", endsOn: "2027-12-31", active: true });
  });
  it("reads an Invoice as a charge, and a cancelled one as withdrawn", () => {
    const inv = (status: string) => ({ resource: { resourceType: "Invoice", id: "inv-1", status, subject: { reference: "urn:uuid:p" }, date: "2026-10-20",
      totalGross: { value: 1790, currency: "USD" }, lineItem: [{ chargeItemCodeableConcept: { text: "Cycle balance" } }] } });
    expect(parseFhirBundle({ resourceType: "Bundle", entry: [patient, inv("issued")] }).records[0]).toMatchObject({ kind: "ledger", entryKind: "charge", amountCents: 179000, description: "Cycle balance", occurredOn: "2026-10-20", voided: false });
    expect(parseFhirBundle({ resourceType: "Bundle", entry: [patient, inv("cancelled")] }).records[0]).toMatchObject({ voided: true });
  });
});

/** Builds an IN1 segment with fields at their standard positions. */
const in1 = (f: Record<number, string>) => ["IN1", ...Array.from({ length: 36 }, (_, i) => f[i + 1] ?? "")].join("|");

describe("billing over HL7 v2 (DFT^P03 and IN1)", () => {
  const dft = [
    "MSH|^~\\&|PM|BAYSIDE|PUMPKIN|BAYSIDE|202610261000||DFT^P03|D1|P|2.5.1",
    "PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya",
    "FT1|1|TX-1||20261020||CG|IVF02^Cycle balance||||1790.00",
    "FT1|2|TX-2||20261024||PY|PAY^Patient payment|Card payment|||-500.00",
    "FT1|3|TX-3||20261024||XX|??||||10",
    in1({ 1: "1", 2: "PPO9", 3: "EHP01", 4: "Example Health Plan", 8: "G-1", 9: "Acme Corp employees", 13: "20271231", 15: "Gold PPO", 36: "XJ9928417" }),
  ].join("\r");
  const r = parseHl7(dft);
  it("reads charges and payments with positive amounts", () => {
    expect(r.records.filter((x) => x.kind === "ledger")).toEqual([
      expect.objectContaining({ externalId: "TX-1", entryKind: "charge", description: "Cycle balance", amountCents: 179000, occurredOn: "2026-10-20" }),
      expect.objectContaining({ externalId: "TX-2", entryKind: "payment", description: "Card payment", amountCents: 50000 }),
    ]);
    expect(r.skipped).toEqual(["a financial transaction Pumpkin doesn't use (XX)"]);
  });
  it("reads insurance from IN1", () => {
    expect(r.records.find((x) => x.kind === "coverage")).toEqual({ kind: "coverage", externalId: "EHP01:XJ9928417", mrn: "BF-100231", lastName: "Torres", payerName: "Example Health Plan", planName: "Gold PPO", memberLast4: "8417", endsOn: "2027-12-31", active: true });
  });
});

describe("billing CSV", () => {
  const csv = [
    "entry_id,mrn,last_name,type,description,amount,date,due_date,method,insurance_amount,category,estimate_id,estimate_title",
    "c1,BF-100231,Torres,charge,Cycle balance,\"$1,790.00\",2026-10-20,2026-11-05,,,,,",
    "p1,BF-100231,Torres,payment,Card payment,500,2026-10-24,,card,,,,",
    "e1,BF-100231,Torres,estimate,Egg retrieval,4500,2026-10-01,,,3600,clinic,EST-9,IVF cycle",
    "e2,BF-100231,Torres,estimate,Embryo storage,600,2026-10-01,,,,storage,EST-9,IVF cycle",
    "x1,BF-100231,Torres,gift card,Thing,5,2026-10-01,,,,,,",
  ].join("\n");
  it("is told apart from a results CSV", () => {
    expect(isFinanceCsv(csv)).toBe(true);
    expect(isFinanceCsv("result_id,mrn,last_name,test,value,unit,collected_at")).toBe(false);
  });
  it("reads ledger lines and groups estimate lines into one estimate", () => {
    const r = parseFinanceCsv(csv);
    expect(r.records[0]).toMatchObject({ kind: "ledger", entryKind: "charge", amountCents: 179000, dueOn: "2026-11-05" });
    expect(r.records[1]).toMatchObject({ kind: "ledger", entryKind: "payment", amountCents: 50000, method: "card", dueOn: null });
    expect(r.records[2]).toEqual({ kind: "estimate", externalId: "EST-9", mrn: "BF-100231", lastName: "Torres", title: "IVF cycle", lines: [
      { label: "Egg retrieval", category: "clinic", amountCents: 450000, insuranceCents: 360000 },
      { label: "Embryo storage", category: "storage", amountCents: 60000, insuranceCents: 0 }] });
    expect(r.skipped).toEqual(["a row with an unknown type (gift card)"]);
  });
});
