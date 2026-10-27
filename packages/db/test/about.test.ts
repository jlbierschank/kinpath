import { beforeEach, describe, expect, it } from "vitest";
import {
  aboutMe, addQuestion, addTenderDate, asActor, deleteMyAccount, deleteTenderDate, exportMyData, IDS, migrate, openDb, questionIdeas, saveAbout, seed, setAlias,
  setQuiet, soloToday, visitSummary, withdrawAboutConsent, type Db,
} from "../src";
import { suggestedQuestions, tenderOn } from "@kinpath/core";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const jordan = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" as const };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const };
const localToday = async () => (await db.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d`)).rows[0]!.d;

beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

describe("Make Pumpkin yours", () => {
  it("uses the name she chose and her pronouns", async () => {
    await saveAbout(db, alex, IDS.alex, { preferredName: "Lex", pronunciation: "lecks", pronouns: "They/Them" }, { step: "name" });
    const a = await aboutMe(db, alex, IDS.alex);
    expect(a).toMatchObject({ displayName: "Lex", pronouns: "they/them", pronunciation: "lecks" });
    expect(a.stepsLeft).not.toContain("name");
    expect((await soloToday(db, alex, IDS.alex)).about.displayName).toBe("Lex");
  });

  it("identity and health answers need her consent first, and withdrawing clears them", async () => {
    await expect(saveAbout(db, alex, IDS.alex, { familyPath: ["solo_by_choice", "donor_sperm"] })).rejects.toThrow(/tick that it's OK/);
    const a = await saveAbout(db, alex, IDS.alex, { familyPath: ["solo_by_choice", "donor_sperm", "nonsense" as never], conditions: ["pcos"], pastLoss: "yes", allergies: "Latex" }, { consent: true, step: "path" });
    expect(a).toMatchObject({ consented: true, familyPath: ["solo_by_choice", "donor_sperm"], conditions: ["pcos"], pastLoss: "yes", allergies: "Latex" });
    const w = await withdrawAboutConsent(db, alex, IDS.alex);
    expect(w).toMatchObject({ consented: false, familyPath: [], conditions: [], pastLoss: null, allergies: null });
  });

  it("'I'd rather not say' stands alone", async () => {
    expect((await saveAbout(db, alex, IDS.alex, { familyPath: ["prefer_not", "with_partner"] }, { consent: true })).familyPath).toEqual(["prefer_not"]);
  });

  it("her partner's title is her word", async () => {
    const a = await saveAbout(db, alex, IDS.alex, { partnerName: "Sam", partnerTitle: "Wife", partnerPronouns: "she/her" }, { consent: true, step: "person" });
    expect(a).toMatchObject({ partnerName: "Sam", partnerTitle: "wife", partnerPronouns: "she/her" });
    expect((await soloToday(db, alex, IDS.alex)).about.partnerTitle).toBe("wife");
  });

  it("only she can see it: not support people, not clinic staff", async () => {
    await saveAbout(db, maya, IDS.maya, { preferredName: "May", conditions: ["endometriosis"] }, { consent: true });
    for (const who of [jordan, maria]) {
      const rows = await asActor(db, who, async (tx) => (await tx.query(`SELECT * FROM patient_about`)).rows);
      expect(rows).toHaveLength(0);
    }
    await expect(aboutMe(db, jordan, IDS.maya)).rejects.toThrow(/Only you/);
  });
});

describe("How Pumpkin talks to me", () => {
  it("a quiet date makes today quiet; a gentle one just softens it", async () => {
    const [y, m, d] = (await localToday()).split("-").map(Number);
    await addTenderDate(db, alex, IDS.alex, { month: m!, day: d!, label: "A hard anniversary", mode: "gentle" });
    let t = await soloToday(db, alex, IDS.alex);
    expect(t.feel).toMatchObject({ tender: { mode: "gentle", label: "A hard anniversary" }, quiet: false });
    const a = await addTenderDate(db, alex, IDS.alex, { month: m!, day: d!, year: y!, mode: "quiet" });
    t = await soloToday(db, alex, IDS.alex);
    expect(t.feel).toMatchObject({ tender: { mode: "quiet" }, quiet: true });
    for (const x of a.tenderDates) await deleteTenderDate(db, alex, IDS.alex, x.id);
    expect((await soloToday(db, alex, IDS.alex)).feel.tender).toBeNull();
  });

  it("rejects dates that don't exist", async () => {
    await expect(addTenderDate(db, alex, IDS.alex, { month: 2, day: 30 })).rejects.toThrow(/Check the date/);
    await addTenderDate(db, alex, IDS.alex, { month: 2, day: 29 }); // every year: fine
  });

  it("pause and break", async () => {
    await setQuiet(db, alex, IDS.alex, { pauseDays: 3 });
    expect((await soloToday(db, alex, IDS.alex)).feel).toMatchObject({ paused: true, quiet: true });
    await setQuiet(db, alex, IDS.alex, { pauseDays: null, onBreak: true });
    expect((await soloToday(db, alex, IDS.alex)).feel).toMatchObject({ paused: false, onBreak: true, quiet: true });
    await expect(setQuiet(db, alex, IDS.alex, { pauseDays: 90 })).rejects.toThrow(/1 to 30/);
  });

  it("tone, results and cost check-ins are saved", async () => {
    const a = await saveAbout(db, alex, IDS.alex, { tone: "reassure", revealResults: true, costCheckins: "when_due" }, { step: "talk" });
    expect(a).toMatchObject({ tone: "reassure", revealResults: true, costCheckins: "when_due" });
  });
});

describe("community alias", () => {
  it("is unique, and can't contain her real name", async () => {
    await expect(setAlias(db, alex, IDS.alex, { alias: "AlexR" })).rejects.toThrow(/real name/);
    const a = await setAlias(db, alex, IDS.alex, { alias: "Marigold Moon", icon: "heart", tint: "sage", shows: ["stage", "hacker"] });
    expect(a).toMatchObject({ alias: "Marigold Moon", aliasTint: "sage", aliasShows: ["stage"] });
    await expect(setAlias(db, maya, IDS.maya, { alias: "marigold moon" })).rejects.toThrow(/already has that name/);
    await expect(setAlias(db, maya, IDS.maya, { alias: "x" })).rejects.toThrow(/3 to 24/);
  });
});

describe("visit help", () => {
  it("suggests questions for her path and background, skipping ones she has", async () => {
    await saveAbout(db, alex, IDS.alex, { familyPath: ["solo_by_choice"], conditions: ["pcos"] }, { consent: true });
    const ideas = await questionIdeas(db, alex, IDS.alex);
    expect(ideas[0]).toMatch(/PCOS/);
    expect(ideas.some((q) => /sperm donor/.test(q))).toBe(true);
    await addQuestion(db, alex, IDS.alex, ideas[0]!);
    expect(await questionIdeas(db, alex, IDS.alex)).not.toContain(ideas[0]);
    expect(suggestedQuestions({ stage: "in_cycle", paths: [], conditions: [] })).toHaveLength(3);
  });

  it("the visit summary has what she recorded, in plain words", async () => {
    await saveAbout(db, alex, IDS.alex, { preferredName: "Lex", pronouns: "they/them", conditions: ["pcos"], allergies: "Latex", pastCycles: 2 }, { consent: true });
    const s = await visitSummary(db, alex, IDS.alex);
    expect(s).toMatchObject({ name: "Lex", pronouns: "they/them", background: ["PCOS"], allergies: "Latex", pastCycles: 2 });
    expect(s.meds).toEqual(["Follistim 200 IU at 20:00"]);
    expect(s.results.some((r) => /Estradiol: 391 pg\/mL .*lab range Follicular phase 27-433 pg\/mL/.test(r))).toBe(true);
    expect(s.questions).toContain("Can I keep running during stims?");
  });

  it("tender dates pick quiet over gentle", () => {
    expect(tenderOn("2026-05-10", [{ month: 5, day: 10, year: null, mode: "gentle", label: null }, { month: 5, day: 10, year: 2026, mode: "quiet", label: null }])!.mode).toBe("quiet");
    expect(tenderOn("2027-05-10", [{ month: 5, day: 10, year: 2026, mode: "quiet", label: null }])).toBeNull();
  });
});

describe("download and delete include it", () => {
  it("is in her download and gone after delete", async () => {
    await saveAbout(db, alex, IDS.alex, { preferredName: "Lex" });
    await addTenderDate(db, alex, IDS.alex, { month: 5, day: 10 });
    const out = await exportMyData(db, alex);
    expect(out.data.patient_about).toHaveLength(1);
    expect(out.data.tender_dates).toHaveLength(1);
    await deleteMyAccount(db, alex, "delete");
    expect((await db.query(`SELECT 1 FROM patient_about WHERE clinic_id = $1`, [IDS.alexSpace])).rows).toHaveLength(0);
  });
});
