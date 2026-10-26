import { beforeEach, describe, expect, it } from "vitest";
import {
  askForCall, asActor, checkIn, completeTask, enterPregnancyResult, IDS, migrate, nursePatientCycle, nurseTasks, openDb, partnerWait,
  patientNextCycle, patientSchedule, patientWait, recordTransfer, saveNextCyclePlan, releasePregnancyResult, seed, setPartnerSharing, setWaitPrefs, waitDay,
  type Actor, type Db,
} from "../src";

const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const jordan: Actor = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const, name: "Kara Diaz" };
const lee = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" as const, name: "Lee Grant, RN" };

const NOW = new Date();
const daysAgo = (n: number) => { const d = new Date(NOW); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const inDays = (n: number) => { const d = new Date(NOW); d.setDate(d.getDate() + n); d.setHours(8, 0, 0, 0); return d.toISOString(); };

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  await seed(db);
});

const transfer = () => recordTransfer(db, maria, { patientId: IDS.maya, transferOn: daysAgo(5), testAt: inDays(4) });
const result = (outcome: string, note = "Maria's note") => enterPregnancyResult(db, maria, { patientId: IDS.maya, hcg: 142, outcome, note });

describe("recording the transfer", () => {
  it("moves Maya into the wait, cancels the rest of her stim doses and schedules the blood test", async () => {
    const r = await transfer();
    expect(r.canceledDoses).toBe(3); // tonight's Gonal-f, Menopur, Cetrotide
    const w = await patientWait(db, maya, IDS.maya, NOW);
    expect(w.stage).toBe("wait");
    expect(w.dayOfWait).toBe(5);
    expect(w.testAt).toBe(inDays(4));
    expect(w.result).toBeNull();
    expect((await patientSchedule(db, maya, IDS.maya, NOW)).upcoming).toEqual([]);
  });

  it("refuses a transfer date before the cycle started", async () => {
    await expect(recordTransfer(db, maria, { patientId: IDS.maya, transferOn: daysAgo(30), testAt: inDays(4) })).rejects.toThrow(/before the cycle started/);
  });

  it("is for nurses and physicians only", async () => {
    await expect(recordTransfer(db, kara, { patientId: IDS.maya, transferOn: daysAgo(5), testAt: inDays(4) })).rejects.toThrow();
    await expect(recordTransfer(db, { ...maya, name: "Maya" } as never, { patientId: IDS.maya, transferOn: daysAgo(5), testAt: inDays(4) })).rejects.toThrow();
    await expect(recordTransfer(db, lee, { patientId: IDS.maya, transferOn: daysAgo(5), testAt: inDays(4) })).rejects.toThrow(/No active cycle/);
  });

  it("counts the day after transfer as day 1", () => {
    expect(waitDay("2026-10-21", new Date(2026, 9, 26, 9))).toBe(5);
    expect(waitDay("2026-10-26", new Date(2026, 9, 26, 9))).toBe(1);
  });
});

describe("the result", () => {
  beforeEach(async () => { await transfer(); });

  it("stays hidden from Maya until a nurse releases it", async () => {
    await result("positive");
    expect((await patientWait(db, maya, IDS.maya, NOW)).result).toBeNull();
    const direct = await asActor(db, maya, async (tx) => (await tx.query(`SELECT * FROM pregnancy_tests`)).rows.length);
    expect(direct).toBe(0);
    const viaView = await asActor(db, maya, async (tx) => (await tx.query<{ outcome: string | null; hcg: string | null }>(`SELECT * FROM kp_pregnancy_test_view($1)`, [IDS.maya])).rows[0]);
    expect(viaView).toMatchObject({ outcome: null, hcg: null });
  });

  it("needs a phone call first when Maya asked for one (the default), alone or with Jordan", async () => {
    await result("positive");
    await expect(releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: false })).rejects.toThrow(/by phone/);
    await setWaitPrefs(db, maya, IDS.maya, { resultHow: "together" });
    await expect(releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: false })).rejects.toThrow(/with her partner/);
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
    const w = await patientWait(db, maya, IDS.maya, NOW);
    expect(w.result).toMatchObject({ outcome: "positive", hcg: 142, note: "Maria's note", by: "Maria Lopez, RN" });
    expect(w.stage).toBe("result");
    expect(w.quietUntil).toBeNull();
  });

  it("goes straight to the app when Maya chose that", async () => {
    await setWaitPrefs(db, maya, IDS.maya, { resultHow: "app" });
    await result("positive");
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: false });
    expect((await patientWait(db, maya, IDS.maya, NOW)).result?.outcome).toBe("positive");
  });

  it("can't be released without an outcome and a note, and is never decided from the number", async () => {
    await expect(releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true })).rejects.toThrow(/Enter the result/);
    await expect(enterPregnancyResult(db, maria, { patientId: IDS.maya, hcg: 142, outcome: "", note: "x" })).rejects.toThrow(/outcome/);
    await expect(enterPregnancyResult(db, maria, { patientId: IDS.maya, hcg: 142, outcome: "positive", note: " " })).rejects.toThrow(/note/);
  });

  it("is never shown to Jordan, even after release", async () => {
    await result("positive");
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
    const p = await partnerWait(db, jordan, IDS.maya, NOW);
    expect(p).toMatchObject({ testAt: inDays(4), resultIsIn: true });
    const viaView = await asActor(db, jordan, async (tx) => (await tx.query<{ outcome: string | null; hcg: string | null; nurse_note: string | null }>(`SELECT * FROM kp_pregnancy_test_view($1)`, [IDS.maya])).rows[0]);
    expect(viaView).toMatchObject({ outcome: null, hcg: null, nurse_note: null });
    expect(await asActor(db, jordan, async (tx) => (await tx.query(`SELECT * FROM pregnancy_tests`)).rows.length)).toBe(0);
  });

  it("after a negative result, quiets the app for 14 days and puts a follow-up call on the nurse's list", async () => {
    await result("negative", "I'm so sorry, Maya. I'll call you this afternoon.");
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
    const w = await patientWait(db, maya, IDS.maya, NOW);
    expect(w.result?.outcome).toBe("negative");
    const days = (new Date(w.quietUntil!).getTime() - NOW.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect((await nurseTasks(db, maria)).map((t) => t.kind)).toEqual(["negative_followup"]);
    await setWaitPrefs(db, maya, IDS.maya, { quietOff: true });
    expect((await patientWait(db, maya, IDS.maya, NOW)).quietUntil).toBeNull();
  });

  it("doesn't put the hCG value or outcome in the audit log", async () => {
    await result("negative");
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
    const r = await db.query(`SELECT detail FROM audit_events WHERE action LIKE 'result.%pregnancy%'`);
    expect(JSON.stringify(r.rows)).not.toMatch(/142|negative/);
  });

  it("can't be released twice or changed after release", async () => {
    await result("positive");
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
    await expect(releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true })).rejects.toThrow(/already/);
    await expect(result("negative")).rejects.toThrow(/no unreleased test/);
  });
});

describe("the wait, for Maya", () => {
  beforeEach(async () => { await transfer(); });

  it("saves how she wants to hear her result, and the nurse sees it", async () => {
    await setWaitPrefs(db, maya, IDS.maya, { resultHow: "together" });
    expect((await patientWait(db, maya, IDS.maya, NOW)).prefs.resultHow).toBe("together");
    expect((await nursePatientCycle(db, maria, IDS.maya))!.resultHow).toBe("together");
    await expect(setWaitPrefs(db, jordan, IDS.maya, { resultHow: "app" })).rejects.toThrow();
  });

  it("struggling puts a call on Maria's list; okay doesn't; Maya can never read the list", async () => {
    expect((await checkIn(db, maya, IDS.maya, "okay")).nurseWillCall).toBe(false);
    expect(await nurseTasks(db, maria)).toEqual([]);
    expect((await checkIn(db, maya, IDS.maya, "struggling")).nurseWillCall).toBe(true);
    const tasks = await nurseTasks(db, maria);
    expect(tasks.map((t) => [t.patientName, t.kind])).toEqual([["Maya Torres", "wellbeing_call"]]);
    expect((await patientWait(db, maya, IDS.maya, NOW)).checkedInToday).toBe("struggling");
    expect(await asActor(db, maya, async (tx) => (await tx.query(`SELECT * FROM nurse_tasks`)).rows.length)).toBe(0);
    await completeTask(db, maria, tasks[0]!.id, "Called, she's okay. Offered the counselor.");
    expect(await nurseTasks(db, maria)).toEqual([]);
  });

  it("'Talk to someone' asks for a call; patients can't create other kinds of tasks", async () => {
    await askForCall(db, maya, IDS.maya, "rough_day");
    expect((await nurseTasks(db, maria))[0]!.reason).toMatch(/rough day/);
    await expect(asActor(db, maya, (tx) => tx.query(`INSERT INTO nurse_tasks (clinic_id, patient_id, kind, reason) VALUES ('bayside', $1, 'result_call', 'x')`, [IDS.maya]))).rejects.toThrow();
    await expect(askForCall(db, maya, IDS.maya, "anything")).rejects.toThrow();
  });

  it("serves Bayside's approved answers for the wait", async () => {
    const w = await patientWait(db, maya, IDS.maya, NOW);
    expect(w.answers.map((a) => a.title)).toEqual(["Is cramping normal?", "Should I take a home test?"]);
  });

  it("Jordan sees the day and test date only while Maya shares her cycle, and not the day if she hid it", async () => {
    expect((await partnerWait(db, jordan, IDS.maya, NOW)).dayOfWait).toBe(5);
    await setWaitPrefs(db, maya, IDS.maya, { hideDayCount: true });
    expect((await partnerWait(db, jordan, IDS.maya, NOW)).dayOfWait).toBeNull();
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, ["meds"]);
    expect(await partnerWait(db, jordan, IDS.maya, NOW)).toMatchObject({ testAt: null, dayOfWait: null });
  });

  it("check-ins and wait choices are invisible to other clinics", async () => {
    await checkIn(db, maya, IDS.maya, "struggling");
    expect(await nurseTasks(db, lee)).toEqual([]);
    expect(await nursePatientCycle(db, lee, IDS.maya)).toBeNull();
  });
});

describe("when you're ready: next-cycle planning", () => {
  beforeEach(async () => {
    await recordTransfer(db, maria, { patientId: IDS.maya, transferOn: daysAgo(5), testAt: inDays(4), embryosFrozen: 2 });
    await enterPregnancyResult(db, maria, { patientId: IDS.maya, hcg: 2, outcome: "negative", note: "I'm so sorry." });
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
  });

  it("shows Bayside's options and her embryos in storage", async () => {
    const n = await patientNextCycle(db, maya, IDS.maya);
    expect(n.embryosFrozen).toBe(2);
    expect(n.options.map((o) => o.title)).toEqual(["A follow-up visit with your doctor", "A frozen embryo transfer", "Another full IVF cycle"]);
    expect(n.readyAt).toBeNull();
  });

  it("saves her questions privately, and 'ready' puts one call on the nurse's list", async () => {
    await saveNextCyclePlan(db, maya, IDS.maya, { questions: "Should we test the embryos next time?" });
    expect((await nurseTasks(db, maria)).map((t) => t.kind)).toEqual(["negative_followup"]);
    expect((await saveNextCyclePlan(db, maya, IDS.maya, { ready: true })).newlyReady).toBe(true);
    expect((await saveNextCyclePlan(db, maya, IDS.maya, { ready: true })).newlyReady).toBe(false);
    expect((await nurseTasks(db, maria)).map((t) => t.kind)).toEqual(["negative_followup", "next_steps"]);
    const c = await nursePatientCycle(db, maria, IDS.maya);
    expect(c!.nextCycle).toMatchObject({ questions: "Should we test the embryos next time?" });
    expect(c!.embryosFrozen).toBe(2);
    const a = await db.query(`SELECT detail FROM audit_events WHERE action = 'patient.saved_next_cycle_plan'`);
    expect(JSON.stringify(a.rows)).not.toContain("embryos next time");
  });

  it("is private from support people and other clinics", async () => {
    await saveNextCyclePlan(db, maya, IDS.maya, { questions: "x" });
    expect(await asActor(db, jordan, async (tx) => (await tx.query(`SELECT * FROM next_cycle_plans`)).rows.length)).toBe(0);
    await expect(saveNextCyclePlan(db, jordan, IDS.maya, { ready: true })).rejects.toThrow();
    expect(await asActor(db, lee, async (tx) => (await tx.query(`SELECT * FROM next_cycle_plans`)).rows.length)).toBe(0);
  });
});
