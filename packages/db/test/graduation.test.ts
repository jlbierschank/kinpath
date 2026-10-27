import { beforeEach, describe, expect, it } from "vitest";
import {
  asActor, createSummaryShare, enterPregnancyResult, graduatePatient, IDS, migrate, nurseQueue, openDb, openSummary, partnerHome, partnerNews,
  patientGraduation, recordTransfer, releasePregnancyResult, saveKeepsake, seed, sendThankYou, setPartnerSharing, shareNews, stopSummaryShare, thankYouNotes,
  type Actor, type Db,
} from "../src";

const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const, name: "Maya Torres" };
const jordan: Actor = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const, name: "Kara Diaz" };
const NOW = new Date();
const ago = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const soon = () => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toISOString(); };

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  await seed(db, NOW);
  await recordTransfer(db, maria, { patientId: IDS.maya, transferOn: ago(2), testAt: soon() });
});

async function positive() {
  await enterPregnancyResult(db, maria, { patientId: IDS.maya, hcg: 142, outcome: "positive", note: "Congratulations!" });
  await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
}

describe("graduation", () => {
  it("happens only after a released positive result, by a nurse or physician", async () => {
    await expect(graduatePatient(db, maria, { patientId: IDS.maya, obName: "Dr. Ana Reyes" })).rejects.toThrow(/released positive/);
    await enterPregnancyResult(db, maria, { patientId: IDS.maya, hcg: 142, outcome: "positive", note: "Congratulations!" });
    await expect(graduatePatient(db, maria, { patientId: IDS.maya, obName: "Dr. Ana Reyes" })).rejects.toThrow(/released positive/);
    await releasePregnancyResult(db, maria, { patientId: IDS.maya, toldByPhone: true });
    await expect(graduatePatient(db, kara, { patientId: IDS.maya, obName: "Dr. Ana Reyes" })).rejects.toThrow();
    await graduatePatient(db, maria, { patientId: IDS.maya, obName: "Dr. Ana Reyes" });
    const g = await patientGraduation(db, maya, IDS.maya);
    expect(g.ob).toBe("Dr. Ana Reyes");
    const started = (await db.query<{ n: number }>(`SELECT (current_date - started_on)::int + 1 AS n FROM cycles WHERE id = $1`, [IDS.mayaCycle])).rows[0]!.n;
    expect(g.days).toBe(started); // counted from the cycle's start through graduation day
    expect(g.keepsake.items.find((i) => i.id === "injections")!.injections).toBe(9);
  });

  it("saves the keepsake with the parts she left out", async () => {
    await positive();
    await graduatePatient(db, maria, { patientId: IDS.maya, obName: "Dr. Ana Reyes" });
    await saveKeepsake(db, maya, IDS.maya, ["wait", "nonsense"]);
    const g = await patientGraduation(db, maya, IDS.maya);
    expect(g.keepsake).toMatchObject({ saved: true, hidden: ["wait"] });
  });
});

describe("the OB-GYN summary link", () => {
  beforeEach(async () => { await positive(); await graduatePatient(db, maria, { patientId: IDS.maya, obName: "Dr. Ana Reyes" }); });

  it("shows only what Maya chose, counts each view, and logs it", async () => {
    const s = await createSummaryShare(db, maya, IDS.maya, { recipient: "Dr. Ana Reyes", includeResults: true, includeMeds: false });
    const sum = await openSummary(db, s.token);
    expect(sum).toMatchObject({ patient: "Maya Torres", clinic: "Bayside Fertility", recipient: "Dr. Ana Reyes", meds: null });
    expect(sum!.tests).toEqual([expect.objectContaining({ hcg: 142, outcome: "positive" })]);
    expect(sum!.cycle.ob).toBe("Dr. Ana Reyes");
    await openSummary(db, s.token);
    const g = await patientGraduation(db, maya, IDS.maya);
    expect(g.shares[0]).toMatchObject({ recipient: "Dr. Ana Reyes", views: 2, active: true });
    const a = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'summary.viewed_by_link'`);
    expect(a.rows[0]!.n).toBe(2);
  });

  it("includes medications only when she says so", async () => {
    const s = await createSummaryShare(db, maya, IDS.maya, { recipient: "Dr. Ana Reyes", includeResults: false, includeMeds: true });
    const sum = await openSummary(db, s.token);
    expect(sum!.tests).toBeNull();
    expect(sum!.labs).toBeNull();
    expect(sum!.meds!.map((m) => m.medication)).toEqual(["Cetrotide", "Gonal-f", "Menopur"]);
  });

  it("stops working when she stops it, when it expires, or with a wrong token", async () => {
    const s = await createSummaryShare(db, maya, IDS.maya, { recipient: "Dr. Ana Reyes", includeResults: true, includeMeds: true });
    await stopSummaryShare(db, maya, s.id);
    expect(await openSummary(db, s.token)).toBeNull();
    const t = await createSummaryShare(db, maya, IDS.maya, { recipient: "Dr. Ana Reyes", includeResults: true, includeMeds: true });
    await db.query(`UPDATE summary_shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, [t.id]);
    expect(await openSummary(db, t.token)).toBeNull();
    expect(await openSummary(db, "not-a-real-token-at-all-xyz")).toBeNull();
    expect(await openSummary(db, "'; drop table patients; --")).toBeNull();
  });

  it("never stores the link's token, and only Maya can create or change a link", async () => {
    const s = await createSummaryShare(db, maya, IDS.maya, { recipient: "Dr. Ana Reyes", includeResults: true, includeMeds: true });
    expect(JSON.stringify((await db.query(`SELECT * FROM summary_shares`)).rows)).not.toContain(s.token);
    await expect(createSummaryShare(db, { ...jordan }, IDS.maya, { recipient: "x", includeResults: true, includeMeds: true })).rejects.toThrow();
    await expect(asActor(db, maya, (tx) => tx.query(`UPDATE summary_shares SET expires_at = now() + interval '1 year' WHERE id = $1`, [s.id]))).rejects.toThrow();
    expect(await asActor(db, maria, async (tx) => (await tx.query(`SELECT * FROM summary_shares`)).rows.length)).toBe(0);
  });
});

describe("Maya decides when her support people hear the news", () => {
  beforeEach(async () => { await positive(); await graduatePatient(db, maria, { patientId: IDS.maya, obName: "Dr. Ana Reyes" }); });

  it("Jordan sees neither the result nor graduation until Maya shares it", async () => {
    expect(await partnerNews(db, jordan, IDS.maya)).toBeNull();
    const before = await partnerHome(db, jordan, NOW);
    expect(before.shared && before.stage).toBe("result"); // not "graduated"
    await shareNews(db, maya, IDS.maya);
    expect(await partnerNews(db, jordan, IDS.maya)).toBe("graduated");
    const after = await partnerHome(db, jordan, NOW);
    expect(after.shared && after.stage).toBe("graduated");
  });

  it("still respects sharing: no cycle sharing, no news", async () => {
    await shareNews(db, maya, IDS.maya);
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, ["meds"]);
    expect(await partnerNews(db, jordan, IDS.maya)).toBeNull();
  });
});

describe("thank-you notes", () => {
  it("reach the care team, but an urgent symptom inside one becomes an urgent message", async () => {
    expect((await sendThankYou(db, maya, IDS.maya, "Maria, thank you for every late-night answer.")).sent).toBe("thanks");
    expect((await thankYouNotes(db, maria)).map((n) => [n.from, n.body])).toEqual([["Maya Torres", "Maria, thank you for every late-night answer."]]);
    expect(await thankYouNotes(db, kara)).toEqual([]);
    const r = await sendThankYou(db, maya, IDS.maya, "Thank you so much. Also I have chest pain today.");
    expect(r).toMatchObject({ sent: "urgent", kind: "urgent_symptom" });
    expect((await nurseQueue(db, maria))[0]!.kind).toBe("urgent_symptom");
  });
});
