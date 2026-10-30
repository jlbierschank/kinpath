import { beforeEach, describe, expect, it } from "vitest";
import {
  closeRefill, decideLink, handoffDetail, IDS, joinableClinics, migrate, myLinkRefills, nurseQueue, openDb, patientInbox, pilotMetrics,
  requestClinicLink, requestLinkRefill, requestRefill, seed, updateClinicLink, type Db,
} from "../src";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const };
const sam = { userId: IDS.sam, clinicId: IDS.bayside, role: "financial_counselor" as const };
const lee = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" as const, name: "Lee Grant, RN" };

beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

async function connect(share = { about: true, meds: true }) {
  const [bayside] = await joinableClinics(db, alex, "bays");
  const { id } = await requestClinicLink(db, alex, bayside!.id, share);
  return id;
}

describe("refill requests", () => {
  it("from the clinic's app: lands in the queue, a nurse marks it sent, she sees who did it", async () => {
    const { handoffId, kind } = await requestRefill(db, maya, IDS.maya, { medication: "Menopur", note: "Two vials left." });
    expect(kind).toBe("refill_request");
    const q = (await nurseQueue(db, maria)).find((x) => x.id === handoffId)!;
    expect(q).toMatchObject({ kind: "refill_request", patientMessage: "Refill request: Menopur. Two vials left.", fromHerSpace: false });
    expect(await nurseQueue(db, lee)).toEqual([]);
    await expect(closeRefill(db, { ...kara, name: "Kara" }, handoffId, "sent")).rejects.toThrow();
    await closeRefill(db, maria, handoffId, "sent", "Ready after 3 pm.");
    const inbox = await patientInbox(db, maya, IDS.maya);
    expect(JSON.stringify(inbox)).toContain("Maria Lopez, RN sent your refill to your pharmacy. Ready after 3 pm.");
    await expect(closeRefill(db, maria, handoffId, "sent")).rejects.toThrow(/already handled/);
  });

  it("a note with an urgent symptom becomes an urgent item, never a quiet refill", async () => {
    const r = await requestRefill(db, maya, IDS.maya, { medication: "Menopur", note: "Also I have severe abdominal pain and can't breathe well" });
    expect(r.kind).toBe("urgent_symptom");
    expect((await nurseQueue(db, maria))[0]!.id).toBe(r.handoffId);
  });

  it("needs a medication and a sensible length", async () => {
    await expect(requestRefill(db, maya, IDS.maya, { medication: " " })).rejects.toThrow(/Pick the medication/);
    await expect(requestRefill(db, maya, IDS.maya, { medication: "Menopur", note: "x".repeat(801) })).rejects.toThrow(/too long/);
  });

  it("from her own Pumpkin: only when connected, confirmed, matched and sharing medications", async () => {
    await expect(requestLinkRefill(db, alex, { medication: "Follistim" })).rejects.toThrow(/Connect to your clinic/);
    const id = await connect({ about: true, meds: false });
    await decideLink(db, maria, id, true, IDS.priya);
    await expect(requestLinkRefill(db, alex, { medication: "Follistim" })).rejects.toThrow(/Connect to your clinic/); // meds not shared
    await updateClinicLink(db, alex, id, { share: { meds: true } });
    const { handoffId } = await requestLinkRefill(db, alex, { medication: "Follistim", note: "Last pen." });
    const q = (await nurseQueue(db, maria)).find((x) => x.id === handoffId)!;
    expect(q).toMatchObject({ patientId: IDS.priya, kind: "refill_request", fromHerSpace: true });
    expect((await handoffDetail(db, maria, handoffId))!.fromHerSpace).toBe(true);
    expect(await myLinkRefills(db, alex)).toMatchObject([{ clinicName: "Bayside Fertility", medication: "Follistim", status: "waiting" }]);
    await closeRefill(db, maria, handoffId, "call");
    expect((await myLinkRefills(db, alex))[0]).toMatchObject({ status: "handled", outcome: "Maria Lopez, RN will call you about this refill." });
    await updateClinicLink(db, alex, id, { stop: true });
    await expect(requestLinkRefill(db, alex, { medication: "Follistim" })).rejects.toThrow(/Connect to your clinic/);
  });

  it("an unconfirmed request can't send refills", async () => {
    await connect();
    await expect(requestLinkRefill(db, alex, { medication: "Follistim" })).rejects.toThrow(/Connect to your clinic/);
  });
});

describe("pilot metrics", () => {
  it("counts what happens in Pumpkin, for clinic staff only, and is audited", async () => {
    const before = await pilotMetrics(db, kara, 30);
    const { handoffId } = await requestRefill(db, maya, IDS.maya, { medication: "Menopur" });
    await closeRefill(db, maria, handoffId, "sent");
    const m = await pilotMetrics(db, kara, 30);
    expect(m.refills).toBe(before.refills + 1);
    expect(m.messages.refill_request).toBe((before.messages.refill_request ?? 0) + 1);
    expect(m.medianRefillHours).not.toBeNull();
    expect(m.activeCycles).toBeGreaterThan(0);
    expect(m.days).toBe(30);
    expect(JSON.stringify(m)).not.toMatch(/Maya|Menopur/); // counts only
    await expect(pilotMetrics(db, sam, 30)).rejects.toThrow(/clinic staff only/);
    await expect(pilotMetrics(db, alex, 30)).rejects.toThrow(/clinic staff only/);
    const a = await db.query(`SELECT 1 FROM audit_events WHERE action = 'staff.viewed_pilot_metrics'`);
    expect(a.rows.length).toBe(2); // the two views that were allowed
  });
});
