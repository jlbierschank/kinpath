import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvite, asActor, cancelInvite, createInvite, IDS, migrate, openDb, partnerHome, patientSharing, removeSupportPerson, seed, sendPartnerNote,
  type Actor, type Db,
} from "../src";

const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const priya: Actor = { userId: IDS.priyaUser, clinicId: IDS.bayside, role: "patient" };
const jordan: Actor = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" };
const maria: Actor = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" };
const NOW = new Date("2026-10-26T09:00:00-04:00");
const mom = { name: "Rosa Torres", relationship: "family", contact: "rosa@example.com", sections: ["schedule"] };

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  await seed(db);
});

describe("inviting a support person", () => {
  it("Maya invites her mom, who accepts with the code and sees only what Maya chose", async () => {
    const inv = await createInvite(db, maya, IDS.maya, mom);
    expect(inv.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await patientSharing(db, maya, IDS.maya)).invites.map((i) => i.name)).toEqual(["Rosa Torres"]);

    const rosa = await acceptInvite(db, inv.code.toLowerCase().replace("-", " "), "Rosa");
    expect(rosa.patientFirstName).toBe("Maya");
    const h = await partnerHome(db, { userId: rosa.userId, clinicId: rosa.clinicId, role: "partner" }, NOW);
    expect(h.shared && h.sections).toEqual(["schedule"]);
    expect(h.shared && h.schedule).toBeNull(); // injections weren't shared with her

    const s = await patientSharing(db, maya, IDS.maya);
    expect(s.invites).toEqual([]);
    expect(s.partners.map((p) => [p.name, p.relationship])).toEqual([["Jordan Torres", "partner"], ["Rosa", "family"]]);
  });

  it("works once only, and not after it's canceled or expired", async () => {
    const a = await createInvite(db, maya, IDS.maya, mom);
    await acceptInvite(db, a.code, "Rosa");
    await expect(acceptInvite(db, a.code, "Someone else")).rejects.toThrow(/didn't work/);

    const b = await createInvite(db, maya, IDS.maya, { ...mom, contact: "+1 (813) 555-0142" });
    await cancelInvite(db, maya, b.id);
    await expect(acceptInvite(db, b.code, "Rosa")).rejects.toThrow(/didn't work/);

    const c = await createInvite(db, maya, IDS.maya, { ...mom, contact: "friend@example.com" });
    await db.query(`UPDATE support_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [c.id]);
    await expect(acceptInvite(db, c.code, "Rosa")).rejects.toThrow(/didn't work/);
    await expect(acceptInvite(db, "WRONG-CODE", "Rosa")).rejects.toThrow(/didn't work/);
  });

  it("never stores the code itself", async () => {
    const a = await createInvite(db, maya, IDS.maya, mom);
    const r = await db.query(`SELECT * FROM support_invites`);
    expect(JSON.stringify(r.rows)).not.toContain(a.code.replace("-", ""));
  });

  it("refuses messages, bad contacts, and anyone but the patient", async () => {
    await expect(createInvite(db, maya, IDS.maya, { ...mom, sections: ["messages"] })).rejects.toThrow(/private/);
    await expect(createInvite(db, maya, IDS.maya, { ...mom, sections: [] })).rejects.toThrow(/at least one/);
    await expect(createInvite(db, maya, IDS.maya, { ...mom, contact: "rosa" })).rejects.toThrow(/mobile number or an email/);
    await expect(createInvite(db, jordan, IDS.maya, mom)).rejects.toThrow();
    await expect(createInvite(db, maria, IDS.maya, mom)).rejects.toThrow();
    await expect(createInvite(db, priya, IDS.maya, mom)).rejects.toThrow(); // RLS: not her record
  });

  it("keeps invites private to Maya and won't let her change one except to cancel it", async () => {
    const a = await createInvite(db, maya, IDS.maya, mom);
    const count = (x: Actor) => asActor(db, x, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM support_invites`)).rows[0]!.n);
    expect(await count(maya)).toBe(1);
    expect(await count(jordan)).toBe(0);
    expect(await count(maria)).toBe(0);
    await expect(asActor(db, maya, (tx) => tx.query(`UPDATE support_invites SET sections = ARRAY['results'] WHERE id = $1`, [a.id]))).rejects.toThrow();
  });

  it("caps support people at five", async () => {
    for (let i = 0; i < 4; i++) await createInvite(db, maya, IDS.maya, { ...mom, contact: `p${i}@example.com` });
    await expect(createInvite(db, maya, IDS.maya, { ...mom, contact: "p9@example.com" })).rejects.toThrow(/up to 5/);
  });

  it("won't connect the same phone or email twice", async () => {
    const a = await createInvite(db, maya, IDS.maya, mom);
    await acceptInvite(db, a.code, "Rosa");
    const b = await createInvite(db, maya, IDS.maya, mom);
    await expect(acceptInvite(db, b.code, "Rosa")).rejects.toThrow(/already connected/);
  });
});

describe("removing a support person", () => {
  it("ends Jordan's access right away and takes him off Maya's list", async () => {
    await removeSupportPerson(db, maya, IDS.maya, IDS.jordan);
    expect((await partnerHome(db, jordan, NOW)).shared).toBe(false);
    await expect(sendPartnerNote(db, { ...jordan, name: "Jordan Torres" }, "hi")).rejects.toThrow();
    expect((await patientSharing(db, maya, IDS.maya)).partners).toEqual([]);
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'patient.removed_support_person'`);
    expect(n.rows[0]!.n).toBe(1);
  });
});
