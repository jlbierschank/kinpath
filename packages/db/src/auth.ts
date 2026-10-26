/**
 * Real sign-in. Runs as the auth service (outside row-level security), like a separate login
 * system would; everything after sign-in uses asActor and RLS as before.
 *
 * - Staff: email + password, then a 6-digit code from an authenticator app (required).
 *   Signed out after 30 minutes idle and after 12 hours regardless.
 * - Patients and support people: a one-time 6-digit code by text or email. No password.
 *   Stay signed in for 30 days on their own phone, and can sign out other devices.
 * - Five wrong tries in 15 minutes locks that sign-in for 15 minutes.
 * - Tokens are random and only their SHA-256 hash is stored.
 */
import { HandoffError, type Role } from "@kinpath/core";
import { checkPassword, hashPassword, newSignInCode, newToken, newTotpSecret, otpauthUri, sha256, verifyPassword, verifyTotp } from "@kinpath/core/server";
import { audit, type Db } from "./client";
import { sendDirect, notify } from "./notify";
import { acceptInvite, normalizeCode } from "./partner";

export const STAFF_IDLE_MINUTES = 30;
const STAFF_MAX_HOURS = 12;
const PATIENT_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const LOCK_MINUTES = 15;

const isStaff = (r: Role) => r !== "patient" && r !== "partner";
const ident = (s: string) => { const t = s.trim().toLowerCase(); return t.includes("@") ? t : t.replace(/[^0-9+]/g, ""); };
const mask = (s: string) => (s.includes("@") ? s.replace(/^(.).*(@.*)$/, "$1•••$2") : `•••${s.slice(-4)}`);

export interface SignedIn {
  sessionId: string; userId: string; clinicId: string; role: Role; name: string; kind: "staff" | "patient"; mfaPassed: boolean;
}

async function tooManyFailures(db: Db, who: string): Promise<boolean> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM auth_failures WHERE identifier = $1 AND at > now() - interval '${LOCK_MINUTES} minutes'`, [who]);
  return r.rows[0]!.n >= MAX_TRIES;
}
const fail = (db: Db, who: string) => db.query(`INSERT INTO auth_failures (identifier) VALUES ($1)`, [who]);
const LOCKED = `Too many tries. For your security, wait ${LOCK_MINUTES} minutes and try again.`;

async function createSession(db: Db, userId: string, kind: "staff" | "patient", mfaPassed: boolean, device: string | null) {
  const token = newToken();
  const hours = kind === "staff" ? STAFF_MAX_HOURS : PATIENT_DAYS * 24;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, kind, device, mfa_passed, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '${hours} hours')`,
    [sha256(token), userId, kind, device?.slice(0, 120) ?? null, mfaPassed]);
  return token;
}

async function signInAudit(db: Db, userId: string, action: string, detail: Record<string, unknown> = {}) {
  const u = await db.query<{ clinic_id: string }>(`SELECT clinic_id FROM app_users WHERE id = $1`, [userId]);
  if (u.rows[0]) await audit(db as never, { userId, clinicId: u.rows[0].clinic_id, role: "nurse" }, action, null, detail);
}

// ---------- staff ----------

/** Step 1 for staff. Returns a session that still needs the two-step code. */
export async function staffSignIn(db: Db, email: string, password: string, device: string | null = null) {
  const who = ident(email);
  if (await tooManyFailures(db, who)) throw new HandoffError(LOCKED);
  const u = await db.query<{ id: string; role: Role; password_hash: string | null; totp_enabled_at: Date | null }>(
    `SELECT u.id, u.role, c.password_hash, c.totp_enabled_at FROM app_users u LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE lower(u.email) = $1 AND u.deactivated_at IS NULL AND u.role NOT IN ('patient','partner')`, [who]);
  const user = u.rows[0];
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    await fail(db, who);
    throw new HandoffError("That email and password don't match.");
  }
  const token = await createSession(db, user.id, "staff", false, device);
  await signInAudit(db, user.id, "auth.password_ok");
  return { token, next: user.totp_enabled_at ? ("two_step" as const) : ("two_step_setup" as const) };
}

export async function verifyTwoStep(db: Db, token: string, code: string) {
  const s = await rawSession(db, token);
  if (!s || s.kind !== "staff") throw new HandoffError("Please sign in again.");
  if (await tooManyFailures(db, `totp:${s.user_id}`)) throw new HandoffError(LOCKED);
  const c = await db.query<{ totp_secret: string | null; totp_enabled_at: Date | null }>(`SELECT totp_secret, totp_enabled_at FROM user_credentials WHERE user_id = $1`, [s.user_id]);
  const cred = c.rows[0];
  if (!cred?.totp_secret || !cred.totp_enabled_at) throw new HandoffError("Set up two-step sign-in first.");
  if (!verifyTotp(cred.totp_secret, code)) { await fail(db, `totp:${s.user_id}`); throw new HandoffError("That code didn't work. Check your authenticator app and try again."); }
  await db.query(`UPDATE sessions SET mfa_passed = true, last_seen_at = now() WHERE id = $1`, [s.id]);
  await signInAudit(db, s.user_id, "auth.signed_in", { method: "password+totp" });
  return true;
}

/** Starts (or restarts) authenticator setup. The secret isn't active until confirmed with a code. */
export async function startTwoStepSetup(db: Db, token: string) {
  const s = await rawSession(db, token);
  if (!s || s.kind !== "staff") throw new HandoffError("Please sign in again.");
  const secret = newTotpSecret();
  await db.query(
    `INSERT INTO user_credentials (user_id, totp_secret) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET totp_secret = coalesce(user_credentials.totp_secret, EXCLUDED.totp_secret)`,
    [s.user_id, secret]);
  const c = await db.query<{ totp_secret: string; totp_enabled_at: Date | null }>(`SELECT totp_secret, totp_enabled_at FROM user_credentials WHERE user_id = $1`, [s.user_id]);
  if (c.rows[0]!.totp_enabled_at) throw new HandoffError("Two-step sign-in is already on.");
  const email = (await db.query<{ email: string }>(`SELECT email FROM app_users WHERE id = $1`, [s.user_id])).rows[0]!.email;
  return { secret: c.rows[0]!.totp_secret, uri: otpauthUri(c.rows[0]!.totp_secret, email) };
}

export async function confirmTwoStepSetup(db: Db, token: string, code: string) {
  const s = await rawSession(db, token);
  if (!s || s.kind !== "staff") throw new HandoffError("Please sign in again.");
  const c = await db.query<{ totp_secret: string | null; totp_enabled_at: Date | null }>(`SELECT totp_secret, totp_enabled_at FROM user_credentials WHERE user_id = $1`, [s.user_id]);
  if (!c.rows[0]?.totp_secret) throw new HandoffError("Start setup first.");
  if (!verifyTotp(c.rows[0].totp_secret, code)) { await fail(db, `totp:${s.user_id}`); throw new HandoffError("That code didn't work. Make sure you scanned the code on this page, then try the newest code."); }
  await db.query(`UPDATE user_credentials SET totp_enabled_at = now() WHERE user_id = $1`, [s.user_id]);
  await db.query(`UPDATE sessions SET mfa_passed = true WHERE id = $1`, [s.id]);
  await signInAudit(db, s.user_id, "auth.two_step_enabled");
  return true;
}

export async function changePassword(db: Db, token: string, current: string, next: string) {
  const s = await rawSession(db, token);
  if (!s || s.kind !== "staff" || !s.mfa_passed) throw new HandoffError("Please sign in again.");
  const u = await db.query<{ email: string; clinic_id: string; password_hash: string | null }>(
    `SELECT u.email, u.clinic_id, c.password_hash FROM app_users u LEFT JOIN user_credentials c ON c.user_id = u.id WHERE u.id = $1`, [s.user_id]);
  const user = u.rows[0]!;
  if (!user.password_hash || !verifyPassword(current, user.password_hash)) { await fail(db, ident(user.email)); throw new HandoffError("Your current password isn't right."); }
  const why = checkPassword(next, user.email);
  if (why) throw new HandoffError(why);
  await db.query(`UPDATE user_credentials SET password_hash = $2, password_changed_at = now() WHERE user_id = $1`, [s.user_id, hashPassword(next)]);
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [s.user_id, s.id]);
  await sendDirect(db, { clinicId: user.clinic_id, userId: s.user_id, channel: "email", to: user.email, subject: "Your Kinpath password was changed", body: "Your Kinpath password was just changed, and other devices were signed out. If this wasn't you, contact your clinic admin right away." });
  await signInAudit(db, s.user_id, "auth.password_changed");
  return true;
}

/** A new staff member (invited by an admin) sets their password with the setup link. */
export async function completeStaffSetup(db: Db, setupToken: string, password: string, device: string | null = null) {
  const r = await db.query<{ id: string; user_id: string; email: string }>(
    `SELECT s.id, s.user_id, u.email FROM sign_in_codes s JOIN app_users u ON u.id = s.user_id
      WHERE s.code_hash = $1 AND s.purpose = 'setup' AND s.used_at IS NULL AND s.expires_at > now() AND u.deactivated_at IS NULL`, [sha256(setupToken)]);
  const row = r.rows[0];
  if (!row) throw new HandoffError("This setup link has expired or was already used. Ask your clinic admin for a new one.");
  const why = checkPassword(password, row.email);
  if (why) throw new HandoffError(why);
  await db.query(`INSERT INTO user_credentials (user_id, password_hash, password_changed_at) VALUES ($1,$2,now())
                  ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = now()`, [row.user_id, hashPassword(password)]);
  await db.query(`UPDATE sign_in_codes SET used_at = now() WHERE id = $1`, [row.id]);
  await signInAudit(db, row.user_id, "auth.setup_completed");
  return { token: await createSession(db, row.user_id, "staff", false, device), next: "two_step_setup" as const };
}

export async function createStaffSetupLink(db: Db, userId: string, baseUrl: string) {
  const t = newToken();
  await db.query(`INSERT INTO sign_in_codes (purpose, user_id, code_hash, expires_at) VALUES ('setup',$1,$2, now() + interval '72 hours')`, [userId, sha256(t)]);
  const u = (await db.query<{ email: string; clinic_id: string; display_name: string }>(`SELECT email, clinic_id, display_name FROM app_users WHERE id = $1`, [userId])).rows[0]!;
  const link = `${baseUrl.replace(/\/$/, "")}/login/setup?t=${t}`;
  await sendDirect(db, { clinicId: u.clinic_id, userId, channel: "email", to: u.email, subject: "Set up your Kinpath account",
    body: `Hi ${u.display_name.split(" ")[0]}, your clinic added you to Kinpath. Set your password here (the link works for 72 hours): ${link}` });
  return link;
}

// ---------- patients and support people ----------

/** Always answers the same way, so it can't be used to find out who is a patient. */
export async function requestSignInCode(db: Db, identifier: string) {
  const who = ident(identifier);
  if (!who) throw new HandoffError("Enter your mobile number or email.");
  const sent = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sign_in_codes s JOIN app_users u ON u.id = s.user_id WHERE lower(u.email) = $1 AND s.created_at > now() - interval '15 minutes'`, [who]);
  if (sent.rows[0]!.n >= MAX_TRIES) throw new HandoffError(LOCKED);
  const u = await db.query<{ id: string; clinic_id: string; preferred_lang: string }>(
    `SELECT u.id, u.clinic_id, u.preferred_lang FROM app_users u LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE (lower(u.email) = $1 OR s.phone = $1) AND u.role IN ('patient','partner') AND u.deactivated_at IS NULL LIMIT 1`, [who]);
  const user = u.rows[0];
  if (user) {
    const code = newSignInCode();
    await db.query(`INSERT INTO sign_in_codes (purpose, user_id, code_hash, expires_at) VALUES ('sign_in',$1,$2, now() + interval '${CODE_MINUTES} minutes')`, [user.id, sha256(`${user.id}:${code}`)]);
    const clinic = (await db.query<{ name: string }>(`SELECT name FROM clinics WHERE id = $1`, [user.clinic_id])).rows[0]!.name;
    await sendDirect(db, { clinicId: user.clinic_id, userId: user.id, channel: who.includes("@") ? "email" : "sms", to: who,
      subject: `Your ${clinic} sign-in code`,
      body: user.preferred_lang === "es" ? `Tu código para entrar a ${clinic} es ${code}. Vence en ${CODE_MINUTES} minutos. Nadie de la clínica te lo pedirá.` : `Your ${clinic} sign-in code is ${code}. It expires in ${CODE_MINUTES} minutes. No one from the clinic will ever ask you for it.` });
  }
  return { sentTo: mask(who) };
}

export async function verifySignInCode(db: Db, identifier: string, code: string, device: string | null = null) {
  const who = ident(identifier);
  if (await tooManyFailures(db, who)) throw new HandoffError(LOCKED);
  const r = await db.query<{ id: string; user_id: string; attempts: number; code_hash: string }>(
    `SELECT s.id, s.user_id, s.attempts, s.code_hash FROM sign_in_codes s JOIN app_users u ON u.id = s.user_id LEFT JOIN user_settings us ON us.user_id = u.id
      WHERE (lower(u.email) = $1 OR us.phone = $1) AND s.purpose = 'sign_in' AND s.used_at IS NULL AND s.expires_at > now() AND u.deactivated_at IS NULL
      ORDER BY s.created_at DESC LIMIT 1`, [who]);
  const row = r.rows[0];
  const clean = code.replace(/\D/g, "");
  if (!row || row.attempts >= MAX_TRIES || sha256(`${row.user_id}:${clean}`) !== row.code_hash) {
    if (row) await db.query(`UPDATE sign_in_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    await fail(db, who);
    throw new HandoffError("That code didn't work. Check the newest message, or ask for a new code.");
  }
  await db.query(`UPDATE sign_in_codes SET used_at = now() WHERE id = $1`, [row.id]);
  await signInAudit(db, row.user_id, "auth.signed_in", { method: "code" });
  return { token: await createSession(db, row.user_id, "patient", true, device) };
}

// ---------- joining with an invite (support people) ----------

/** Step 1: the invite code is right; send a confirmation code to the phone or email Maya entered. */
export async function startJoin(db: Db, inviteCode: string, name: string) {
  const who = `join:${normalizeCode(inviteCode)}`;
  if (await tooManyFailures(db, who)) throw new HandoffError(LOCKED);
  if (!name.trim() || name.trim().length > 80) throw new HandoffError("Add your name.");
  const inv = await db.query<{ id: string; clinic_id: string; contact: string; patient_first: string }>(
    `SELECT i.id, i.clinic_id, i.contact, p.first_name AS patient_first FROM support_invites i JOIN patients p ON p.id = i.patient_id
      WHERE i.code_hash = $1 AND i.accepted_at IS NULL AND i.canceled_at IS NULL AND i.expires_at > now()`, [sha256(normalizeCode(inviteCode))]);
  const i = inv.rows[0];
  if (!i) { await fail(db, who); throw new HandoffError("That code didn't work. It may have expired or already been used. Ask for a new one."); }
  const code = newSignInCode();
  await db.query(`INSERT INTO sign_in_codes (purpose, invite_id, join_name, code_hash, expires_at) VALUES ('join',$1,$2,$3, now() + interval '${CODE_MINUTES} minutes')`, [i.id, name.trim(), sha256(`${i.id}:${code}`)]);
  const clinic = (await db.query<{ name: string }>(`SELECT name FROM clinics WHERE id = $1`, [i.clinic_id])).rows[0]!.name;
  await sendDirect(db, { clinicId: i.clinic_id, userId: null, channel: i.contact.includes("@") ? "email" : "sms", to: i.contact,
    subject: `Confirm it's you · ${clinic}`, body: `Your confirmation code is ${code}. It expires in ${CODE_MINUTES} minutes.` });
  return { sentTo: mask(i.contact), patientFirstName: i.patient_first };
}

/** Step 2: confirm the code from their phone or email, then create the account and sign them in. */
export async function finishJoin(db: Db, inviteCode: string, confirmCode: string, device: string | null = null) {
  const who = `join:${normalizeCode(inviteCode)}`;
  if (await tooManyFailures(db, who)) throw new HandoffError(LOCKED);
  const r = await db.query<{ id: string; invite_id: string; join_name: string; code_hash: string; attempts: number }>(
    `SELECT s.id, s.invite_id, s.join_name, s.code_hash, s.attempts FROM sign_in_codes s JOIN support_invites i ON i.id = s.invite_id
      WHERE i.code_hash = $1 AND s.purpose = 'join' AND s.used_at IS NULL AND s.expires_at > now() ORDER BY s.created_at DESC LIMIT 1`, [sha256(normalizeCode(inviteCode))]);
  const row = r.rows[0];
  if (!row || row.attempts >= MAX_TRIES || sha256(`${row.invite_id}:${confirmCode.replace(/\D/g, "")}`) !== row.code_hash) {
    if (row) await db.query(`UPDATE sign_in_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    await fail(db, who);
    throw new HandoffError("That code didn't work. Check the newest message, or start again.");
  }
  await db.query(`UPDATE sign_in_codes SET used_at = now() WHERE id = $1`, [row.id]);
  const joined = await acceptInvite(db, inviteCode, row.join_name);
  const token = await createSession(db, joined.userId, "patient", true, device);
  const p = await db.query<{ user_id: string }>(`SELECT p.user_id FROM support_invites i JOIN patients p ON p.id = i.patient_id WHERE i.id = $1`, [row.invite_id]);
  await notify(db, { clinicId: joined.clinicId, kind: "support_joined", title: `${joined.name.split(" ")[0]} accepted your invite.`, to: { userIds: [p.rows[0]!.user_id] } });
  return { ...joined, token };
}

// ---------- sessions ----------

async function rawSession(db: Db, token: string) {
  if (!token) return null;
  const r = await db.query<{ id: string; user_id: string; kind: "staff" | "patient"; mfa_passed: boolean; last_seen_at: Date; expires_at: Date; revoked_at: Date | null }>(
    `SELECT id, user_id, kind, mfa_passed, last_seen_at, expires_at, revoked_at FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  const s = r.rows[0];
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) return null;
  return s;
}

/** Who this token belongs to, or null. Staff sessions end after 30 idle minutes. */
export async function sessionFromToken(db: Db, token: string, now = new Date()): Promise<SignedIn | null> {
  const s = await rawSession(db, token);
  if (!s) return null;
  if (s.kind === "staff" && now.getTime() - new Date(s.last_seen_at).getTime() > STAFF_IDLE_MINUTES * 60_000) {
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [s.id]);
    return null;
  }
  const u = await db.query<{ id: string; clinic_id: string; role: Role; display_name: string; deactivated_at: Date | null }>(
    `SELECT id, clinic_id, role, display_name, deactivated_at FROM app_users WHERE id = $1`, [s.user_id]);
  const user = u.rows[0];
  if (!user || user.deactivated_at) return null;
  if (now.getTime() - new Date(s.last_seen_at).getTime() > 60_000) await db.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [s.id]);
  return { sessionId: s.id, userId: user.id, clinicId: user.clinic_id, role: user.role, name: user.display_name, kind: s.kind, mfaPassed: s.mfa_passed || !isStaff(user.role) };
}

export async function signOut(db: Db, token: string) {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
}

export async function signOutOtherDevices(db: Db, token: string) {
  const s = await rawSession(db, token);
  if (!s) throw new HandoffError("Please sign in again.");
  const r = await db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id`, [s.user_id, s.id]);
  await signInAudit(db, s.user_id, "auth.signed_out_other_devices", { count: r.rows.length });
  return r.rows.length;
}

export async function mySessions(db: Db, token: string) {
  const s = await rawSession(db, token);
  if (!s) return [];
  const r = await db.query<{ id: string; device: string | null; created_at: Date; last_seen_at: Date }>(
    `SELECT id, device, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [s.user_id]);
  return r.rows.map((x) => ({ id: x.id, device: x.device ?? "Unknown device", createdAt: new Date(x.created_at).toISOString(), lastSeenAt: new Date(x.last_seen_at).toISOString(), current: x.id === s.id }));
}

export async function twoStepStatus(db: Db, userId: string) {
  const c = await db.query<{ totp_enabled_at: Date | null; password_changed_at: Date | null }>(`SELECT totp_enabled_at, password_changed_at FROM user_credentials WHERE user_id = $1`, [userId]);
  return { twoStepOn: !!c.rows[0]?.totp_enabled_at, passwordChangedAt: c.rows[0]?.password_changed_at ? new Date(c.rows[0].password_changed_at).toISOString() : null };
}

/** Deactivation ends every session immediately. */
export async function revokeAllSessions(db: Db, userId: string) {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}
