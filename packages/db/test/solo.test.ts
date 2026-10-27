import { beforeEach, describe, expect, it } from "vitest";
import {
  addCapture, addMedication, addResult, asActor, calendarFeed, deleteMyAccount, dismissItem, exportMyData, finishSignup, IDS, itemsToCheck, letIn, migrate,
  newCalendarLink, openDb, receiveForwardedEmail, requestSignInCode, requestSignup, saveItem, seed, sessionFromToken, soloCosts, soloMeds, soloResults, soloToday,
  stopMedication, verifySignup, askMyClinic, type Db, type Extractor,
} from "../src";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const };
const lastMessage = async (to: string) => (await db.query<{ subject: string; body: string }>(`SELECT subject, body FROM outbox WHERE to_address = $1 ORDER BY id DESC LIMIT 1`, [to])).rows[0];
const codeIn = (body: string) => /code is (\d{6})/.exec(body)?.[1] ?? "";
const localDay = async (offset = 0) => (await db.query<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'America/New_York')::date + $1::int, 'YYYY-MM-DD') AS d`, [offset])).rows[0]!.d;

beforeEach(async () => {
  delete process.env.KINPATH_OPEN_SIGNUP;
  db = await openDb(); await migrate(db); await seed(db, new Date());
});

async function signUp(contact: string, first = "Dana") {
  await requestSignup(db, contact);
  const { ticket } = await verifySignup(db, contact, codeIn((await lastMessage(contact))!.body));
  return finishSignup(db, ticket, { firstName: first, stage: "in_cycle", clinicName: "Gulf Coast Fertility", afterHoursPhone: "(813) 555-0111", timeZone: "America/Chicago" }, "test");
}

describe("signing up on your own", () => {
  it("joins the waitlist until it's her turn, with the same answer either way", async () => {
    const r = await requestSignup(db, "casey.new@example.com");
    expect(r.sentTo).toBe("c•••@example.com");
    expect((await lastMessage("casey.new@example.com"))!.subject).toBe("You're on the Pumpkin waitlist");
    await requestSignup(db, "casey.new@example.com");
    expect((await db.query(`SELECT 1 FROM outbox WHERE to_address = 'casey.new@example.com'`)).rows).toHaveLength(1); // told once
    await expect(verifySignup(db, "casey.new@example.com", "123456")).rejects.toThrow(/waitlist/);
  });

  it("once let in, gets a code, sets up her space and is signed in", async () => {
    await requestSignup(db, "casey.new@example.com");
    expect(await letIn(db, ["casey.new@example.com", "not a contact"])).toEqual({ invited: 1 });
    expect((await lastMessage("casey.new@example.com"))!.subject).toBe("It's your turn on Pumpkin");
    const out = await signUp("casey.new@example.com");
    const s = (await sessionFromToken(db, out.token))!;
    expect(s).toMatchObject({ role: "patient", name: "Dana" });
    const space = (await db.query<{ kind: string; timezone: string }>(`SELECT kind, timezone FROM clinics WHERE id = $1`, [s.clinicId])).rows[0];
    expect(space).toEqual({ kind: "personal", timezone: "America/Chicago" });
    const pid = (await db.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [s.userId])).rows[0]!.id;
    const today = await soloToday(db, s, pid);
    expect(today.profile).toMatchObject({ firstName: "Dana", stage: "in_cycle", clinicName: "Gulf Coast Fertility", afterHoursPhone: "(813) 555-0111" });
    // Later she signs in like anyone else, with a code.
    await requestSignInCode(db, "casey.new@example.com");
    expect((await lastMessage("casey.new@example.com"))!.subject).toBe("Your Pumpkin sign-in code");
  });

  it("someone who already has an account is told to sign in, not given a second one", async () => {
    await requestSignup(db, "maya@example.com");
    expect((await lastMessage("maya@example.com"))!.subject).toBe("You already have Pumpkin");
  });

  it("demo builds can open sign-up to anyone", async () => {
    process.env.KINPATH_OPEN_SIGNUP = "1";
    const out = await signUp("+18135550177", "Lee");
    expect(out.name).toBe("Lee");
  });
});

describe("her own space stays hers", () => {
  it("clinic staff can't see her, and she can't see the clinic", async () => {
    const seen = await asActor(db, maria, async (tx) => (await tx.query(`SELECT 1 FROM patients WHERE id = $1`, [IDS.alex])).rows);
    expect(seen).toHaveLength(0);
    const hers = await asActor(db, alex, async (tx) => (await tx.query(`SELECT id FROM patients`)).rows);
    expect(hers).toEqual([{ id: IDS.alex }]);
  });

  it("a clinic patient can't add her own meds or results; her clinic does that", async () => {
    await expect(addMedication(db, maya, IDS.maya, { name: "Gonal-f", dose: "225 IU", times: ["20:00"], startsOn: await localDay() })).rejects.toThrow(/clinic keeps/);
    const direct = asActor(db, maya, (tx) => tx.query(`INSERT INTO lab_results (clinic_id, patient_id, analyte, unit, value, collected_at, status, entered_by, source) VALUES ($1,$2,'estradiol','pg/mL',1,now(),'no_range',$3,'patient_upload')`, [IDS.bayside, IDS.maya, IDS.mayaUser]));
    await expect(direct).rejects.toThrow(/row-level security/);
  });
});

describe("meds, results and costs she keeps herself", () => {
  it("adding a medication schedules its doses; stopping cancels the rest", async () => {
    const start = await localDay(1);
    const { id } = await addMedication(db, alex, IDS.alex, { name: "Menopur", dose: "75 IU", times: ["8 pm" as string], startsOn: start, endsOn: await localDay(3) });
    expect((await db.query(`SELECT 1 FROM dose_logs WHERE med_order_id = $1`, [id])).rows).toHaveLength(3);
    expect((await soloMeds(db, alex, IDS.alex)).map((m) => m.medication)).toEqual(["Follistim", "Menopur"]);
    await stopMedication(db, alex, IDS.alex, id);
    expect((await db.query(`SELECT 1 FROM dose_logs WHERE med_order_id = $1 AND canceled_at IS NULL`, [id])).rows).toHaveLength(0);
  });

  it("results show the lab's own range and what the test measures, never a verdict", async () => {
    await addResult(db, alex, IDS.alex, { test: "E2", value: 612, unit: "pg/mL", collectedOn: await localDay(), refText: "Follicular phase 27-433 pg/mL", refLow: 27, refHigh: 433 });
    const groups = await soloResults(db, alex, IDS.alex);
    const e2 = groups.find((g) => g.key === "estradiol")!;
    expect(e2.points.map((p) => p.value)).toEqual([612, 391, 148]);
    expect(e2.points[0]).toMatchObject({ refText: "Follicular phase 27-433 pg/mL", refLow: 27, refHigh: 433 });
    expect(e2.measures).toMatch(/Growing follicles make it/);
    expect(e2.reviewed).toBe(false);
    expect(JSON.stringify(groups)).not.toMatch(/in_range|above_range|below_range|normal/i);
  });

  it("costs: balance, next payment due, and paid this year", async () => {
    const c = await soloCosts(db, alex, IDS.alex);
    expect(c.balanceCents).toBe(613300 - 613400);
    expect(c.nextDue).toMatchObject({ amountCents: 613300, description: "IVF cycle, payment 2 of 3" });
  });

  it("asking her clinic to join stores only the clinic's name", async () => {
    await askMyClinic(db, alex, IDS.alex, "Coastal Fertility");
    expect((await db.query(`SELECT clinic_name FROM clinic_requests`)).rows).toEqual([{ clinic_name: "Coastal Fertility" }]);
  });
});

describe("Add anything", () => {
  it("reads a typed note into items she confirms one by one", async () => {
    const r = await addCapture(db, alex, IDS.alex, { kind: "text", text: "Estradiol 702 pg/mL today\n$250 due Nov 30 for embryo storage" }, { extractor: null });
    expect(r).toMatchObject({ status: "ready", items: 2, engine: "pumpkin-basic" });
    const items = (await itemsToCheck(db, alex, IDS.alex)).filter((i) => i.captureId === r.captureId);
    expect(items.map((i) => i.kind)).toEqual(["result", "cost"]);
    await saveItem(db, alex, IDS.alex, items[0]!.id, null);
    await dismissItem(db, alex, IDS.alex, items[1]!.id);
    expect((await soloResults(db, alex, IDS.alex)).find((g) => g.key === "estradiol")!.points[0]!.value).toBe(702);
    await expect(saveItem(db, alex, IDS.alex, items[1]!.id, null)).rejects.toThrow(/already/);
  });

  it("a medication is never saved until she ticks that she checked it, and her edits win", async () => {
    const pending = (await itemsToCheck(db, alex, IDS.alex)).find((i) => i.kind === "medication")!;
    expect(pending.unsure).toContain("name");
    await expect(saveItem(db, alex, IDS.alex, pending.id, null)).rejects.toThrow(/tick the box/);
    await saveItem(db, alex, IDS.alex, pending.id, { dose: "0.25 mg", endsOn: pending.data.startsOn }, { checked: true });
    expect((await soloMeds(db, alex, IDS.alex)).find((m) => m.medication === "Cetrotide")).toMatchObject({ dose: "0.25 mg", time: "08:00" });
  });

  it("urgent symptoms skip reading and go straight to the urgent screen", async () => {
    const r = await addCapture(db, alex, IDS.alex, { kind: "voice", text: "I have really bad pain in my belly and I can't breathe well" }, { extractor: null });
    expect(r).toMatchObject({ status: "urgent", urgent: "urgent", items: 0 });
  });

  it("photos are read by the AI reader, and kept so she can compare", async () => {
    const seen: string[] = [];
    const fake: Extractor = { name: "fake", read: async (x) => { seen.push(`${x.mime}:${x.base64?.length}`); return [{ kind: "result", data: { test: "AMH", value: 2.9, unit: "ng/mL", collectedOn: x.today }, unsure: [] }]; } };
    const r = await addCapture(db, alex, IDS.alex, { kind: "photo", mime: "image/jpeg", base64: Buffer.from("fake jpeg").toString("base64"), filename: "labs.jpg" }, { extractor: fake });
    expect(r).toMatchObject({ status: "ready", items: 1, engine: "fake" });
    expect(seen).toEqual(["image/jpeg:12"]);
    const item = (await itemsToCheck(db, alex, IDS.alex)).find((i) => i.captureId === r.captureId)!;
    expect(item.source).toMatchObject({ kind: "photo", filename: "labs.jpg", hasFile: true });
  });

  it("without AI reading, a photo waits for her to enter it by hand", async () => {
    const r = await addCapture(db, alex, IDS.alex, { kind: "photo", mime: "image/png", base64: "aGk=" }, { extractor: null });
    expect(r.status).toBe("failed");
    expect(r.problem).toMatch(/add it by hand/);
  });

  it("samples work in the demo", async () => {
    const r = await addCapture(db, alex, IDS.alex, { kind: "sample", sampleId: "payment-plan" }, { extractor: null });
    expect(r).toMatchObject({ status: "ready", items: 3, engine: "sample" });
  });

  it("clinic patients can't use it (their clinic keeps the record)", async () => {
    await expect(addCapture(db, maya, IDS.maya, { kind: "text", text: "Estradiol 400" }, { extractor: null })).rejects.toThrow(/clinic keeps/);
  });

  it("a forwarded email lands as items to check; unknown addresses are ignored", async () => {
    expect(await receiveForwardedEmail(db, { to: "add+nobody99@in.thepumpkin.ai", text: "Estradiol 500 pg/mL" }, { extractor: null })).toEqual({ accepted: false });
    const r = await receiveForwardedEmail(db, { to: "Alex <add+alexdemo01@in.thepumpkin.ai>", subject: "Your appointment", text: "Monitoring ultrasound on Nov 20 at 8:15 am" }, { extractor: null });
    expect(r).toEqual({ accepted: true, items: 1 });
    expect((await itemsToCheck(db, alex, IDS.alex)).some((i) => i.kind === "appointment" && i.source.kind === "email")).toBe(true);
  });
});

describe("calendar, download and delete", () => {
  it("the calendar feed says only 'Appointment' unless she turns on detail", async () => {
    const { token } = await newCalendarLink(db, alex, IDS.alex);
    const ics = (await calendarFeed(db, token))!;
    expect(ics).toMatch(/BEGIN:VCALENDAR/);
    expect(ics).toMatch(/SUMMARY:Appointment\r\n/);
    expect(ics).not.toMatch(/ultrasound/i);
    const detailed = await newCalendarLink(db, alex, IDS.alex, { detail: true });
    expect(await calendarFeed(db, token)).toBeNull(); // the old link stops working
    expect(await calendarFeed(db, detailed.token)).toMatch(/SUMMARY:Monitoring visit: ultrasound and blood work/);
  });

  it("download includes her records but no sign-in secrets", async () => {
    const out = await exportMyData(db, alex);
    expect(Object.keys(out.data)).toEqual(expect.arrayContaining(["patients", "lab_results", "med_orders", "finance_ledger", "personal_profiles"]));
    expect(JSON.stringify(out)).not.toMatch(/token_hash|code_hash/);
    await expect(exportMyData(db, maya)).rejects.toThrow(/clinic keeps/);
  });

  it("delete removes everything in her space and nothing anywhere else", async () => {
    await expect(deleteMyAccount(db, alex, "yes")).rejects.toThrow(/Type "delete"/);
    const before = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lab_results WHERE clinic_id = 'bayside'`)).rows[0]!.n;
    await deleteMyAccount(db, alex, "delete");
    for (const t of ["clinics", "app_users", "patients", "lab_results", "med_orders", "dose_logs", "captures", "audit_events", "personal_profiles"]) {
      const col = t === "clinics" ? "id" : "clinic_id";
      expect((await db.query(`SELECT 1 FROM ${t} WHERE ${col} = $1`, [IDS.alexSpace])).rows, t).toHaveLength(0);
    }
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lab_results WHERE clinic_id = 'bayside'`)).rows[0]!.n).toBe(before);
    await expect(deleteMyAccount(db, maya, "delete")).rejects.toThrow(/clinic keeps/);
  });
});
