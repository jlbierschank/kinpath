import { beforeEach, describe, expect, it } from "vitest";
import { addCapture, dataChoices, exportMyData, IDS, itemsToCheck, migrate, openDb, saveItem, seed, setDataChoice, soloCosts, type Db, type Extractor } from "../src";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const };
beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

const EOB = "Explanation of benefits. This is not a bill.\nInsurer: Example Health Plan\nStatement date: 2026-10-20\nDeductible: $1,200 met of $2,000\nOut-of-pocket: $1,850 met of $6,000\nFertility benefit: $8,500 used of $25,000\nMonitoring ultrasound, amount billed $480, plan paid $300, you may owe $180";

describe("insurance statements", () => {
  it("become her coverage and one bill for what she may owe, after she checks them", async () => {
    const r = await addCapture(db, alex, IDS.alex, { kind: "text", text: EOB }, { extractor: null });
    const items = (await itemsToCheck(db, alex, IDS.alex)).filter((i) => i.captureId === r.captureId);
    expect(items.map((i) => i.kind).sort()).toEqual(["cost", "coverage"]);
    for (const i of items) await saveItem(db, alex, IDS.alex, i.id, null);
    const c = await soloCosts(db, alex, IDS.alex);
    expect(c.coverage).toEqual([expect.objectContaining({ payer: "Example Health Plan", asOf: "2026-10-20", fertilityUsedCents: 850000, fertilityMaxCents: 2500000, deductibleCents: 200000, deductibleMetCents: 120000, oopMaxCents: 600000, oopMetCents: 185000 })]);
    expect(c.entries.filter((e) => e.mine).map((e) => e.amountCents)).toContain(18000);
  });

  it("a newer statement from the same insurer replaces what shows; the old one is kept", async () => {
    await addCapture(db, alex, IDS.alex, { kind: "text", text: EOB }, { extractor: null });
    await addCapture(db, alex, IDS.alex, { kind: "text", text: EOB.replace("2026-10-20", "2026-11-20").replace("$8,500 used", "$12,000 used") }, { extractor: null });
    for (const i of (await itemsToCheck(db, alex, IDS.alex)).filter((x) => x.kind === "coverage")) await saveItem(db, alex, IDS.alex, i.id, null);
    const c = await soloCosts(db, alex, IDS.alex);
    expect(c.coverage).toHaveLength(1);
    expect(c.coverage[0]).toMatchObject({ asOf: "2026-11-20", fertilityUsedCents: 1200000 });
    expect((await exportMyData(db, alex)).data.finance_coverage).toHaveLength(2);
  });
});

describe("where each item came from", () => {
  it("keeps the page and the words it was read from, for her to check against", async () => {
    const fake: Extractor = { name: "fake", read: async () => [{ kind: "result", data: { test: "Estradiol", value: 412, unit: "pg/mL", collectedOn: "2026-10-28" }, unsure: [], from: { page: 2, quote: "Estradiol 412 pg/mL" } } as never] };
    const r = await addCapture(db, alex, IDS.alex, { kind: "pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.4 fake").toString("base64"), filename: "labs.pdf" }, { extractor: fake });
    const item = (await itemsToCheck(db, alex, IDS.alex)).find((i) => i.captureId === r.captureId);
    expect(item!.source).toMatchObject({ filename: "labs.pdf", hasFile: true, page: 2, quote: "Estradiol 412 pg/mL" });
  });
});

describe("her data choices", () => {
  it("are off until she turns them on, recorded when changed, and only hers", async () => {
    expect(await dataChoices(db, alex, IDS.alex)).toEqual({ research: false, researchChangedAt: null, predictions: false, predictionsChangedAt: null });
    const on = await setDataChoice(db, alex, IDS.alex, "research", true);
    expect(on).toMatchObject({ research: true, predictions: false });
    expect(on.researchChangedAt).not.toBeNull();
    expect((await setDataChoice(db, alex, IDS.alex, "research", false)).research).toBe(false);
    const log = await db.query<{ action: string }>(`SELECT action FROM audit_events WHERE action LIKE 'patient.%_research' ORDER BY id`);
    expect(log.rows.map((r) => r.action)).toEqual(["patient.allowed_research", "patient.stopped_research"]);
  });

  it("work for a clinic's patients too, and her clinic can't read them", async () => {
    await setDataChoice(db, maya, IDS.maya, "predictions", true);
    expect((await dataChoices(db, maya, IDS.maya)).predictions).toBe(true);
    expect(await dataChoices(db, maria, IDS.maya)).toMatchObject({ predictions: false }); // nurse sees nothing
    await expect(setDataChoice(db, maria, IDS.maya, "research", true)).rejects.toThrow(/Only she/);
    await expect(setDataChoice(db, maya, IDS.priya, "research", true)).rejects.toThrow();
  });
});

import { checkFhirBundle, recordToFhirBundle } from "@kinpath/core";
import { addResult, createPersonalShare, myRecordForFhir, openPersonalLink, openPersonalSummary, saveKit, stopSummaryShare } from "../src";
import { createHash } from "node:crypto";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

describe("sending her record (tier 1)", () => {
  it("only the sections she picked; embryo details out unless she adds them; 30 days by default", async () => {
    await saveKit(db, alex, IDS.alex, { ob: { conceivedOn: "2026-11-10", how: "day5" } } as never);
    const made = await createPersonalShare(db, alex, IDS.alex, { recipient: "Dr. Example, OB", sections: ["results", "pregnancy", "coverage"] });
    expect(Math.round((new Date(made.expiresAt).getTime() - Date.now()) / 86400_000)).toBe(30);
    const s = (await openPersonalLink(db, made.token))!;
    expect(s.sections.sort()).toEqual(["coverage", "pregnancy", "results"]);
    expect(s.meds).toBeNull();
    expect(s.costs).toBeNull();
    expect(s.appointments).toEqual([]);
    expect(s.pregnancy.how).toBeNull(); // embryo detail left out
    expect(s.pregnancy.dueDate).not.toBeNull();
    const withEmbryo = await createPersonalShare(db, alex, IDS.alex, { recipient: "Me", sections: ["embryo"], days: 7 });
    expect(withEmbryo.sections).toContain("pregnancy");
    expect((await openPersonalLink(db, withEmbryo.token))!.pregnancy.how).toBe("day5");
    await expect(createPersonalShare(db, alex, IDS.alex, { recipient: "X", sections: [] })).rejects.toThrow(/at least one/);
  });

  it("its data file is valid FHIR with provenance and consent, and each download is recorded", async () => {
    const made = await createPersonalShare(db, alex, IDS.alex, { recipient: "New clinic", sections: ["results", "meds", "visits"] });
    const s = (await openPersonalSummary(db, sha(made.token), "fhir"))!;
    const b = recordToFhirBundle({ ...s, patient: { name: s.patient } });
    expect(checkFhirBundle(b)).toEqual([]);
    const types = (b.entry as { resource: { resourceType: string } }[]).map((e) => e.resource.resourceType);
    expect(types).toEqual(expect.arrayContaining(["Patient", "Observation", "MedicationStatement", "Provenance", "Consent"]));
    expect(JSON.stringify(b)).toContain('"code":"2243-4"'); // Alex's estradiol carries its LOINC code
    await openPersonalSummary(db, sha(made.token), "pdf");
    const log = (await db.query<{ action: string }>(`SELECT action FROM audit_events WHERE detail->>'shareId' = $1 ORDER BY id`, [made.id])).rows.map((r) => r.action);
    expect(log).toEqual(expect.arrayContaining(["summary.downloaded_data", "summary.downloaded_pdf"]));
    await stopSummaryShare(db, alex, made.id);
    expect(await openPersonalSummary(db, sha(made.token), "fhir")).toBeNull();
  });

  it("lab results get their LOINC code on the way in, whoever adds them", async () => {
    await addResult(db, alex, IDS.alex, { test: "AMH", value: 2.4, unit: "ng/mL", collectedOn: "2026-10-01" });
    const r = await db.query<{ analyte: string; loinc: string | null }>(`SELECT analyte, loinc FROM lab_results WHERE patient_id = $1`, [IDS.alex]);
    expect(r.rows.find((x) => x.analyte === "amh")?.loinc).toBe("38476-3");
    expect(r.rows.find((x) => x.analyte === "estradiol")?.loinc).toBe("2243-4");
  });

  it("she can download her whole record as FHIR, and the download is recorded", async () => {
    const rec = await myRecordForFhir(db, alex, IDS.alex);
    expect(checkFhirBundle(recordToFhirBundle(rec))).toEqual([]);
    await expect(myRecordForFhir(db, maria, IDS.alex)).rejects.toThrow();
  });
});
