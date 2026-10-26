import { beforeEach, describe, expect, it } from "vitest";
import { STAFF_SECTIONS } from "@kinpath/core";
import {
  getReminderPrefs, logDose, medGuide, patientSchedule, setLockScreenDetail,
  asActor, auditLog, draftReply, enterLabResult, handoffDetail, IDS, markReplyRead, migrate, nurseQueue, openDb,
  patientInbox, reportMissedDose, seed, sendPatientMessage, sendReply, type Actor, type Db,
} from "../src";

const maria: Actor & { name: string } = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse", name: "Maria" };
const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const jordan: Actor = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" };
const sam: Actor = { userId: IDS.sam, clinicId: IDS.bayside, role: "financial_counselor" };
const kara: Actor = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" };
const priya: Actor = { userId: IDS.priyaUser, clinicId: IDS.bayside, role: "patient" };
const lee: Actor = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" };

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  await seed(db);
});

async function missedDoseId(): Promise<string> {
  const r = await asActor(db, maya, (tx) => tx.query<{ id: string }>(`SELECT id FROM dose_logs WHERE taken_at IS NULL AND scheduled_for < now() ORDER BY scheduled_for LIMIT 1`));
  return r.rows[0]!.id;
}
const count = (a: Actor, sql: string) => asActor(db, a, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) q`)).rows[0]!.n);

describe("authorization walls (merge gate)", () => {
  it("keeps clinics apart: Harbor's nurse sees nothing of Bayside", async () => {
    expect(await count(lee, "SELECT * FROM patients")).toBe(1);
    expect(await count(lee, `SELECT * FROM dose_logs WHERE patient_id = '${IDS.maya}'`)).toBe(0);
    expect(await count(lee, "SELECT * FROM app_users WHERE clinic_id = 'bayside'")).toBe(0);
  });

  it("a patient sees only herself", async () => {
    expect(await count(maya, "SELECT * FROM patients")).toBe(1);
    expect(await count(priya, `SELECT * FROM dose_logs WHERE patient_id = '${IDS.maya}'`)).toBe(0);
  });

  it("a partner sees only what was shared (schedule and meds), never results or messages", async () => {
    expect(await count(jordan, "SELECT * FROM dose_logs")).toBe(13);
    expect(await count(jordan, "SELECT * FROM cycles")).toBe(1);
    await enterLabResult(db, maria, { patientId: IDS.maya, analyte: "estradiol", unit: "pg/mL", value: 612, stimDay: 6 });
    expect(await count(jordan, "SELECT * FROM lab_results")).toBe(0);
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "Private question for Maria" });
    expect(await count(jordan, "SELECT * FROM handoffs")).toBe(0);
  });

  it("loses partner access the moment Maya revokes it", async () => {
    await asActor(db, maya, (tx) => tx.query(`UPDATE partner_grants SET revoked_at = now() WHERE partner_user_id = $1`, [IDS.jordan]));
    expect(await count(jordan, "SELECT * FROM dose_logs")).toBe(0);
  });

  it("a partner cannot grant himself more access", async () => {
    await expect(asActor(db, jordan, (tx) => tx.query(`UPDATE partner_grants SET sections = ARRAY['results'] WHERE partner_user_id = $1`, [IDS.jordan])))
      .resolves.toMatchObject({ affectedRows: 0 });
  });

  it("financial counselors and admins don't see clinical sections", async () => {
    expect(await count(sam, "SELECT * FROM dose_logs")).toBe(0);
    expect(await count(kara, "SELECT * FROM dose_logs")).toBe(0);
    expect(await count(sam, "SELECT * FROM cycles")).toBeGreaterThan(0);
  });

  it("only clinicians can enter results", async () => {
    await expect(enterLabResult(db, sam, { patientId: IDS.maya, analyte: "estradiol", unit: "pg/mL", value: 600, stimDay: 6 })).rejects.toThrow();
  });

  it("the audit log can't be edited or deleted, even by an admin", async () => {
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "hello" });
    await expect(asActor(db, kara, (tx) => tx.query(`DELETE FROM audit_events`))).rejects.toThrow();
    await expect(asActor(db, kara, (tx) => tx.query(`UPDATE audit_events SET action = 'x'`))).rejects.toThrow();
    expect((await auditLog(db, kara)).length).toBeGreaterThan(0);
    expect(await count(maria, "SELECT * FROM audit_events")).toBe(0); // nurses can't read it
  });

  it("the database's staff matrix matches the app's", async () => {
    for (const [role, sections] of Object.entries(STAFF_SECTIONS)) {
      const r = await db.query<{ s: string[] }>(`SELECT kp_staff_sections($1) AS s`, [role]);
      expect(r.rows[0]!.s.sort()).toEqual([...sections].sort());
    }
  });

  it("a patient can only mark a reply read, not rewrite it", async () => {
    const { handoffId } = await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "question" });
    await sendReply(db, maria, handoffId, "Answer.");
    await expect(asActor(db, maya, (tx) => tx.query(`UPDATE handoffs SET sent_text = 'forged', status = 'read' WHERE id = $1`, [handoffId]))).rejects.toThrow();
  });
});

describe("the missed-dose loop, end to end", () => {
  it("goes from Maya's report to Maria's queue to a read reply", async () => {
    const dose = await missedDoseId();
    const r = await reportMissedDose(db, maya, { patientId: IDS.maya, doseLogId: dose });
    expect(r.kind).toBe("missed_dose");

    const queue = await nurseQueue(db, maria);
    expect(queue.map((q) => q.id)).toContain(r.handoffId);

    const detail = await handoffDetail(db, maria, r.handoffId);
    expect(detail!.doseLog.some((d) => d.medication === "Gonal-f" && d.reportedMissed)).toBe(true);

    const draft = await draftReply(db, maria, r.handoffId);
    expect(draft.source).toBe("meds.missed_dose.gonal_f");
    expect(draft.draft).toMatch(/^Hi Maya,/);

    await sendReply(db, maria, r.handoffId, draft.draft);
    const inbox = await patientInbox(db, maya, IDS.maya);
    expect(inbox[0]!.sentText).toContain("Drafted with The Pumpkin, reviewed by Maria.");
    expect(await markReplyRead(db, maya, r.handoffId)).toBe(true);
    expect((await nurseQueue(db, maria)).map((q) => q.id)).not.toContain(r.handoffId);
  });

  it("puts urgent notes at the top and refuses to draft them", async () => {
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "When is my scan?" });
    const dose = await missedDoseId();
    const r = await reportMissedDose(db, maya, { patientId: IDS.maya, doseLogId: dose, note: "missed it, and I'm bloated and short of breath" });
    expect(r.kind).toBe("urgent_symptom");
    const queue = await nurseQueue(db, maria);
    expect(queue[0]!.id).toBe(r.handoffId);
    await expect(draftReply(db, maria, r.handoffId)).rejects.toThrow(/never drafted/);
  });

  it("drafts in Spanish for a Spanish-speaking patient", async () => {
    const { handoffId } = await sendPatientMessage(db, priya, { patientId: IDS.priya, text: "¿Puedo tomar café?" });
    const d = await draftReply(db, maria, handoffId);
    expect(d.draft).toMatch(/^Hola Priya/);
  });

  it("routes an out-of-range result to the nurse with no explanation", async () => {
    const r = await enterLabResult(db, maria, { patientId: IDS.maya, analyte: "progesterone", unit: "ng/mL", value: 1.8, stimDay: 6 });
    expect(r.label.status).toBe("above_range");
    expect(r.label.explanation).toBeUndefined();
    expect((await nurseQueue(db, maria)).some((q) => q.kind === "result_review")).toBe(true);
    // The nurse's internal task never shows up in the patient's inbox.
    expect((await patientInbox(db, maya, IDS.maya)).some((m) => m.kind === "result_review")).toBe(false);
  });
});

describe("phone app data", () => {
  it("splits tonight's doses from the one Maya missed", async () => {
    const s = await patientSchedule(db, maya, IDS.maya, new Date("2026-10-26T09:00:00-04:00"));
    expect(s.missed.map((d) => d.medication)).toEqual(["Gonal-f"]);
    expect(s.upcoming.length).toBeGreaterThanOrEqual(3);
  });
  it("lets Maya log her own dose once, but not Jordan", async () => {
    const s = await patientSchedule(db, maya, IDS.maya, new Date("2026-10-26T09:00:00-04:00"));
    const tonight = s.upcoming[0]!.id;
    await expect(logDose(db, jordan, tonight)).rejects.toThrow();
    expect(await logDose(db, maya, tonight)).toBe(true);
    await expect(logDose(db, maya, tonight)).rejects.toThrow(/already logged/);
  });
  it("serves the nurse-approved walkthrough in both languages", async () => {
    const g = await medGuide(db, maya, "Menopur");
    expect(g!.approved_by).toBe("Maria Lopez, RN");
    expect(g!.steps.length).toBe(6);
    expect(g!.steps[0]!.es).toMatch(/Lávate/);
  });
  it("keeps medication names off the lock screen until Maya turns it on", async () => {
    expect((await getReminderPrefs(db, maya, IDS.maya)).lockScreenDetail).toBe(false);
    await setLockScreenDetail(db, maya, IDS.maya, true);
    expect((await getReminderPrefs(db, maya, IDS.maya)).lockScreenDetail).toBe(true);
    await expect(setLockScreenDetail(db, jordan, IDS.maya, false)).rejects.toThrow();
  });
});
