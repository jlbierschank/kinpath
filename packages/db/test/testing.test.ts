import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvite, addMedication, askMyClinic, createInvite, deleteMyAccount, deliverDue, IDS, migrate, openDb, partnerHome, patientSharing, recentFeedback,
  seed, sendDirect, sendersFromEnv, sendFeedback, setPartnerSharing, type Db, type OutMessage,
} from "../src";

let db: Db;
const alex = { userId: IDS.alexUser, clinicId: IDS.alexSpace, role: "patient" as const };
const alexPid = async () => (await db.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [IDS.alexUser])).rows[0]!.id;

beforeEach(async () => {
  db = await openDb(); await migrate(db); await seed(db, new Date());
});
afterEach(() => { delete process.env.KINPATH_TEAM_EMAIL; });

describe("sending the outbox", () => {
  it("sends email and texts once a provider is set, and leaves the rest alone", async () => {
    await db.query(`DELETE FROM outbox`);
    await sendDirect(db, { clinicId: "pumpkin", userId: null, channel: "email", to: "a@example.com", subject: "Your Pumpkin sign-in code", body: "Your code is 123456" });
    await sendDirect(db, { clinicId: "pumpkin", userId: null, channel: "sms", to: "+18135550100", subject: "Your Pumpkin sign-in code", body: "Your code is 654321" });
    const sent: OutMessage[] = [];
    // Email only: the text stays waiting.
    let r = await deliverDue(db, { email: async (m) => { sent.push(m); } });
    expect(r).toEqual({ sent: 1, failed: 0, retry: 0 });
    expect(sent[0]).toMatchObject({ channel: "email", to: "a@example.com", body: "Your code is 123456" });
    expect((await db.query(`SELECT status FROM outbox ORDER BY id`)).rows.map((x) => (x as { status: string }).status)).toEqual(["sent", "send"]);
    // Nothing is sent twice.
    r = await deliverDue(db, { email: async (m) => { sent.push(m); } });
    expect(r.sent).toBe(0);
  });

  it("retries a failure later, then gives up after five tries", async () => {
    await db.query(`DELETE FROM outbox`);
    await sendDirect(db, { clinicId: "pumpkin", userId: null, channel: "email", to: "b@example.com", subject: "It's your turn on Pumpkin", body: "Hi" });
    let now = new Date();
    for (let i = 1; i <= 5; i++) {
      const r = await deliverDue(db, { email: async () => { throw new Error("Resend said 500 for b@example.com"); } }, now);
      expect(r).toEqual(i < 5 ? { sent: 0, failed: 0, retry: 1 } : { sent: 0, failed: 1, retry: 0 });
      now = new Date(now.getTime() + 3 * 3600_000);
    }
    const row = (await db.query<{ status: string; attempts: number; last_error: string }>(`SELECT status, attempts, last_error FROM outbox`)).rows[0]!;
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect(row.last_error).not.toContain("b@example.com");
  });

  it("doesn't send a sign-in code that's too old to use", async () => {
    await db.query(`DELETE FROM outbox`);
    await sendDirect(db, { clinicId: "pumpkin", userId: null, channel: "email", to: "c@example.com", subject: "Your Pumpkin sign-in code", body: "Your code is 111111" });
    const r = await deliverDue(db, { email: async () => { throw new Error("should not send"); } }, new Date(Date.now() + 45 * 60_000));
    expect(r.failed).toBe(1);
  });

  it("builds Resend, Postmark and Twilio requests, and explains missing settings", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const a = sendersFromEnv({ KINPATH_EMAIL_PROVIDER: "resend", KINPATH_EMAIL_KEY: "re_x", KINPATH_EMAIL_FROM: "Pumpkin <hi@thepumpkin.ai>", KINPATH_SMS_PROVIDER: "twilio", KINPATH_TWILIO_SID: "AC1", KINPATH_TWILIO_TOKEN: "t", KINPATH_SMS_FROM: "+18135550000" }, f);
    expect(a.on).toEqual(["email (Resend)", "texts (Twilio)"]);
    await a.email!({ channel: "email", to: "x@example.com", subject: "S", body: "B" });
    await a.sms!({ channel: "sms", to: "+18135550101", subject: "S", body: "Your code is 1" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "Pumpkin <hi@thepumpkin.ai>", to: ["x@example.com"], subject: "S", text: "B" });
    expect(calls[1]!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(String(calls[1]!.init.body)).toContain("From=%2B18135550000");
    const p = sendersFromEnv({ KINPATH_EMAIL_PROVIDER: "postmark", KINPATH_EMAIL_KEY: "pm", KINPATH_EMAIL_FROM: "hi@thepumpkin.ai" }, f);
    await p.email!({ channel: "email", to: "y@example.com", subject: "S", body: "B" });
    expect(calls[2]!.url).toBe("https://api.postmarkapp.com/email");
    expect(sendersFromEnv({ KINPATH_EMAIL_PROVIDER: "resend" }).problems[0]).toMatch(/KINPATH_EMAIL_KEY/);
    const bad = sendersFromEnv({ KINPATH_EMAIL_PROVIDER: "resend", KINPATH_EMAIL_KEY: "k", KINPATH_EMAIL_FROM: "f" }, (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch);
    await expect(bad.email!({ channel: "email", to: "z@example.com", subject: "S", body: "B" })).rejects.toThrow(/Resend said 422/);
  });
});

describe("testers", () => {
  it("feedback is kept, emailed to the team, and deleted with her account", async () => {
    process.env.KINPATH_TEAM_EMAIL = "team@thepumpkin.ai";
    await expect(sendFeedback(db, alex, { body: "  " })).rejects.toThrow(/few words/);
    await sendFeedback(db, alex, { body: "The Add button is hard to find", screen: "today", appVersion: "web" });
    const fb = await recentFeedback(db);
    expect(fb[0]).toMatchObject({ body: "The Add button is hard to find", screen: "today" });
    const mail = (await db.query<{ subject: string; body: string }>(`SELECT subject, body FROM outbox WHERE to_address = 'team@thepumpkin.ai'`)).rows[0]!;
    expect(mail.subject).toBe("Pumpkin feedback (today)");
    expect(mail.body).toContain("The Add button is hard to find");
    await deleteMyAccount(db, alex, "delete");
    expect(await recentFeedback(db)).toHaveLength(0);
  });

  it("asking her clinic tells the team the clinic's name and count only, and gives her a message to send", async () => {
    process.env.KINPATH_TEAM_EMAIL = "team@thepumpkin.ai";
    const r = await askMyClinic(db, alex, await alexPid(), "Gulf Coast Fertility");
    expect(r.shareText).toContain("Gulf Coast Fertility");
    const mail = (await db.query<{ subject: string; body: string }>(`SELECT subject, body FROM outbox WHERE to_address = 'team@thepumpkin.ai'`)).rows[0]!;
    expect(mail.subject).toBe("A patient asked Gulf Coast Fertility to join Pumpkin");
    expect(mail.body).toContain("so far: 1");
    expect(mail.body).not.toMatch(/Alex|Rivera/);
  });
});

describe("support people for someone on her own", () => {
  it("she invites her person, they join her space and see only what she shares", async () => {
    const pid = await alexPid();
    const day = new Date().toISOString().slice(0, 10);
    await addMedication(db, alex, pid, { name: "Menopur", dose: "75 IU", times: ["20:00"], startsOn: day, endsOn: day, route: null, notes: null } as never);
    const inv = await createInvite(db, alex, pid, { name: "Sam Rivera", relationship: "partner", contact: "sam@example.com", sections: ["schedule"] });
    expect((await patientSharing(db, alex, pid)).invites).toHaveLength(1);
    const joined = await acceptInvite(db, inv.code, "Sam Rivera");
    expect(joined.clinicId).toBe(IDS.alexSpace);
    const sam = { userId: joined.userId, clinicId: joined.clinicId, role: "partner" as const };
    const home = await partnerHome(db, sam);
    expect(home).toMatchObject({ shared: true, firstName: "Alex", schedule: null });
    await setPartnerSharing(db, alex, pid, joined.userId, ["schedule", "meds"]);
    const after = await partnerHome(db, sam);
    expect(after.shared && after.schedule?.upcoming.length).toBeGreaterThan(0);
    // A support person can't add to her record.
    await expect(addMedication(db, sam as never, pid, { name: "X", dose: "1", times: ["08:00"], startsOn: day, endsOn: day, route: null, notes: null } as never)).rejects.toThrow();
  });
});
