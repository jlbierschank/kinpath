import { beforeEach, describe, expect, it } from "vitest";
import { totpAt } from "@kinpath/core/server";
import {
  asActor, changePassword, changeRole, completeStaffSetup, confirmTwoStepSetup, createInvite, DEMO_STAFF_PASSWORD, devOutbox, finishJoin, IDS, inviteStaff, markNotificationsRead,
  migrate, myNotifications, myProfile, mySessions, notificationSettings, openDb, partnerHome, requestSignInCode, sendPatientMessage, sendReply, seed, sessionFromToken,
  setDeliverySettings, setNotificationChannels, setStaffActive, signOutOtherDevices, staffSignIn, startJoin, startTwoStepSetup, teamList, updateMyProfile, verifySignInCode, verifyTwoStep,
  type Actor, type Db,
} from "../src";

const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const patel: Actor = { userId: IDS.patel, clinicId: IDS.bayside, role: "physician" };
const kara: Actor = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" };
const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const lee: Actor = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" };

let db: Db;
beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  await seed(db);
});

const lastCode = async (to: string) => {
  const o = await devOutbox(db, 20);
  const m = o.find((x) => x.to_address === to && /\b\d{6}\b/.test(x.body));
  return m!.body.match(/\b(\d{6})\b/)![1]!;
};

async function staffFullySignedIn() {
  const s = await staffSignIn(db, "maria@bayside.example", DEMO_STAFF_PASSWORD);
  expect(s.next).toBe("two_step_setup");
  const setup = await startTwoStepSetup(db, s.token);
  expect(setup.uri).toMatch(/^otpauth:\/\/totp\/Pumpkin:maria%40bayside.example\?secret=/);
  await confirmTwoStepSetup(db, s.token, totpAt(setup.secret, Date.now()));
  return { token: s.token, secret: setup.secret };
}

describe("staff sign-in", () => {
  it("needs the password and then two-step; the session isn't usable until both pass", async () => {
    const s = await staffSignIn(db, "Maria@Bayside.example", DEMO_STAFF_PASSWORD, "Chrome on Mac");
    expect((await sessionFromToken(db, s.token))!.mfaPassed).toBe(false);
    const setup = await startTwoStepSetup(db, s.token);
    await expect(confirmTwoStepSetup(db, s.token, "000000")).rejects.toThrow(/didn't work/);
    await confirmTwoStepSetup(db, s.token, totpAt(setup.secret, Date.now()));
    expect(await sessionFromToken(db, s.token)).toMatchObject({ userId: IDS.maria, role: "nurse", mfaPassed: true, kind: "staff" });

    const again = await staffSignIn(db, "maria@bayside.example", DEMO_STAFF_PASSWORD);
    expect(again.next).toBe("two_step");
    await verifyTwoStep(db, again.token, totpAt(setup.secret, Date.now()));
    expect((await sessionFromToken(db, again.token))!.mfaPassed).toBe(true);
  });

  it("refuses wrong passwords, locks after five tries, and won't sign patients in with a password", async () => {
    for (let i = 0; i < 5; i++) await expect(staffSignIn(db, "maria@bayside.example", "nope")).rejects.toThrow(/don't match/);
    await expect(staffSignIn(db, "maria@bayside.example", DEMO_STAFF_PASSWORD)).rejects.toThrow(/Too many tries/);
    await expect(staffSignIn(db, "maya@example.com", DEMO_STAFF_PASSWORD)).rejects.toThrow(/don't match/);
  });

  it("signs staff out after 30 idle minutes", async () => {
    const { token } = await staffFullySignedIn();
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await sessionFromToken(db, token, later)).toBeNull();
    expect(await sessionFromToken(db, token)).toBeNull(); // revoked, not just idle
  });

  it("changing the password signs out other devices and sends a security notice", async () => {
    const a = await staffFullySignedIn();
    const b = await staffSignIn(db, "maria@bayside.example", DEMO_STAFF_PASSWORD);
    await verifyTwoStep(db, b.token, totpAt(a.secret, Date.now()));
    expect(await mySessions(db, a.token)).toHaveLength(2);
    await expect(changePassword(db, a.token, DEMO_STAFF_PASSWORD, "short")).rejects.toThrow(/12 characters/);
    await changePassword(db, a.token, DEMO_STAFF_PASSWORD, "violet harbor lantern");
    expect(await sessionFromToken(db, b.token)).toBeNull();
    expect(await sessionFromToken(db, a.token)).not.toBeNull();
    expect((await devOutbox(db, 5))[0]!.subject).toBe("Your password for Pumpkin was changed");
  });
});

describe("patient and support-person sign-in", () => {
  it("signs Maya in with a one-time code, without saying whether an account exists", async () => {
    expect(await requestSignInCode(db, "nobody@example.com")).toEqual({ sentTo: "n•••@example.com" });
    await requestSignInCode(db, "maya@example.com");
    const code = await lastCode("maya@example.com");
    await expect(verifySignInCode(db, "maya@example.com", "000000")).rejects.toThrow(/didn't work/);
    const { token } = await verifySignInCode(db, "maya@example.com", code, "iPhone");
    expect(await sessionFromToken(db, token)).toMatchObject({ userId: IDS.mayaUser, kind: "patient", mfaPassed: true });
    await expect(verifySignInCode(db, "maya@example.com", code)).rejects.toThrow(); // used once
  });

  it("support people confirm their phone or email before joining", async () => {
    const inv = await createInvite(db, maya, IDS.maya, { name: "Rosa Torres", relationship: "family", contact: "rosa@example.com", sections: ["schedule"] });
    const s = await startJoin(db, inv.code, "Rosa Torres");
    expect(s).toEqual({ sentTo: "r•••@example.com", patientFirstName: "Maya" });
    await expect(finishJoin(db, inv.code, "000000")).rejects.toThrow(/didn't work/);
    const j = await finishJoin(db, inv.code, await lastCode("rosa@example.com"));
    expect(await sessionFromToken(db, j.token)).toMatchObject({ role: "partner", name: "Rosa Torres" });
    expect((await partnerHome(db, { userId: j.userId, clinicId: j.clinicId, role: "partner" })).shared).toBe(true);
    expect((await myNotifications(db, maya)).items[0]!.title).toBe("Rosa accepted your invite.");
  });

  it("'sign out other devices' ends every other session", async () => {
    await requestSignInCode(db, "maya@example.com");
    const a = await verifySignInCode(db, "maya@example.com", await lastCode("maya@example.com"));
    await requestSignInCode(db, "maya@example.com");
    const b = await verifySignInCode(db, "maya@example.com", await lastCode("maya@example.com"));
    expect(await signOutOtherDevices(db, a.token)).toBe(1);
    expect(await sessionFromToken(db, b.token)).toBeNull();
  });

  it("the app role can never read credentials, sessions, codes or the outbox", async () => {
    for (const t of ["user_credentials", "sessions", "sign_in_codes", "outbox"]) {
      await expect(asActor(db, kara, (tx) => tx.query(`SELECT * FROM ${t}`))).rejects.toThrow();
    }
  });
});

describe("your account and the team", () => {
  it("staff edit their own profile, not their role", async () => {
    await updateMyProfile(db, maria, { name: "Maria Lopez, RN", title: "Lead IVF nurse", signature: "— Maria", lang: "en" });
    expect((await myProfile(db, maria)).title).toBe("Lead IVF nurse");
    await expect(asActor(db, maria, (tx) => tx.query(`UPDATE app_users SET role = 'clinic_admin' WHERE id = $1`, [IDS.maria]))).rejects.toThrow(/own role/);
    await expect(asActor(db, maria, (tx) => tx.query(`UPDATE app_users SET display_name = 'x' WHERE id = $1`, [IDS.patel]))).resolves.toBeDefined();
    expect((await myProfile(db, patel)).name).toBe("Dr. Anil Patel"); // RLS: the update matched no rows
  });

  it("an admin invites a nurse, who sets a password and two-step from the setup link", async () => {
    const r = await inviteStaff(db, kara, { name: "Tess Nguyen", email: "tess@bayside.example", role: "nurse" }, "http://localhost:3000");
    expect(r.link).toMatch(/\/login\/setup\?t=/);
    const t = new URL(r.link).searchParams.get("t")!;
    await expect(completeStaffSetup(db, t, "short")).rejects.toThrow(/12 characters/);
    const s = await completeStaffSetup(db, t, "violet harbor lantern");
    expect(s.next).toBe("two_step_setup");
    await expect(completeStaffSetup(db, t, "violet harbor lantern")).rejects.toThrow(/expired or was already used/);
    const team = await teamList(db, kara);
    expect(team.find((x) => x.email === "tess@bayside.example")).toMatchObject({ role: "nurse", setUp: true, twoStepOn: false, active: true });
  });

  it("only admins manage the team; patients can't be managed there; roles change and are logged", async () => {
    await expect(inviteStaff(db, maria, { name: "x", email: "x@bayside.example", role: "nurse" }, "http://x")).rejects.toThrow(/Only clinic admins/);
    await expect(inviteStaff(db, kara, { name: "x", email: "x@bayside.example", role: "patient" }, "http://x")).rejects.toThrow(/Choose a role/);
    await changeRole(db, kara, IDS.sam, "scheduler");
    expect((await teamList(db, kara)).find((x) => x.id === IDS.sam)!.role).toBe("scheduler");
    await expect(changeRole(db, kara, IDS.kara, "nurse")).rejects.toThrow(/your own role/);
    await expect(asActor(db, kara, (tx) => tx.query(`UPDATE app_users SET role = 'nurse' WHERE id = $1`, [IDS.mayaUser]))).rejects.toThrow(/staff accounts only/);
    expect(await teamList(db, lee).catch((e) => e.message)).toMatch(/Only clinic admins/);
  });

  it("deactivating someone ends their access immediately; the last admin can't be removed", async () => {
    const { token } = await staffFullySignedIn();
    await setStaffActive(db, kara, IDS.maria, false);
    expect(await sessionFromToken(db, token)).toBeNull();
    await expect(staffSignIn(db, "maria@bayside.example", DEMO_STAFF_PASSWORD)).rejects.toThrow();
    await expect(setStaffActive(db, kara, IDS.kara, false)).rejects.toThrow(/yourself/);
    await setStaffActive(db, kara, IDS.maria, true);
    expect((await teamList(db, kara)).find((x) => x.id === IDS.maria)!.active).toBe(true);
  });
});

describe("notifications", () => {
  it("an urgent message alerts every nurse and physician, in the app and by text, with no health details outside the app", async () => {
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "I have chest pain" });
    const n = await myNotifications(db, maria);
    expect(n.unread).toBe(1);
    expect(n.items[0]).toMatchObject({ kind: "urgent_message", urgent: true, title: "Maya Torres · urgent symptom: call now" });
    expect((await myNotifications(db, patel)).unread).toBe(1);
    expect((await myNotifications(db, kara)).unread).toBe(0);
    const out = await devOutbox(db);
    expect(out.filter((o) => o.channel === "push").length).toBe(2);
    expect(JSON.stringify(out)).not.toMatch(/chest|Maya|Torres/);
  });

  it("Maya's reply alert goes only to Maya, and she can mark it read", async () => {
    const m = await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "Can I have coffee?" });
    await sendReply(db, maria, m.handoffId, "One cup a day is fine.");
    const n = await myNotifications(db, maya);
    expect(n.items[0]).toMatchObject({ kind: "nurse_reply", title: "Maria replied to your message." });
    await markNotificationsRead(db, maya, "all");
    expect((await myNotifications(db, maya)).unread).toBe(0);
    expect((await myNotifications(db, lee)).unread).toBe(0);
  });

  it("each person chooses alerts and channels; urgent ones can only be re-routed", async () => {
    await setNotificationChannels(db, maria, "new_message", { push: false, email: true });
    await expect(setNotificationChannels(db, maria, "urgent_message", { push: false, sms: false, email: false })).rejects.toThrow(/at least one way/);
    await setNotificationChannels(db, maria, "urgent_message", { push: false, sms: false, email: true });
    await expect(setNotificationChannels(db, maya, "urgent_message", { email: true })).rejects.toThrow(/isn't one of yours/);
    const s = await notificationSettings(db, maria);
    expect(s.kinds.find((k) => k.kind === "new_message")!.channels).toMatchObject({ push: false, email: true });
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "Question about tonight" });
    const mine = (await devOutbox(db)).filter((o) => o.to_address === "maria@bayside.example" || o.name === "Maria Lopez, RN");
    expect(mine.map((o) => o.channel)).toEqual(["email"]);
  });

  it("quiet hours hold non-urgent alerts until morning; urgent still goes now", async () => {
    await setDeliverySettings(db, maria, { quiet: { on: true, start: "00:00", end: "23:59" } });
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "Question about tonight" });
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "heavy bleeding" });
    const mine = (await devOutbox(db)).filter((o) => o.name === "Maria Lopez, RN");
    expect(mine.find((o) => o.body.startsWith("URGENT"))!.status).toBe("send");
    expect(mine.find((o) => !o.body.startsWith("URGENT"))!.status).toBe("held");
  });

  it("people only ever see their own notifications", async () => {
    await sendPatientMessage(db, maya, { patientId: IDS.maya, text: "I have chest pain" });
    expect(await asActor(db, maya, async (tx) => (await tx.query(`SELECT * FROM notifications`)).rows.length)).toBe(0);
    await expect(asActor(db, maria, (tx) => tx.query(`UPDATE notifications SET title = 'x' WHERE user_id = $1`, [IDS.maria]))).rejects.toThrow(/only be marked read/);
  });
});
