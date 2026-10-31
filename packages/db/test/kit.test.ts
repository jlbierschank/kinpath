import { beforeEach, describe, expect, it } from "vitest";
import {
  addMedication, addResult, createPersonalShare, IDS, migrate, openAnySummary, openDb, openSummary, personalShares, saveKit, seed, setMedLastDay, soloToday, stopSummaryShare, type Db,
} from "../src";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const localDay = async (offset = 0) => (await db.query<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'America/New_York')::date + $1::int, 'YYYY-MM-DD') AS d`, [offset])).rows[0]!.d;
const doseDays = async (med: string) => (await db.query<{ d: string }>(
  `SELECT to_char((d.scheduled_for AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS d FROM dose_logs d JOIN med_orders m ON m.id = d.med_order_id
    WHERE m.patient_id = $1 AND m.medication = $2 AND d.canceled_at IS NULL ORDER BY d.scheduled_for`, [IDS.alex, med])).rows.map((r) => r.d);

beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

describe("stage kits", () => {
  it("saves what she ticks off, and it comes back on Today", async () => {
    await saveKit(db, alex, IDS.alex, { consult: { bring: ["insurance", "cycle"], on: await localDay(7) }, tests: { day1: await localDay(-3), done: ["amh"] } });
    const { kit } = await saveKit(db, alex, IDS.alex, { tests: { hidden: ["semen"] } });
    expect(kit.consult.bring).toEqual(["insurance", "cycle"]);
    expect(kit.tests).toMatchObject({ done: ["amh"], hidden: ["semen"], length: 28 });
    expect((await soloToday(db, alex, IDS.alex)).kit.tests.hidden).toEqual(["semen"]);
  });

  it("checks visit notes for urgent symptoms, and still keeps them", async () => {
    const calm = await saveKit(db, alex, IDS.alex, { consult: { notes: "AMH test any day. Call to book HSG on day 7." } });
    expect(calm.urgent).toBeNull();
    const r = await saveKit(db, alex, IDS.alex, { consult: { notes: "Since the visit I have severe pain and heavy bleeding" } });
    expect(r.urgent).toBe("urgent");
    expect(r.kit.consult.notes).toMatch(/severe pain/);
  });

  it("is only for her own space", async () => {
    await expect(saveKit(db, maya, IDS.maya, { tests: { done: ["amh"] } })).rejects.toThrow();
  });
});

describe("a medication's last day", () => {
  it("ends reminders after the day her clinic gives, or adds days up to it", async () => {
    await addMedication(db, alex, IDS.alex, { name: "Progesterone in oil", dose: "1 mL", times: ["20:00"], startsOn: await localDay(0), endsOn: await localDay(9) });
    await setMedLastDay(db, alex, IDS.alex, "Progesterone in oil", await localDay(4));
    expect((await doseDays("Progesterone in oil")).at(-1)).toBe(await localDay(4));
    await setMedLastDay(db, alex, IDS.alex, "Progesterone in oil", await localDay(20));
    const days = await doseDays("Progesterone in oil");
    expect(days.at(-1)).toBe(await localDay(20));
    expect(new Set(days).size).toBe(days.length); // no doubled reminders
    await expect(setMedLastDay(db, alex, IDS.alex, "Progesterone in oil", await localDay(-1))).rejects.toThrow(/today or a later day/);
    await expect(setMedLastDay(db, alex, IDS.alex, "Not a med", await localDay(3))).rejects.toThrow(/isn't in your record/);
  });
});

describe("the summary she shares with her OB", () => {
  it("shows her record with who entered each item, only what she chose, until she stops it", async () => {
    await saveKit(db, alex, IDS.alex, { ob: { conceivedOn: "2026-10-01", how: "day5", obName: "Dr. Ana Reyes" } });
    await addResult(db, alex, IDS.alex, { test: "Beta hCG", value: 212, unit: "mIU/mL", collectedOn: await localDay(-1) });
    await addMedication(db, alex, IDS.alex, { name: "Estradiol", dose: "2 mg", times: ["08:00"], startsOn: await localDay(0), endsOn: await localDay(9) });
    const share = await createPersonalShare(db, alex, IDS.alex, { recipient: "Dr. Ana Reyes", includeResults: true, includeMeds: false });

    expect(await openSummary(db, share.token)).toBeNull(); // the clinic-mode page never opens a personal link
    const s = await openAnySummary(db, share.token);
    if (s?.kind !== "personal") throw new Error("expected a personal summary");
    expect(s.pregnancy).toEqual({ conceivedOn: "2026-10-01", how: null, dueDate: "2027-06-19", ob: "Dr. Ana Reyes" });
    expect(s.results!.find((r) => r.analyte === "hcg")).toMatchObject({ value: 212, by: "you" });
    expect(s.meds).toBeNull();
    expect((await personalShares(db, alex, IDS.alex))[0]).toMatchObject({ recipient: "Dr. Ana Reyes", active: true, views: 1 });

    await stopSummaryShare(db, alex, share.id);
    expect(await openAnySummary(db, share.token)).toBeNull();
    await expect(createPersonalShare(db, maya, IDS.maya, { recipient: "Dr. X", includeResults: true, includeMeds: true })).rejects.toThrow();
  });
});

describe("her visits on someone else's calendar", () => {
  it("gives each person their own link, hides details by default, and stops one without the others", async () => {
    const { addAppointment, calendarFeed, calendarShares, shareCalendar, stopCalendarShare } = await import("../src");
    await addAppointment(db, alex, IDS.alex, { title: "Saline ultrasound", startsAt: `${await localDay(3)}T09:00` });
    const jordan = await shareCalendar(db, alex, IDS.alex, { label: "Jordan" });
    const mom = await shareCalendar(db, alex, IDS.alex, { label: "Mom", detail: true });
    const j = await calendarFeed(db, jordan.token);
    expect(j).toMatch(/SUMMARY:Appointment/);
    expect(j).not.toMatch(/Saline/);
    expect(await calendarFeed(db, mom.token)).toMatch(/SUMMARY:Saline ultrasound/);
    await stopCalendarShare(db, alex, IDS.alex, jordan.id);
    expect(await calendarFeed(db, jordan.token)).toBeNull();
    expect(await calendarFeed(db, mom.token)).not.toBeNull();
    expect((await calendarShares(db, alex, IDS.alex)).map((s) => s.label)).toEqual(["Mom"]);
    await expect(shareCalendar(db, alex, IDS.alex, { label: " " })).rejects.toThrow(/who this is for/);
    await expect(shareCalendar(db, maya, IDS.maya, { label: "Jordan" })).rejects.toThrow();
  });
});
