import { beforeEach, describe, expect, it } from "vitest";
import {
  addTerm, asActor, clinicSettings, enterLabResult, IDS, migrate, moveGuide, openDb, patientResults, patientSchedule,
  removeTerm, saveGuide, saveProtocol, saveRange, seed, sendPatientMessage, type Actor, type Db, type Editor,
} from "../src";

const maria: Editor = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse", name: "Maria Lopez, RN" };
const kara: Editor = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin", name: "Kara Diaz" };
const lee: Editor = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse", name: "Lee Grant, RN" };
const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const SEED_NOW = new Date("2026-10-26T09:00:00-04:00");

let db: Db;
beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, SEED_NOW); });

describe("clinic settings", () => {
  it("a nurse's range edit changes what Maya sees, and is recorded", async () => {
    await enterLabResult(db, maria, { patientId: IDS.maya, analyte: "estradiol", unit: "pg/mL", value: 950, stimDay: 6 });
    expect((await patientResults(db, maya, IDS.maya))[0]!.label.status).toBe("above_range");
    const s = await clinicSettings(db, maria);
    const e2 = s.ranges.find((r) => r.analyte === "estradiol")!;
    await saveRange(db, maria, { ...e2, high: 1000 });
    const r = (await patientResults(db, maya, IDS.maya))[0]!;
    expect(r.label.status).toBe("in_range");
    expect(r.label.approvedBy).toBe("Maria Lopez, RN");
    const after = await clinicSettings(db, maria);
    expect(after.changes[0]).toMatchObject({ by: "Maria Lopez, RN", area: "range", action: "updated" });
    expect((after.changes[0]!.before as { high: string }).high).toBe("900");
  });

  it("refuses overlapping or bad ranges", async () => {
    const base = { analyte: "estradiol", unit: "pg/mL", dayFrom: 6, dayTo: 8, low: 300, high: 900, inRangeEn: "Looks as expected today.", inRangeEs: "Se ve como esperamos hoy." };
    await expect(saveRange(db, maria, base)).rejects.toThrow(/overlaps/);
    await expect(saveRange(db, maria, { ...base, dayFrom: 8, dayTo: 9, low: 950 })).rejects.toThrow(/at or below/);
  });

  it("only nurses and physicians can edit; admins can look", async () => {
    await expect(addTerm(db, kara, "dizzy", "urgent")).rejects.toThrow(/Only nurses and physicians/);
    expect((await clinicSettings(db, kara)).canEdit).toBe(false);
    // Even if the app check were bypassed, the database refuses.
    await expect(asActor(db, kara, (tx) => tx.query(`UPDATE clinic_ranges SET high = 1`))).resolves.toMatchObject({ affectedRows: 0 });
  });

  it("another clinic sees none of Bayside's settings", async () => {
    const s = await clinicSettings(db, lee);
    expect(s.ranges).toHaveLength(0);
    expect(s.guides).toHaveLength(0);
  });

  it("a clinic-added urgent word routes Maya's message to the on-call nurse", async () => {
    expect((await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "I feel dizzy" })).kind).toBe("question");
    await addTerm(db, maria, "dizzy", "urgent");
    expect((await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "I feel really dizzy" })).kind).toBe("urgent_symptom");
    const s = await clinicSettings(db, maria);
    await removeTerm(db, maria, s.terms[0]!.id);
    expect((await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "dizzy again" })).kind).toBe("question");
    await expect(addTerm(db, maria, "ok", "urgent")).rejects.toThrow();
  });

  it("walkthrough order follows the nurse's setting", async () => {
    const first = async () => (await patientSchedule(db, maya, IDS.maya, SEED_NOW)).upcoming[0]!.medication;
    expect(await first()).toBe("Gonal-f");
    await moveGuide(db, maria, "Cetrotide", "up");
    await moveGuide(db, maria, "Cetrotide", "up");
    expect(await first()).toBe("Cetrotide");
  });

  it("walkthrough edits need matching English and Spanish and https video", async () => {
    await expect(saveGuide(db, maria, { medication: "Gonal-f", steps: [{ en: "Wash hands", es: "" }], videoUrl: "" })).rejects.toThrow(/Spanish/);
    await expect(saveGuide(db, maria, { medication: "Gonal-f", steps: [{ en: "Wash hands", es: "Lávate" }], videoUrl: "http://x.test/v" })).rejects.toThrow(/https/);
    await saveGuide(db, maria, { medication: "Gonal-f", steps: [{ en: "Wash hands", es: "Lávate las manos" }], videoUrl: "https://videos.example/gonal" });
    const g = (await clinicSettings(db, maria)).guides.find((x) => x.medication === "Gonal-f")!;
    expect(g.steps).toHaveLength(1);
    expect(g.videoUrl).toBe("https://videos.example/gonal");
  });

  it("protocol edits are stored and logged; the change log can't be altered", async () => {
    await saveProtocol(db, maria, { id: "meds.missed_dose.menopur", title: "Missed Menopur dose", bodyEn: "Take it within 4 hours, otherwise skip it and tell us.", bodyEs: "Tómala dentro de 4 horas; si no, sáltala y avísanos." });
    expect((await clinicSettings(db, maria)).protocols.map((p) => p.id)).toContain("meds.missed_dose.menopur");
    await expect(asActor(db, maria, (tx) => tx.query(`DELETE FROM content_changes`))).rejects.toThrow();
    await expect(asActor(db, maria, (tx) => tx.query(`UPDATE content_changes SET item = 'x'`))).rejects.toThrow();
  });
});
