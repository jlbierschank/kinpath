import { beforeEach, describe, expect, it } from "vitest";
import { parseHl7 } from "@kinpath/core";
import {
  addPatient, asActor, bookAppointment, cancelAppointment, confirmRecord, devOutbox, IDS, importRecords, migrate, openDb, patientDirectory,
  patientResults, recordsToReview, requestSignInCode, seed, startCycle, updatePatient, upcomingAppointments, type Db,
} from "../src";

const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const, name: "Kara Diaz" };
const sam = { userId: IDS.sam, clinicId: IDS.bayside, role: "financial_counselor" as const, name: "Sam" };
const lee = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" as const, name: "Lee Grant, RN" };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const jordan = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" as const };

let db: Db;
let scheduler: { userId: string; clinicId: string; role: "scheduler"; name: string };
beforeEach(async () => {
  db = await openDb(); await migrate(db); await seed(db, new Date());
  const u = await db.query<{ id: string }>(`INSERT INTO app_users (clinic_id, role, display_name, email) VALUES ('bayside','scheduler','Jo Front Desk','jo@bayside.example') RETURNING id`);
  scheduler = { userId: u.rows[0]!.id, clinicId: IDS.bayside, role: "scheduler", name: "Jo Front Desk" };
});

const ymd = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); };
const ana = () => addPatient(db, maria, { firstName: "Ana", lastName: "López", mrn: "BF-100300", contact: "(813) 555-0199", lang: "es", cycle: { kind: "ivf", startedOn: ymd(-2) } });

describe("adding patients", () => {
  it("a nurse adds a patient with her cycle; she gets a welcome and can sign in", async () => {
    const { patientId } = await ana();
    const dir = await patientDirectory(db, maria);
    expect(dir.find((p) => p.id === patientId)).toMatchObject({ name: "Ana López", mrn: "BF-100300", contact: "8135550199", lang: "es", stage: "stimulation", cycleKind: "ivf" });
    const welcome = (await devOutbox(db, 5)).find((o) => o.to_address === "8135550199")!;
    expect(welcome.subject).toBe("Bayside Fertility te invitó a Pumpkin");
    expect(welcome.body).not.toMatch(/IVF|ciclo|cycle/i); // no health details outside the app
    expect(await requestSignInCode(db, "813-555-0199")).toEqual({ sentTo: "•••0199" });
  });

  it("refuses a repeated MRN or sign-in contact, and bad input", async () => {
    await ana();
    await expect(addPatient(db, maria, { firstName: "B", lastName: "C", mrn: "BF-100300", contact: "b@example.com" })).rejects.toThrow(/already has this medical record number/);
    await expect(addPatient(db, maria, { firstName: "B", lastName: "C", contact: "813.555.0199" })).rejects.toThrow(/already signs in/);
    await expect(addPatient(db, maria, { firstName: "B", lastName: "C", contact: "nope" })).rejects.toThrow(/mobile number or email/);
    await expect(addPatient(db, maria, { firstName: "B", lastName: "C", mrn: "has spaces", contact: "b@example.com" })).rejects.toThrow(/letters, numbers and dashes/);
  });

  it("schedulers add patients but only nurses and physicians start cycles; admins and others can't add", async () => {
    const { patientId } = await addPatient(db, scheduler, { firstName: "Lia", lastName: "Park", contact: "lia@example.com" });
    await expect(addPatient(db, scheduler, { firstName: "X", lastName: "Y", contact: "x@example.com", cycle: { kind: "ivf", startedOn: ymd() } })).rejects.toThrow(/nurse or physician/);
    await expect(startCycle(db, scheduler, patientId, { kind: "iui", startedOn: ymd() })).rejects.toThrow(/nurse or physician/);
    await startCycle(db, maria, patientId, { kind: "iui", startedOn: ymd() });
    expect((await patientDirectory(db, maria)).find((p) => p.id === patientId)!.cycleKind).toBe("iui");
    await expect(addPatient(db, kara, { firstName: "X", lastName: "Y", contact: "x@example.com" })).rejects.toThrow(/Only nurses, physicians and schedulers/);
    await expect(addPatient(db, sam, { firstName: "X", lastName: "Y", contact: "x@example.com" })).rejects.toThrow(/Only nurses, physicians and schedulers/);
  });

  it("edits the MRN, contact and language; other clinics can't touch her", async () => {
    await updatePatient(db, maria, IDS.priya, { mrn: "BF-200000", lang: "en" });
    expect((await patientDirectory(db, maria)).find((p) => p.id === IDS.priya)).toMatchObject({ mrn: "BF-200000", lang: "en" });
    await expect(updatePatient(db, maria, IDS.priya, { mrn: "BF-100231" })).rejects.toThrow(/already has/);
    await expect(updatePatient(db, lee, IDS.maya, { mrn: "X-1" })).rejects.toThrow(/isn't in this clinic/);
  });
});

describe("appointments", () => {
  const at = (days: number, h = 8) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };

  it("staff book a visit; Maya and Jordan (she shares her schedule) see it; canceling removes it", async () => {
    const { id } = await bookAppointment(db, scheduler, { patientId: IDS.maya, startsAt: at(2), kind: "monitoring", location: "Bayside Tampa" });
    const mine = await upcomingAppointments(db, maya, IDS.maya);
    expect(mine[0]).toMatchObject({ title: "Monitoring visit", location: "Bayside Tampa", status: "booked", source: "staff" });
    expect(await upcomingAppointments(db, jordan, IDS.maya)).toHaveLength(1);
    const n = await db.query<{ title: string }>(`SELECT title FROM notifications WHERE user_id = $1 AND kind = 'schedule_changed'`, [IDS.mayaUser]);
    expect(n.rows.map((x) => x.title)).toContain("You have a new appointment.");
    await cancelAppointment(db, maria, id);
    expect(await upcomingAppointments(db, maya, IDS.maya)).toHaveLength(0);
  });

  it("a support person without schedule access sees none, and the financial counselor can't book", async () => {
    await asActor(db, maya, (tx) => tx.query(`UPDATE partner_grants SET sections = ARRAY['meds'] WHERE patient_id = $1`, [IDS.maya]));
    await bookAppointment(db, maria, { patientId: IDS.maya, startsAt: at(1), kind: "blood_test" });
    expect(await upcomingAppointments(db, jordan, IDS.maya)).toHaveLength(0);
    await expect(bookAppointment(db, sam, { patientId: IDS.maya, startsAt: at(1), kind: "consult" })).rejects.toThrow(/Only nurses/);
  });
});

describe("HL7 v2 and appointments from the records system", () => {
  const bayside = { clinicId: IDS.bayside, keyId: null, format: "hl7" as const };
  const today = ymd().replace(/-/g, "");

  it("a lab time with no zone is read as clinic time, so the stimulation day is right", async () => {
    const oru = [
      "MSH|^~\\&|LIS|BAYSIDE|PUMPKIN|BAYSIDE|202610260800||ORU^R01|M1|P|2.5.1",
      "PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya",
      "OBR|1||FL-1|||" + today + "0745",
      "OBX|1|NM|2243-4^Estradiol^LN||455|pg/mL|||||F",
    ].join("\r");
    expect(await importRecords(db, bayside, parseHl7(oru))).toMatchObject({ resultsAdded: 1 });
    const e2 = (await patientResults(db, maya, IDS.maya)).find((x) => x.value === 455)!;
    // The seed's dates move a day ahead in the evening, so compare with Maya's actual cycle start.
    const started = (await db.query<{ d: number }>(`SELECT ((now() AT TIME ZONE 'America/New_York')::date - started_on) + 1 AS d FROM cycles WHERE patient_id = $1`, [IDS.maya])).rows[0]!.d;
    expect(e2.stimDay).toBe(Number(started));
    expect(e2.label.status).toBe("in_range");
  });

  it("booking, rescheduling and canceling flow through to Maya's app", async () => {
    const tomorrow = ymd(1).replace(/-/g, "");
    const siu = (ev: string, hhmm: string) => [
      `MSH|^~\\&|SCHED|BAYSIDE|PUMPKIN|BAYSIDE|202610261000||SIU^${ev}|S-${ev}-${hhmm}|P|2.5.1`,
      "SCH|PA-1|FA-1", "PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya",
      `AIS|1||US^Monitoring ultrasound and blood work|${tomorrow}${hhmm}`,
    ].join("\r");
    expect(await importRecords(db, bayside, parseHl7(siu("S12", "0730")))).toMatchObject({ appointments: 1 });
    let mine = await upcomingAppointments(db, maya, IDS.maya);
    expect(mine).toHaveLength(1);
    expect(new Date(mine[0]!.startsAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })).toBe("7:30 AM");
    expect(mine[0]).toMatchObject({ kind: "monitoring", source: "records" });
    expect(await importRecords(db, bayside, parseHl7(siu("S12", "0730")))).toMatchObject({ duplicates: 1 });
    await importRecords(db, bayside, parseHl7(siu("S13", "0900")));
    mine = await upcomingAppointments(db, maya, IDS.maya);
    expect(new Date(mine[0]!.startsAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })).toBe("9:00 AM");
    await importRecords(db, bayside, parseHl7(siu("S15", "0900")));
    expect(await upcomingAppointments(db, maya, IDS.maya)).toHaveLength(0);
  });

  it("an appointment for an unknown MRN waits for a nurse, who places it", async () => {
    const siu = ["MSH|^~\\&|SCHED|BAYSIDE|PUMPKIN|BAYSIDE|202610261000||SIU^S12|S9|P|2.5.1", "SCH|PA-9|FA-9",
      "PID|1||BF-000000^^^BAYSIDE^MR||Torres^Maya", `AIS|1||C^Follow-up consult|${ymd(3).replace(/-/g, "")}1000`].join("\r");
    expect(await importRecords(db, bayside, parseHl7(siu))).toMatchObject({ toReview: 1 });
    const [item] = await recordsToReview(db, maria);
    expect(item!.kind).toBe("appointment");
    await confirmRecord(db, maria, item!.id, { patientId: IDS.maya });
    expect((await upcomingAppointments(db, maya, IDS.maya))[0]).toMatchObject({ title: "Follow-up consult", kind: "consult" });
  });
});
