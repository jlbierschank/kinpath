import { beforeEach, describe, expect, it } from "vitest";
import { parseFhirBundle, parseResultsCsv } from "@kinpath/core";
import {
  asActor, confirmRecord, createIntegrationKey, dismissRecord, IDS, importRecords, integrationKeys, keyFromToken, migrate, nurseQueue,
  openDb, patientResults, patientSchedule, recordImports, recordsToReview, recordTransfer, revokeIntegrationKey, sampleBundle, seed,
  sendSampleRecords, type Db,
} from "../src";

const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const, name: "Kara Diaz" };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const jordan = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" as const };
const lee = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" as const, name: "Lee Grant, RN" };

let db: Db;
beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const bayside = { clinicId: IDS.bayside, keyId: null, format: "fhir" as const };
const patient = { fullUrl: "urn:uuid:p", resource: { resourceType: "Patient", identifier: [{ value: "BF-100231" }], name: [{ family: "Torres" }] } };
const obs = (id: string, code: string, value: number, unit: string, over: Record<string, unknown> = {}) => ({ resource: {
  resourceType: "Observation", id, status: "final", code: { coding: [{ system: "http://loinc.org", code }] },
  subject: { reference: "urn:uuid:p" }, effectiveDateTime: new Date().toISOString(), valueQuantity: { value, code: unit }, ...over } });
const bundle = (...entry: unknown[]) => parseFhirBundle({ resourceType: "Bundle", type: "collection", entry });
const order = (id: string, status = "active", start = today()) => ({ resource: { resourceType: "MedicationRequest", id, status, intent: "order",
  medicationCodeableConcept: { text: "Ovidrel" }, subject: { reference: "urn:uuid:p" },
  dosageInstruction: [{ timing: { repeat: { timeOfDay: ["23:59:00"], boundsPeriod: { start, end: start } } }, doseAndRate: [{ doseQuantity: { value: 250, unit: "mcg" } }] }] } });

describe("connection keys", () => {
  it("an admin creates a key that works once shown, and can turn it off", async () => {
    const { id, key } = await createIntegrationKey(db, kara, "Epic results feed");
    expect(key).toMatch(/^pk_/);
    expect(await keyFromToken(db, key)).toEqual({ keyId: id, clinicId: IDS.bayside });
    const list = await integrationKeys(db, kara);
    expect(list[0]).toMatchObject({ name: "Epic results feed", hint: key.slice(-4), active: true });
    expect(list[0]!.lastUsedAt).not.toBeNull();
    await revokeIntegrationKey(db, kara, id);
    expect(await keyFromToken(db, key)).toBeNull();
  });

  it("only admins manage keys, and nobody can read a key's hash through the app", async () => {
    await expect(createIntegrationKey(db, maria, "x")).rejects.toThrow(/clinic admin/);
    await createIntegrationKey(db, kara, "Feed");
    await expect(asActor(db, kara, (tx) => tx.query(`SELECT key_hash FROM integration_keys`))).rejects.toThrow();
  });

  it("rejects made-up keys", async () => {
    expect(await keyFromToken(db, "pk_notarealkeyatallnotarealkey")).toBeNull();
    expect(await keyFromToken(db, "hello")).toBeNull();
  });
});

describe("importing results", () => {
  it("adds results, labels them with Bayside's ranges, and sends out-of-range ones to the nurse", async () => {
    const r = await importRecords(db, bayside, bundle(patient, obs("e2", "2243-4", 412, "pg/mL"), obs("p4", "2839-9", 1.9, "ng/mL")));
    expect(r).toMatchObject({ resultsAdded: 2, resultsToNurse: 1, toReview: 0 });
    const mine = await patientResults(db, maya, IDS.maya);
    const e2 = mine.find((x) => x.analyte === "estradiol" && x.value === 412)!;
    // The seed's dates move a day ahead in the evening, so compare with Maya's actual cycle start.
    const started = (await db.query<{ d: number }>(`SELECT ((now() AT TIME ZONE 'America/New_York')::date - started_on) + 1 AS d FROM cycles WHERE patient_id = $1`, [IDS.maya])).rows[0]!.d;
    expect(e2.stimDay).toBe(Number(started));
    expect(e2.label.status).toBe("in_range");
    const q = await nurseQueue(db, maria);
    expect(q.some((h) => h.kind === "result_review" && /progesterone 1.9/.test(h.patientMessage))).toBe(true);
  });

  it("sending the same records again changes nothing", async () => {
    const b = bundle(patient, obs("e2", "2243-4", 412, "pg/mL"));
    await importRecords(db, bayside, b);
    const again = await importRecords(db, bayside, b);
    expect(again).toMatchObject({ resultsAdded: 0, duplicates: 1 });
    expect((await patientResults(db, maya, IDS.maya)).filter((x) => x.value === 412)).toHaveLength(1);
  });

  it("a corrected result replaces the number and tells the nurse it changed", async () => {
    await importRecords(db, bayside, bundle(patient, obs("e2", "2243-4", 412, "pg/mL")));
    const r = await importRecords(db, bayside, bundle(patient, obs("e2", "2243-4", 1150, "pg/mL", { status: "corrected" })));
    expect(r.corrected).toBe(1);
    const mine = await patientResults(db, maya, IDS.maya);
    expect(mine.some((x) => x.value === 412)).toBe(false);
    expect(mine.find((x) => x.value === 1150)!.label.status).toBe("above_range");
    expect((await nurseQueue(db, maria)).some((h) => /Corrected by the records system: estradiol 1150 pg\/mL, was 412/.test(h.patientMessage))).toBe(true);
  });

  it("never guesses: an unknown MRN or a different last name waits for a nurse", async () => {
    const r = await importRecords(db, bayside, bundle(
      obs("a", "2243-4", 500, "pg/mL", { subject: { identifier: { value: "BF-999999" } } }),
      { resource: { ...obs("b", "2243-4", 500, "pg/mL").resource, subject: { reference: "urn:uuid:q" } } },
      { fullUrl: "urn:uuid:q", resource: { resourceType: "Patient", identifier: [{ value: "BF-100231" }], name: [{ family: "Shah" }] } },
    ));
    expect(r).toMatchObject({ resultsAdded: 0, toReview: 2 });
    const list = await recordsToReview(db, maria);
    expect(list.map((x) => x.reason).sort()).toEqual([
      "No patient in Pumpkin has this medical record number.",
      "The last name doesn't match Pumpkin's record for this medical record number.",
    ]);
    // The nurse places one on Maya; the result is added under her name.
    await confirmRecord(db, maria, list.find((x) => x.mrn === "BF-999999")!.id, { patientId: IDS.maya });
    expect((await patientResults(db, maya, IDS.maya)).some((x) => x.value === 500)).toBe(true);
    await dismissRecord(db, maria, (await recordsToReview(db, maria))[0]!.id);
    expect(await recordsToReview(db, maria)).toHaveLength(0);
  });

  it("keeps clinics apart: Harbor's key can't reach Bayside's patients", async () => {
    const r = await importRecords(db, { clinicId: IDS.harbor, keyId: null, format: "fhir" }, bundle(patient, obs("e2", "2243-4", 412, "pg/mL")));
    expect(r).toMatchObject({ resultsAdded: 0, toReview: 1 });
    expect((await patientResults(db, maya, IDS.maya)).some((x) => x.value === 412)).toBe(false);
    expect(await recordsToReview(db, maria)).toHaveLength(0);
    expect(await recordsToReview(db, lee)).toHaveLength(1);
  });

  it("reads a results CSV the same way", async () => {
    const csv = `result_id,mrn,last_name,test,value,unit,collected_at\nr1,BF-100231,Torres,estradiol,388,pg/mL,${new Date().toISOString()}`;
    expect(await importRecords(db, { ...bayside, format: "csv" }, parseResultsCsv(csv))).toMatchObject({ resultsAdded: 1 });
  });
});

describe("pregnancy blood test (hCG)", () => {
  const hcg = (v: number) => bundle(patient, obs(`hcg-${v}`, "21198-7", v, "m[IU]/mL"));
  const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(8, 0, 0, 0); return d.toISOString(); };
  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

  it("waits for a nurse when no test is scheduled", async () => {
    expect(await importRecords(db, bayside, hcg(212))).toMatchObject({ hcgAdded: 0, toReview: 1 });
    expect((await recordsToReview(db, maria))[0]!.reason).toMatch(/No pregnancy test is waiting/);
  });

  it("fills in only the number; the nurse still decides, and Maya sees nothing yet", async () => {
    await recordTransfer(db, maria, { patientId: IDS.maya, transferOn: daysAgo(1), testAt: inDays(8) });
    expect(await importRecords(db, bayside, hcg(212))).toMatchObject({ hcgAdded: 1 });
    const t = (await db.query<{ hcg: string; outcome: string | null; released_at: Date | null }>(`SELECT hcg, outcome, released_at FROM pregnancy_tests WHERE patient_id = $1`, [IDS.maya])).rows[0]!;
    expect(Number(t.hcg)).toBe(212);
    expect(t.outcome).toBeNull();
    expect(t.released_at).toBeNull();
    const view = await asActor(db, maya, async (tx) => (await tx.query<{ released: boolean; hcg: string | null }>(`SELECT * FROM kp_pregnancy_test_view($1)`, [IDS.maya])).rows[0]!);
    expect(view).toMatchObject({ released: false, hcg: null });
  });
});

describe("medication orders", () => {
  it("a new order waits for the nurse; Maya and Jordan don't see it until she confirms", async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const t = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(tomorrow);
    expect(await importRecords(db, bayside, bundle(patient, order("mr-1", "active", t)))).toMatchObject({ ordersWaiting: 1 });
    const seen = (who: typeof maya | typeof jordan) => asActor(db, who, async (tx) => (await tx.query(`SELECT * FROM med_orders WHERE medication = 'Ovidrel'`)).rows.length);
    expect(await seen(maya)).toBe(0);
    expect(await seen(jordan)).toBe(0);
    const [item] = await recordsToReview(db, maria);
    expect(item).toMatchObject({ kind: "med_order", patientName: "Maya Torres", canConfirm: true });
    await confirmRecord(db, maria, item!.id);
    expect(await seen(maya)).toBe(1);
    const s = await patientSchedule(db, maya, IDS.maya);
    expect(s.upcoming.some((d) => d.medication === "Ovidrel" && d.dose === "250 mcg")).toBe(true);
    const n = await db.query<{ title: string }>(`SELECT title FROM notifications WHERE user_id = $1 AND kind = 'schedule_changed'`, [IDS.mayaUser]);
    expect(n.rows[0]!.title).toBe("Your medication schedule was updated.");
  });

  it("a stop from the records system cancels remaining doses once the nurse confirms", async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const t = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(tomorrow);
    await importRecords(db, bayside, bundle(patient, order("mr-1", "active", t)));
    await confirmRecord(db, maria, (await recordsToReview(db, maria))[0]!.id);
    expect(await importRecords(db, bayside, bundle(patient, order("mr-1", "stopped", t)))).toMatchObject({ toReview: 1 });
    await confirmRecord(db, maria, (await recordsToReview(db, maria))[0]!.id);
    const s = await patientSchedule(db, maya, IDS.maya);
    expect(s.upcoming.some((d) => d.medication === "Ovidrel")).toBe(false);
  });

  it("an order missing its time can't be confirmed as is", async () => {
    const o = order("mr-2"); (o.resource.dosageInstruction[0]!.timing.repeat as Record<string, unknown>).timeOfDay = undefined;
    await importRecords(db, bayside, bundle(patient, o));
    const [item] = await recordsToReview(db, maria);
    expect(item!.reason).toMatch(/missing the time/);
    expect(item!.canConfirm).toBe(false);
    await expect(confirmRecord(db, maria, item!.id)).rejects.toThrow(/missing the time/);
  });
});

describe("demo sample and the import log", () => {
  it("the sample shows each path, and sending it twice duplicates nothing", async () => {
    const r = await sendSampleRecords(db, kara);
    expect(r).toMatchObject({ resultsAdded: 2, resultsToNurse: 1, ordersWaiting: 1, appointments: 1, toReview: 1, skipped: 1 });
    expect(await sendSampleRecords(db, kara)).toMatchObject({ resultsAdded: 0, duplicates: 5 });
    const log = await recordImports(db, kara);
    expect(log).toHaveLength(2);
    expect(JSON.stringify(log)).not.toMatch(/Torres|BF-100231|412/);
  });

  it("the admin sees the log but not the records themselves", async () => {
    await sendSampleRecords(db, kara);
    await expect(recordsToReview(db, kara)).rejects.toThrow(/nurses and physicians/);
    expect(await asActor(db, kara, async (tx) => (await tx.query(`SELECT * FROM record_items`)).rows.length)).toBe(0);
    expect(sampleBundle("2026-10-26").entry).toHaveLength(7);
  });
});
