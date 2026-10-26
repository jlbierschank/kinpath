import { beforeEach, describe, expect, it } from "vitest";
import {
  addTerm, asActor, IDS, markNoteSeen, migrate, openDb, partnerHome, patientSharing, seed, sendPartnerNote, setPartnerSharing,
  type Actor, type Db,
} from "../src";

const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const priya: Actor = { userId: IDS.priyaUser, clinicId: IDS.bayside, role: "patient" };
const jordan = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" as const, name: "Jordan Torres" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const lee: Actor = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" };
const NOW = new Date("2026-10-26T09:00:00-04:00");

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  await seed(db);
});

describe("partner home", () => {
  it("shows Jordan only what Maya shares (schedule and medications by default)", async () => {
    const h = await partnerHome(db, jordan, NOW);
    if (!h.shared) throw new Error("expected sharing");
    expect(h.firstName).toBe("Maya");
    expect(h.sections.sort()).toEqual(["meds", "schedule"]);
    expect(h.stimDay).toBe(6);
    expect(h.schedule!.upcoming.length).toBeGreaterThanOrEqual(3);
    expect(h.results).toBeNull();
  });

  it("adds results only when Maya turns them on, and shows nothing when she stops sharing", async () => {
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, ["schedule", "meds", "results"]);
    const h = await partnerHome(db, jordan, NOW);
    expect(h.shared && h.results).toEqual([]);
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, []);
    expect((await partnerHome(db, jordan, NOW)).shared).toBe(false);
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, ["meds"]);
    const back = await partnerHome(db, jordan, NOW);
    expect(back.shared && back.sections).toEqual(["meds"]);
    expect(back.shared && back.stimDay).toBeNull(); // schedule is off, so the cycle day is hidden
  });

  it("never lets anyone share care-team messages, and only Maya changes sharing", async () => {
    await expect(setPartnerSharing(db, maya, IDS.maya, IDS.jordan, ["messages"])).rejects.toThrow(/private/);
    await expect(setPartnerSharing(db, jordan, IDS.maya, IDS.jordan, ["results"])).rejects.toThrow();
    await expect(setPartnerSharing(db, priya, IDS.maya, IDS.jordan, ["results"])).rejects.toThrow();
  });

  it("records each partner view in the audit log", async () => {
    await partnerHome(db, jordan, NOW);
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'partner.viewed_shared'`);
    expect(n.rows[0]!.n).toBe(1);
  });
});

describe("partner notes", () => {
  it("delivers a note to Maya, who marks it seen", async () => {
    await sendPartnerNote(db, jordan, "So proud of you. I'll set up the meds tonight.");
    const s = await patientSharing(db, maya, IDS.maya);
    expect(s.partners).toEqual([{ userId: IDS.jordan, name: "Jordan Torres", relationship: "partner", sections: ["schedule", "meds"] }]);
    expect(s.notes[0]).toMatchObject({ fromName: "Jordan", body: "So proud of you. I'll set up the meds tonight.", seenAt: null });
    await markNoteSeen(db, maya, s.notes[0]!.id);
    expect((await patientSharing(db, maya, IDS.maya)).notes[0]!.seenAt).not.toBeNull();
  });

  it("keeps notes private from clinic staff, other patients and other clinics", async () => {
    await sendPartnerNote(db, jordan, "Love you");
    const count = (a: Actor) => asActor(db, a, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM partner_notes`)).rows[0]!.n);
    expect(await count(maya)).toBe(1);
    expect(await count(jordan)).toBe(1);
    expect(await count(maria)).toBe(0);
    expect(await count(priya)).toBe(0);
    expect(await count(lee)).toBe(0);
  });

  it("doesn't keep the note's words in the audit log", async () => {
    await sendPartnerNote(db, jordan, "Love you");
    const r = await db.query<{ detail: unknown }>(`SELECT detail FROM audit_events WHERE action = 'partner.sent_note'`);
    expect(JSON.stringify(r.rows)).not.toMatch(/Love you/);
  });

  it("flags an urgent symptom so the app tells Jordan to call, including clinic-added words", async () => {
    expect((await sendPartnerNote(db, jordan, "She has really bad chest pain")).triage.level).toBe("urgent");
    expect((await patientSharing(db, maya, IDS.maya)).notes[0]!.level).toBe("urgent");
    expect((await sendPartnerNote(db, jordan, "Have a good day")).triage.level).toBe("routine");
    await addTerm(db, maria, "dizzy", "urgent");
    expect((await sendPartnerNote(db, jordan, "she's dizzy")).triage.level).toBe("urgent");
  });

  it("stops notes when sharing stops, and Maya can't edit what Jordan wrote", async () => {
    const { id } = await sendPartnerNote(db, jordan, "Love you");
    await expect(asActor(db, maya, (tx) => tx.query(`UPDATE partner_notes SET body = 'changed' WHERE id = $1`, [id]))).rejects.toThrow();
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, []);
    await expect(sendPartnerNote(db, jordan, "Hello?")).rejects.toThrow(/Nothing is shared/);
  });

  it("refuses empty or very long notes", async () => {
    await expect(sendPartnerNote(db, jordan, "  ")).rejects.toThrow();
    await expect(sendPartnerNote(db, jordan, "x".repeat(501))).rejects.toThrow(/500/);
  });
});
