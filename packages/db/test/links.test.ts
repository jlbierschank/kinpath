import { beforeEach, describe, expect, it } from "vitest";
import {
  decideLink, deleteMyAccount, IDS, joinableClinics, linkedNames, linkedSpace, linkedSpaceForChart, linkRequests, matchLink, migrate, myClinicLinks, openDb,
  requestClinicLink, saveAbout, seed, updateClinicLink, addMedication, type Db,
} from "../src";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const };
const sam = { userId: IDS.sam, clinicId: IDS.bayside, role: "financial_counselor" as const };
const lee = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" as const, name: "Lee Grant, RN" };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

async function ask(share = { about: true, meds: true }) {
  const [bayside] = await joinableClinics(db, alex, "bays");
  return requestClinicLink(db, alex, bayside!.id, share);
}

describe("connecting her own space to her clinic", () => {
  it("finds clinics on Pumpkin by name, never personal spaces", async () => {
    expect((await joinableClinics(db, alex, "bays")).map((c) => c.name)).toEqual(["Bayside Fertility"]);
    expect(await joinableClinics(db, alex, "Pumpkin")).toEqual([]);
    expect(await joinableClinics(db, alex, "b")).toEqual([]); // 2 letters at least
    expect(await joinableClinics(db, maya, "bays")).toEqual([]); // only from her own space
  });

  it("she asks, choosing what to share; the clinic sees nothing until a nurse confirms who she is", async () => {
    await saveAbout(db, alex, IDS.alex, { preferredName: "Lex", pronouns: "she/they" });
    await addMedication(db, alex, IDS.alex, { name: "Menopur", dose: "75 IU", times: ["20:00"], startsOn: day(0), endsOn: day(5) });
    const { id } = await ask({ about: true, meds: true });
    expect((await myClinicLinks(db, alex, IDS.alex))[0]).toMatchObject({ clinicName: "Bayside Fertility", status: "requested", share: { about: true, meds: true, results: false } });
    const req = (await linkRequests(db, maria))[0]!;
    expect(req).toMatchObject({ id, legalName: expect.stringContaining("Alex"), status: "requested" });
    expect(await linkedSpace(db, maria, id)).toBeNull(); // not until confirmed
    await expect(ask()).rejects.toThrow(/already asked/);

    await decideLink(db, maria, id, true, IDS.priya); // matched to a chart
    const s = (await linkedSpaceForChart(db, maria, IDS.priya))!;
    expect(s.about).toMatchObject({ preferredName: "Lex", pronouns: "she/they", tone: "facts" });
    expect(s.meds!.map((m) => m.medication)).toEqual(["Follistim", "Menopur"]);
    expect(s.results).toBeNull(); // not shared
    expect(await linkedNames(db, maria)).toEqual({ [IDS.priya]: { preferredName: "Lex", pronouns: "she/they" } });
    expect((await myClinicLinks(db, alex, IDS.alex))[0]).toMatchObject({ status: "active", decidedBy: "Maria Lopez, RN" });
    const viewed = await db.query(`SELECT 1 FROM audit_events WHERE action = 'staff.viewed_linked_space'`);
    expect(viewed.rows.length).toBeGreaterThan(0);
  });

  it("only that clinic's nurses and physicians see it, and only what she shares", async () => {
    const { id } = await ask({ about: true, meds: false });
    expect(await linkRequests(db, lee)).toEqual([]);
    expect(await linkRequests(db, sam)).toEqual([]);
    expect((await linkRequests(db, kara)).length).toBe(1); // admins see the request
    await expect(decideLink(db, { ...kara, name: "Kara" }, id, true, null)).rejects.toThrow(/nurses and physicians/);
    await expect(decideLink(db, lee, id, true, null)).rejects.toThrow();
    await decideLink(db, maria, id, true, null);
    expect(await linkedSpace(db, lee, id)).toBeNull();
    expect((await linkedSpace(db, maria, id))!.meds).toBeNull();
  });

  it("she can change what's shared or stop, and stopping ends access at once", async () => {
    const { id } = await ask({ about: true, meds: false });
    await decideLink(db, maria, id, true, null);
    await matchLink(db, maria, id, IDS.priya);
    await updateClinicLink(db, alex, id, { share: { meds: true } });
    expect((await linkedSpaceForChart(db, maria, IDS.priya))!.meds!.map((m) => m.medication)).toEqual(["Follistim"]);
    await updateClinicLink(db, alex, id, { stop: true });
    expect(await linkedSpaceForChart(db, maria, IDS.priya)).toBeNull();
    expect(await linkedNames(db, maria)).toEqual({});
    await expect(updateClinicLink(db, alex, id, { share: { meds: true } })).rejects.toThrow(/already been handled/);
  });

  it("a declined request shows as declined and she can ask again", async () => {
    const { id } = await ask();
    await decideLink(db, maria, id, false, null);
    expect((await myClinicLinks(db, alex, IDS.alex))[0]!.status).toBe("declined");
    await expect(ask()).resolves.toBeTruthy();
  });

  it("needs at least one thing shared, and is gone if she deletes her account", async () => {
    const [bayside] = await joinableClinics(db, alex, "bays");
    await expect(requestClinicLink(db, alex, bayside!.id, {})).rejects.toThrow(/at least one/);
    const { id } = await ask();
    await decideLink(db, maria, id, true, IDS.priya);
    await deleteMyAccount(db, alex, "delete");
    expect(await linkRequests(db, maria)).toEqual([]);
  });
});
