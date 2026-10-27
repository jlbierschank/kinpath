/**
 * Pumpkin on your own. A patient whose clinic isn't on Pumpkin signs up herself (once she's let in
 * from the waitlist), gets a private space, and keeps her own meds, results, visits, costs and
 * questions. Everything runs under the same row-level security as clinic patients; in her own space
 * (and only there) she may add and change records herself.
 */
import { randomUUID } from "node:crypto";
import {
  analyteKey, apptKindOf, cleanItem, cycleForStage, HandoffError, isSoloStage, SOLO_STAGES, testInfo,
  type AppointmentItem, type CostItem, type MedicationItem, type ResultItem, type SoloStage,
} from "@kinpath/core";
import { newSignInCode, newToken, sha256 } from "@kinpath/core/server";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { createSession } from "./auth";
import { sendDirect } from "./notify";
import { contactOf } from "./patients";
import { patientSchedule } from "./loop";

const CODE_MINUTES = 10;
const TICKET_MINUTES = 30;
const MAX_TRIES = 5;
const LOCKED = "Too many tries. For your security, wait 15 minutes and try again.";
const mask = (s: string) => (s.includes("@") ? s.replace(/^(.).*(@.*)$/, "$1•••$2") : `•••${s.slice(-4)}`);
/**
 * Demo builds (synthetic data, KINPATH_DEV_LOGIN=1) skip the waitlist unless KINPATH_OPEN_SIGNUP=0.
 * Real builds let people in from the waitlist in batches (KINPATH_OPEN_SIGNUP=1 opens it to everyone).
 */
export const openSignup = () => process.env.KINPATH_OPEN_SIGNUP === "1" || (process.env.KINPATH_DEV_LOGIN === "1" && process.env.KINPATH_OPEN_SIGNUP !== "0");

// ---------- waitlist and sign-up (the sign-up service, outside row-level security) ----------

async function sendTo(db: Db, contact: { value: string; channel: "email" | "sms" }, subject: string, body: string) {
  await sendDirect(db, { clinicId: "pumpkin", userId: null, channel: contact.channel, to: contact.value, subject, body });
}

/** Adds people to the waitlist (from the app, or imported from the website's list). */
export async function addToWaitlist(db: Db, identifier: string, source: "app" | "site" | "import" = "app") {
  const c = contactOf(identifier);
  if (!c) throw new HandoffError("Enter a mobile number or email.");
  const r = await db.query<{ identifier: string }>(`INSERT INTO early_access (identifier, source) VALUES ($1,$2) ON CONFLICT (identifier) DO NOTHING RETURNING identifier`, [c.value, source]);
  return { added: r.rows.length === 1, contact: c };
}

/** Lets the next batch in: each person gets a message that it's their turn. */
export async function letIn(db: Db, identifiers: string[]) {
  let invited = 0;
  for (const id of identifiers) {
    const c = contactOf(id);
    if (!c) continue;
    const r = await db.query(`INSERT INTO early_access (identifier, source, status, invited_at) VALUES ($1,'import','invited',now())
      ON CONFLICT (identifier) DO UPDATE SET status = 'invited', invited_at = now() WHERE early_access.status = 'waiting' RETURNING identifier`, [c.value]);
    if (!r.rows.length) continue;
    invited++;
    await sendTo(db, c, "It's your turn on Pumpkin",
      "It's your turn. Get the Pumpkin app, choose \"Start on my own\", and use this " + (c.channel === "email" ? "email" : "number") + ". We'll send you a code.");
  }
  return { invited };
}

export async function waitlistCounts(db: Db) {
  const r = await db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM early_access GROUP BY status`);
  return Object.fromEntries(r.rows.map((x) => [x.status, x.n])) as Record<string, number>;
}

/**
 * Step 1. Always answers the same way, so nobody can use it to learn who is on Pumpkin.
 * If it's her turn (or sign-up is open), she gets a code. If she already has an account, she's
 * told to sign in. Otherwise she joins the waitlist (told once).
 */
export async function requestSignup(db: Db, identifier: string) {
  const c = contactOf(identifier);
  if (!c) throw new HandoffError("Enter your mobile number or email.");
  const recent = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM signup_codes WHERE identifier = $1 AND created_at > now() - interval '15 minutes'`, [c.value]);
  if (recent.rows[0]!.n >= MAX_TRIES) throw new HandoffError(LOCKED);
  const existing = await db.query(`SELECT 1 FROM app_users u LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE (lower(u.email) = $1 OR s.phone = $1) AND u.role IN ('patient','partner') AND u.deactivated_at IS NULL LIMIT 1`, [c.value]);
  if (existing.rows[0]) {
    await sendTo(db, c, "You already have Pumpkin", "You already have a Pumpkin account. Open the app and choose Sign in. We'll send you a code.");
    return { sentTo: mask(c.value) };
  }
  const access = await db.query<{ status: string }>(`SELECT status FROM early_access WHERE identifier = $1`, [c.value]);
  if (openSignup() || access.rows[0]?.status === "invited") {
    const code = newSignInCode();
    await db.query(`INSERT INTO signup_codes (identifier, code_hash, expires_at) VALUES ($1,$2, now() + interval '${CODE_MINUTES} minutes')`, [c.value, sha256(`${c.value}:${code}`)]);
    await sendTo(db, c, "Your Pumpkin code", `Your Pumpkin code is ${code}. It expires in ${CODE_MINUTES} minutes. No one from Pumpkin will ever ask you for it.`);
  } else {
    const { added } = await addToWaitlist(db, c.value, "app");
    if (added) await sendTo(db, c, "You're on the Pumpkin waitlist", "Thanks for joining the Pumpkin waitlist. We're letting people in a few at a time, and we'll message you here when it's your turn.");
  }
  return { sentTo: mask(c.value) };
}

/** Step 2: the code checks out. Returns a short-lived ticket to finish setting up. */
export async function verifySignup(db: Db, identifier: string, code: string) {
  const c = contactOf(identifier);
  if (!c) throw new HandoffError("Enter your mobile number or email.");
  const fails = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM auth_failures WHERE identifier = $1 AND at > now() - interval '15 minutes'`, [`signup:${c.value}`]);
  if (fails.rows[0]!.n >= MAX_TRIES) throw new HandoffError(LOCKED);
  const r = await db.query<{ id: string; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM signup_codes WHERE identifier = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [c.value]);
  const row = r.rows[0];
  if (!row || row.attempts >= MAX_TRIES || sha256(`${c.value}:${code.replace(/\D/g, "")}`) !== row.code_hash) {
    if (row) await db.query(`UPDATE signup_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    await db.query(`INSERT INTO auth_failures (identifier) VALUES ($1)`, [`signup:${c.value}`]);
    throw new HandoffError("That code didn't work. Check the newest message, or ask for a new code. If you're on the waitlist, we'll message you when it's your turn.");
  }
  const ticket = newToken();
  await db.query(`UPDATE signup_codes SET used_at = now(), ticket_hash = $2, expires_at = now() + interval '${TICKET_MINUTES} minutes' WHERE id = $1`, [row.id, sha256(ticket)]);
  return { ticket };
}

const validZone = (tz: string | undefined) => {
  if (!tz || tz.length > 60) return "America/New_York";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "America/New_York"; }
};
const PHONE = /^\+?[\d\s().-]{7,20}$/;

/** Step 3: create her private space and sign her in. */
export async function finishSignup(db: Db, ticket: string, input: {
  firstName: string; lastName?: string; stage: string; clinicName?: string; afterHoursPhone?: string; timeZone?: string;
}, device: string | null = null) {
  const first = (input.firstName ?? "").trim(), last = (input.lastName ?? "").trim();
  if (!first || first.length > 60 || last.length > 60) throw new HandoffError("Add your first name.");
  if (!isSoloStage(input.stage)) throw new HandoffError("Choose where you are right now.");
  const clinicName = (input.clinicName ?? "").trim().slice(0, 120) || null;
  const phone = (input.afterHoursPhone ?? "").trim() || null;
  if (phone && !PHONE.test(phone)) throw new HandoffError("Check the after-hours number. Use digits, like (813) 555-0100.");
  const t = await db.query<{ id: string; identifier: string }>(`SELECT id, identifier FROM signup_codes WHERE ticket_hash = $1 AND expires_at > now()`, [sha256(ticket ?? "")]);
  const row = t.rows[0];
  if (!row) throw new HandoffError("This sign-up took too long. Start again and we'll send a new code.");
  const contact = contactOf(row.identifier)!;
  const tz = validZone(input.timeZone);
  const out = await db.transaction(async (tx) => {
    const taken = await tx.query(`SELECT 1 FROM app_users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE (lower(u.email) = $1 OR s.phone = $1) AND u.role IN ('patient','partner') AND u.deactivated_at IS NULL`, [contact.value]);
    if (taken.rows[0]) throw new HandoffError("You already have a Pumpkin account. Go back and choose Sign in.");
    const space = `me-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await tx.query(`INSERT INTO clinics (id, name, timezone, kind) VALUES ($1,'Pumpkin',$2,'personal')`, [space, tz]);
    const u = await tx.query<{ id: string }>(`INSERT INTO app_users (clinic_id, role, display_name, email) VALUES ($1,'patient',$2,$3) RETURNING id`, [space, `${first} ${last}`.trim(), contact.value]);
    const userId = u.rows[0]!.id;
    if (contact.channel === "sms") await tx.query(`INSERT INTO user_settings (user_id, phone) VALUES ($1,$2)`, [userId, contact.value]);
    const p = await tx.query<{ id: string }>(`INSERT INTO patients (clinic_id, user_id, first_name, last_name) VALUES ($1,$2,$3,$4) RETURNING id`, [space, userId, first, last]);
    const patientId = p.rows[0]!.id;
    await tx.query(`INSERT INTO patient_prefs (patient_id, clinic_id) VALUES ($1,$2)`, [patientId, space]);
    await tx.query(`INSERT INTO personal_profiles (patient_id, clinic_id, stage, clinic_name, after_hours_phone, inbox_token) VALUES ($1,$2,$3,$4,$5,$6)`,
      [patientId, space, input.stage, clinicName, phone, newToken().slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "x")]);
    const cyc = cycleForStage(input.stage as SoloStage);
    await tx.query(`INSERT INTO cycles (clinic_id, patient_id, kind, stage, started_on) VALUES ($1,$2,$3,$4, (now() AT TIME ZONE $5)::date)`, [space, patientId, cyc.kind, cyc.stage, tz]);
    await tx.query(`UPDATE early_access SET status = 'joined', joined_at = now() WHERE identifier = $1`, [contact.value]);
    await tx.query(`DELETE FROM signup_codes WHERE identifier = $1`, [contact.value]);
    await tx.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1,$2,'patient.signed_up',$3,$4)`, [space, userId, patientId, JSON.stringify({ stage: input.stage })]);
    return { userId, name: `${first} ${last}`.trim() };
  });
  const token = await createSession(db, out.userId, "patient", true, device);
  return { token, userId: out.userId, name: out.name, role: "patient" as const };
}

// ---------- her own space ----------

async function requirePersonal(tx: Tx) {
  const r = await tx.query<{ ok: boolean }>(`SELECT kp_is_personal() AS ok`);
  if (!r.rows[0]?.ok) throw new HandoffError("Your clinic keeps this part of your record. Ask your care team to change it.");
}
export async function isPersonalSpace(db: Db, clinicId: string) {
  return (await db.query<{ kind: string }>(`SELECT kind FROM clinics WHERE id = $1`, [clinicId])).rows[0]?.kind === "personal";
}
async function spaceZone(tx: Tx): Promise<string> {
  return (await tx.query<{ timezone: string }>(`SELECT timezone FROM clinics WHERE id = kp_clinic()`)).rows[0]?.timezone ?? "America/New_York";
}
async function localToday(tx: Tx): Promise<string> {
  return (await tx.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id = kp_clinic()), 'YYYY-MM-DD') AS d`)).rows[0]!.d;
}

export interface SoloProfile { firstName: string; stage: SoloStage; stageLabel: string; clinicName: string | null; afterHoursPhone: string | null; askedClinicAt: string | null; calendarOn: boolean; calendarDetail: boolean; forwardAddress: string; timeZone: string }

export async function soloProfile(db: Db, actor: Actor, patientId: string): Promise<SoloProfile> {
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const r = await tx.query<{ first_name: string; stage: SoloStage; clinic_name: string | null; after_hours_phone: string | null; asked_clinic_at: Date | null; calendar_token_hash: string | null; calendar_detail: boolean; inbox_token: string }>(
      `SELECT p.first_name, f.stage, f.clinic_name, f.after_hours_phone, f.asked_clinic_at, f.calendar_token_hash, f.calendar_detail, f.inbox_token
         FROM patients p JOIN personal_profiles f ON f.patient_id = p.id WHERE p.id = $1`, [patientId]);
    const x = r.rows[0];
    if (!x) throw new HandoffError("We couldn't find your space. Sign in again.");
    return {
      firstName: x.first_name, stage: x.stage, stageLabel: SOLO_STAGES[x.stage].en, clinicName: x.clinic_name, afterHoursPhone: x.after_hours_phone,
      askedClinicAt: x.asked_clinic_at ? new Date(x.asked_clinic_at).toISOString() : null, calendarOn: !!x.calendar_token_hash, calendarDetail: x.calendar_detail,
      forwardAddress: `add+${x.inbox_token}@${process.env.KINPATH_INBOUND_DOMAIN ?? "in.thepumpkin.ai"}`, timeZone: await spaceZone(tx),
    };
  });
}

export async function updateSoloProfile(db: Db, actor: Actor, patientId: string, change: { stage?: string; clinicName?: string | null; afterHoursPhone?: string | null }) {
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    if (change.stage !== undefined && !isSoloStage(change.stage)) throw new HandoffError("Choose where you are right now.");
    const phone = change.afterHoursPhone === undefined ? undefined : (change.afterHoursPhone ?? "").trim() || null;
    if (phone && !PHONE.test(phone)) throw new HandoffError("Check the after-hours number. Use digits, like (813) 555-0100.");
    const clinic = change.clinicName === undefined ? undefined : (change.clinicName ?? "").trim().slice(0, 120) || null;
    await tx.query(`UPDATE personal_profiles SET stage = coalesce($2, stage),
        clinic_name = CASE WHEN $3::boolean THEN $4 ELSE clinic_name END,
        after_hours_phone = CASE WHEN $5::boolean THEN $6 ELSE after_hours_phone END, updated_at = now() WHERE patient_id = $1`,
      [patientId, change.stage ?? null, clinic !== undefined, clinic ?? null, phone !== undefined, phone ?? null]);
    if (change.stage) {
      const cyc = cycleForStage(change.stage as SoloStage);
      await tx.query(`UPDATE cycles SET stage = $2 WHERE id = (SELECT id FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1)`, [patientId, cyc.stage]);
    }
    await audit(tx, actor, "patient.updated_profile", patientId, { stage: change.stage ?? null });
  });
}

/** "Ask my clinic to join." Pumpkin gets the clinic's name. Her health details are never shared. */
export async function askMyClinic(db: Db, actor: Actor, patientId: string, clinicName: string) {
  const name = clinicName.trim().slice(0, 120);
  if (name.length < 2) throw new HandoffError("Add your clinic's name.");
  await asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    await tx.query(`UPDATE personal_profiles SET clinic_name = $2, asked_clinic_at = now(), updated_at = now() WHERE patient_id = $1`, [patientId, name]);
    await audit(tx, actor, "patient.asked_clinic", patientId, {});
  });
  await db.query(`INSERT INTO clinic_requests (clinic_name, patient_id, source) VALUES ($1,$2,'app')`, [name, patientId]);
  return { ok: true };
}

// ---------- meds ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function insertMedication(tx: Tx, actor: Actor, patientId: string, m: MedicationItem, captureId: string | null) {
  if (!m.name.trim() || !m.dose.trim()) throw new HandoffError("Add the medication name and dose.");
  if (!m.times.length) throw new HandoffError("Add at least one time.");
  if (!m.startsOn || !DATE.test(m.startsOn)) throw new HandoffError("Add the start date.");
  const ends = m.endsOn && DATE.test(m.endsOn) ? m.endsOn : m.startsOn;
  if (ends < m.startsOn) throw new HandoffError("The last day is before the first day.");
  if ((Date.parse(ends) - Date.parse(m.startsOn)) / 86400_000 > 59) throw new HandoffError("Add up to 60 days at a time.");
  const cycle = (await tx.query<{ id: string }>(`SELECT id FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId])).rows[0];
  if (!cycle) throw new HandoffError("We couldn't find your current cycle. Sign in again.");
  const ids: string[] = [];
  for (const time of m.times) {
    const o = await tx.query<{ id: string }>(
      `INSERT INTO med_orders (clinic_id, patient_id, cycle_id, medication, dose, time_of_day, starts_on, ends_on, status, source, instructions, capture_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','patient',$9,$10) RETURNING id`,
      [actor.clinicId, patientId, cycle.id, m.name.trim(), m.dose.trim(), time, m.startsOn, ends, m.instructions ?? null, captureId]);
    const id = o.rows[0]!.id; ids.push(id);
    await tx.query(
      `INSERT INTO dose_logs (clinic_id, patient_id, med_order_id, scheduled_for)
       SELECT m.clinic_id, m.patient_id, m.id, (g.d::date + m.time_of_day) AT TIME ZONE c.timezone
         FROM med_orders m JOIN clinics c ON c.id = m.clinic_id, generate_series(m.starts_on, m.ends_on, interval '1 day') AS g(d)
        WHERE m.id = $1 AND (g.d::date + m.time_of_day) AT TIME ZONE c.timezone > now() - interval '12 hours'`, [id]);
  }
  await audit(tx, actor, "patient.added_medication", patientId, { orders: ids.length, fromCapture: !!captureId });
  return ids[0]!;
}

export async function addMedication(db: Db, actor: Actor, patientId: string, m: MedicationItem) {
  const item = cleanItem({ kind: "medication", data: m });
  if (!item) throw new HandoffError("Add the medication name.");
  return asActor(db, actor, async (tx) => { await requirePersonal(tx); return { id: await insertMedication(tx, actor, patientId, item.data as MedicationItem, null) }; });
}

export async function stopMedication(db: Db, actor: Actor, patientId: string, medOrderId: string) {
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const r = await tx.query(`UPDATE med_orders SET status = 'stopped' WHERE id = $1 AND patient_id = $2 AND status = 'active' RETURNING id`, [medOrderId, patientId]);
    if (!r.rows[0]) throw new HandoffError("That medication is already stopped.");
    await tx.query(`UPDATE dose_logs SET canceled_at = now() WHERE med_order_id = $1 AND taken_at IS NULL AND scheduled_for > now()`, [medOrderId]);
    await audit(tx, actor, "patient.stopped_medication", patientId, { medOrderId });
  });
}

export async function soloMeds(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; medication: string; dose: string; time_of_day: string; starts_on: string; ends_on: string | null; instructions: string | null; source: string; next_at: Date | null }>(
      `SELECT m.id, m.medication, m.dose, m.time_of_day::text, m.starts_on::text, m.ends_on::text, m.instructions, m.source,
              (SELECT min(d.scheduled_for) FROM dose_logs d WHERE d.med_order_id = m.id AND d.canceled_at IS NULL AND d.taken_at IS NULL AND d.scheduled_for > now()) AS next_at
         FROM med_orders m WHERE m.patient_id = $1 AND m.status = 'active' ORDER BY m.medication, m.time_of_day`, [patientId]);
    return r.rows.map((x) => ({ id: x.id, medication: x.medication, dose: x.dose, time: x.time_of_day.slice(0, 5), startsOn: x.starts_on, endsOn: x.ends_on, instructions: x.instructions, mine: x.source === "patient", nextAt: x.next_at ? new Date(x.next_at).toISOString() : null }));
  });
}

// ---------- results: what she enters, with the lab's own reference range ----------

export async function insertResult(tx: Tx, actor: Actor, patientId: string, r: ResultItem, captureId: string | null) {
  if (!r.unit.trim()) throw new HandoffError("Add the unit, as printed (for example pg/mL).");
  const day = r.collectedOn && DATE.test(r.collectedOn) ? r.collectedOn : await localToday(tx);
  const key = analyteKey(r.test);
  const o = await tx.query<{ id: string }>(
    `INSERT INTO lab_results (clinic_id, patient_id, analyte, unit, value, stim_day, collected_at, status, entered_by, source, ref_low, ref_high, ref_text, test_name, capture_id)
     VALUES ($1,$2,$3,$4,$5,NULL, ($6::date + time '12:00') AT TIME ZONE (SELECT timezone FROM clinics WHERE id = $1), 'no_range', $7, 'patient_upload', $8,$9,$10,$11,$12) RETURNING id`,
    [actor.clinicId, patientId, key, r.unit.trim(), r.value, day, actor.userId, r.refLow ?? null, r.refHigh ?? null, r.refText ?? null, r.test.trim().slice(0, 80), captureId]);
  await audit(tx, actor, "patient.added_result", patientId, { analyte: key, fromCapture: !!captureId });
  return o.rows[0]!.id;
}

export async function addResult(db: Db, actor: Actor, patientId: string, r: ResultItem) {
  const item = cleanItem({ kind: "result", data: r });
  if (!item) throw new HandoffError("Add the test name and the number.");
  return asActor(db, actor, async (tx) => { await requirePersonal(tx); return { id: await insertResult(tx, actor, patientId, item.data as ResultItem, null) }; });
}

export async function deleteResult(db: Db, actor: Actor, patientId: string, resultId: string) {
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const r = await tx.query(`DELETE FROM lab_results WHERE id = $1 AND patient_id = $2 AND source = 'patient_upload' RETURNING id`, [resultId, patientId]);
    if (!r.rows[0]) throw new HandoffError("That result is already gone.");
    await audit(tx, actor, "patient.deleted_result", patientId, { resultId });
  });
}

export interface ResultGroup {
  key: string; name: string; unit: string;
  measures: string | null; inTreatment: string | null; reviewed: boolean;
  points: { id: string; value: number; unit: string; on: string; refLow: number | null; refHigh: number | null; refText: string | null; mine: boolean }[];
}

/** Results grouped by test, newest first, with what each test measures. Never a verdict. */
export async function soloResults(db: Db, actor: Actor, patientId: string): Promise<ResultGroup[]> {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; analyte: string; test_name: string | null; unit: string; value: string; on: string; ref_low: string | null; ref_high: string | null; ref_text: string | null; source: string }>(
      `SELECT id, analyte, test_name, unit, value::text, to_char(collected_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id = lab_results.clinic_id), 'YYYY-MM-DD') AS on,
              ref_low::text, ref_high::text, ref_text, source FROM lab_results WHERE patient_id = $1 ORDER BY collected_at DESC`, [patientId]);
    const groups = new Map<string, ResultGroup>();
    for (const x of r.rows) {
      const key = x.analyte === "other" ? `other:${(x.test_name ?? "Other").toLowerCase()}` : x.analyte;
      const info = testInfo(x.analyte);
      if (!groups.has(key)) groups.set(key, { key, name: info?.name ?? x.test_name ?? x.analyte, unit: x.unit, measures: info?.measures ?? null, inTreatment: info?.inTreatment ?? null, reviewed: !!info?.reviewedBy, points: [] });
      groups.get(key)!.points.push({ id: x.id, value: Number(x.value), unit: x.unit, on: x.on, refLow: x.ref_low === null ? null : Number(x.ref_low), refHigh: x.ref_high === null ? null : Number(x.ref_high), refText: x.ref_text, mine: x.source === "patient_upload" });
    }
    return [...groups.values()];
  });
}

// ---------- appointments ----------

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export async function insertAppointment(tx: Tx, actor: Actor, patientId: string, a: AppointmentItem) {
  if (!LOCAL.test(a.startsAt)) throw new HandoffError("Add the date and time.");
  const o = await tx.query<{ id: string }>(
    `INSERT INTO appointments (clinic_id, patient_id, starts_at, kind, title, location, source, created_by_name)
     VALUES ($1,$2, $3::timestamp AT TIME ZONE (SELECT timezone FROM clinics WHERE id = $1), $4,$5,$6,'patient','You') RETURNING id`,
    [actor.clinicId, patientId, a.startsAt, apptKindOf(a.title), a.title.trim().slice(0, 120), a.location?.trim().slice(0, 160) || null]);
  await audit(tx, actor, "patient.added_appointment", patientId, {});
  return o.rows[0]!.id;
}
export async function addAppointment(db: Db, actor: Actor, patientId: string, a: AppointmentItem) {
  const item = cleanItem({ kind: "appointment", data: a });
  if (!item) throw new HandoffError("Add what the appointment is for.");
  return asActor(db, actor, async (tx) => { await requirePersonal(tx); return { id: await insertAppointment(tx, actor, patientId, item.data as AppointmentItem) }; });
}
export async function deleteAppointment(db: Db, actor: Actor, patientId: string, id: string) {
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const r = await tx.query(`DELETE FROM appointments WHERE id = $1 AND patient_id = $2 AND source = 'patient' RETURNING id`, [id, patientId]);
    if (!r.rows[0]) throw new HandoffError("That appointment is already gone.");
    await audit(tx, actor, "patient.deleted_appointment", patientId, {});
  });
}

// ---------- costs ----------

export async function insertCost(tx: Tx, actor: Actor, patientId: string, c: CostItem, captureId: string | null) {
  const on = c.date && DATE.test(c.date) ? c.date : await localToday(tx);
  const o = await tx.query<{ id: string }>(
    `INSERT INTO finance_ledger (clinic_id, patient_id, kind, description, amount_cents, occurred_on, due_on, method, source, created_by_name, capture_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'patient','You',$9) RETURNING id`,
    [actor.clinicId, patientId, c.type, c.description.trim().slice(0, 160), Math.round(c.amount * 100), on, c.type === "charge" ? c.dueOn ?? null : null, c.type === "payment" ? c.method ?? null : null, captureId]);
  await audit(tx, actor, "patient.added_cost", patientId, { kind: c.type, fromCapture: !!captureId });
  return o.rows[0]!.id;
}
export async function addCost(db: Db, actor: Actor, patientId: string, c: CostItem) {
  const item = cleanItem({ kind: "cost", data: c });
  if (!item) throw new HandoffError("Add the amount.");
  return asActor(db, actor, async (tx) => { await requirePersonal(tx); return { id: await insertCost(tx, actor, patientId, item.data as CostItem, null) }; });
}
export async function deleteCost(db: Db, actor: Actor, patientId: string, id: string) {
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const r = await tx.query(`DELETE FROM finance_ledger WHERE id = $1 AND patient_id = $2 AND source = 'patient' RETURNING id`, [id, patientId]);
    if (!r.rows[0]) throw new HandoffError("That entry is already gone.");
    await audit(tx, actor, "patient.deleted_cost", patientId, {});
  });
}
export async function soloCosts(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; kind: "charge" | "payment" | "adjustment" | "refund"; description: string; amount_cents: string; occurred_on: string; due_on: string | null; method: string | null; capture_id: string | null; source: string }>(
      `SELECT id, kind, description, amount_cents::text, occurred_on::text, due_on::text, method, source,
              (SELECT c.id FROM captures c WHERE c.id = finance_ledger.capture_id AND c.bytes IS NOT NULL) AS capture_id FROM finance_ledger
        WHERE patient_id = $1 AND voided_at IS NULL ORDER BY coalesce(due_on, occurred_on) DESC, created_at DESC`, [patientId]);
    const entries = r.rows.map((x) => ({ id: x.id, kind: x.kind, description: x.description, amountCents: Number(x.amount_cents), occurredOn: x.occurred_on, dueOn: x.due_on, method: x.method, captureId: x.capture_id, mine: x.source === "patient" }));
    const sign = (k: string) => (k === "charge" ? 1 : k === "refund" ? 1 : -1);
    const balanceCents = entries.reduce((s, e) => s + sign(e.kind) * e.amountCents, 0);
    const paidCents = entries.filter((e) => e.kind === "payment").reduce((s, e) => s + e.amountCents, 0);
    const today = await localToday(tx);
    const upcoming = entries.filter((e) => e.kind === "charge" && e.dueOn && e.dueOn >= today).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
    const year = today.slice(0, 4);
    const paidThisYearCents = entries.filter((e) => e.kind === "payment" && e.occurredOn.startsWith(year)).reduce((s, e) => s + e.amountCents, 0);
    return { entries, balanceCents, paidCents, paidThisYearCents, year, nextDue: upcoming[0] ? { dueOn: upcoming[0].dueOn!, amountCents: upcoming[0].amountCents, description: upcoming[0].description } : null };
  });
}

// ---------- questions for her next visit ----------

export async function addQuestion(db: Db, actor: Actor, patientId: string, text: string) {
  const q = text.trim();
  if (!q || q.length > 500) throw new HandoffError("Write your question (up to 500 characters).");
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string }>(`INSERT INTO visit_questions (clinic_id, patient_id, question) VALUES ($1,$2,$3) RETURNING id`, [actor.clinicId, patientId, q]);
    return { id: r.rows[0]!.id };
  });
}
export async function visitQuestions(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; question: string; asked_at: Date | null }>(`SELECT id, question, asked_at FROM visit_questions WHERE patient_id = $1 ORDER BY asked_at NULLS FIRST, created_at`, [patientId]);
    return r.rows.map((x) => ({ id: x.id, question: x.question, asked: x.asked_at !== null }));
  });
}
export async function setQuestionAsked(db: Db, actor: Actor, patientId: string, id: string, asked: boolean) {
  return asActor(db, actor, async (tx) => { await tx.query(`UPDATE visit_questions SET asked_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND patient_id = $2`, [id, patientId, asked]); });
}
export async function deleteQuestion(db: Db, actor: Actor, patientId: string, id: string) {
  return asActor(db, actor, async (tx) => { await tx.query(`DELETE FROM visit_questions WHERE id = $1 AND patient_id = $2`, [id, patientId]); });
}

// ---------- Today ----------

export async function soloToday(db: Db, actor: Actor, patientId: string, now = new Date()) {
  const [profile, schedule, results, costs, questions] = await Promise.all([
    soloProfile(db, actor, patientId), patientSchedule(db, actor, patientId, now), soloResults(db, actor, patientId), soloCosts(db, actor, patientId), visitQuestions(db, actor, patientId),
  ]);
  return asActor(db, actor, async (tx) => {
    const pend = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM capture_items WHERE patient_id = $1 AND status = 'pending'`, [patientId]);
    const reading = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM captures WHERE patient_id = $1 AND status = 'reading' AND created_at > now() - interval '10 minutes'`, [patientId]);
    const appts = await tx.query<{ id: string; starts_at: Date; title: string; location: string | null; source: string }>(
      `SELECT id, starts_at, title, location, source FROM appointments WHERE patient_id = $1 AND status = 'booked' AND starts_at > now() - interval '2 hours' ORDER BY starts_at LIMIT 5`, [patientId]);
    return {
      profile, schedule,
      toCheck: pend.rows[0]!.n, reading: reading.rows[0]!.n,
      appointments: appts.rows.map((a) => ({ id: a.id, startsAt: new Date(a.starts_at).toISOString(), title: a.title, location: a.location, mine: a.source === "patient" })),
      latestResults: results.slice(0, 3).map((g) => ({ key: g.key, name: g.name, value: g.points[0]!.value, unit: g.points[0]!.unit, on: g.points[0]!.on })),
      nextDue: costs.nextDue, balanceCents: costs.balanceCents,
      openQuestions: questions.filter((q) => !q.asked).length,
    };
  });
}

// ---------- calendar feed ----------

/** A private calendar link she subscribes to. Making a new one turns the old one off. */
export async function newCalendarLink(db: Db, actor: Actor, patientId: string, opts: { detail?: boolean } = {}) {
  const token = newToken();
  await asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    await tx.query(`UPDATE personal_profiles SET calendar_token_hash = $2, calendar_detail = $3, updated_at = now() WHERE patient_id = $1`, [patientId, sha256(token), !!opts.detail]);
    await audit(tx, actor, "patient.calendar_link_created", patientId, { detail: !!opts.detail });
  });
  return { token };
}
export async function stopCalendarLink(db: Db, actor: Actor, patientId: string) {
  await asActor(db, actor, async (tx) => {
    await tx.query(`UPDATE personal_profiles SET calendar_token_hash = NULL, updated_at = now() WHERE patient_id = $1`, [patientId]);
    await audit(tx, actor, "patient.calendar_link_stopped", patientId, {});
  });
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** The feed itself (read by her calendar app, no sign-in). Titles say only "Appointment" unless she chose detail. */
export async function calendarFeed(db: Db, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const p = await db.query<{ patient_id: string; calendar_detail: boolean }>(`SELECT patient_id, calendar_detail FROM personal_profiles WHERE calendar_token_hash = $1`, [sha256(token)]);
  const prof = p.rows[0];
  if (!prof) return null;
  const a = await db.query<{ id: string; starts_at: Date; title: string; location: string | null; updated_at: Date }>(
    `SELECT id, starts_at, title, location, updated_at FROM appointments WHERE patient_id = $1 AND status = 'booked' AND starts_at > now() - interval '30 days' ORDER BY starts_at`, [prof.patient_id]);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pumpkin//Appointments//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Pumpkin"];
  for (const x of a.rows) {
    const start = new Date(x.starts_at);
    lines.push("BEGIN:VEVENT", `UID:${x.id}@thepumpkin.ai`, `DTSTAMP:${icsTime(new Date(x.updated_at))}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(new Date(start.getTime() + 3600_000))}`,
      `SUMMARY:${icsEscape(prof.calendar_detail ? x.title : "Appointment")}`);
    if (prof.calendar_detail && x.location) lines.push(`LOCATION:${icsEscape(x.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------- download everything, or delete everything ----------

const SECRET_COLUMNS = new Set(["code_hash", "token_hash", "ticket_hash", "calendar_token_hash", "password_hash", "totp_secret", "private_key_enc"]);
const SKIP_TABLES = new Set(["sessions", "sign_in_codes", "auth_failures", "user_credentials", "outbox", "kp_migrations", "early_access", "signup_codes"]);

async function spaceTables(db: Db): Promise<string[]> {
  const r = await db.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'clinic_id' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name`);
  return r.rows.map((x) => x.table_name);
}

async function personalSpaceOf(db: Db, actor: Actor) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can do this.");
  const r = await db.query<{ kind: string }>(`SELECT c.kind FROM app_users u JOIN clinics c ON c.id = u.clinic_id WHERE u.id = $1 AND u.clinic_id = $2`, [actor.userId, actor.clinicId]);
  if (r.rows[0]?.kind !== "personal") throw new HandoffError("Your clinic keeps your record. Ask your care team for a copy.");
  return actor.clinicId;
}

/** Everything in her space, as JSON. Sign-in secrets are left out. Files are included (base64). */
export async function exportMyData(db: Db, actor: Actor) {
  const space = await personalSpaceOf(db, actor);
  const out: Record<string, unknown[]> = {};
  for (const table of await spaceTables(db)) {
    if (SKIP_TABLES.has(table) || table === "clinics") continue;
    const rows = (await db.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE clinic_id = $1`, [space])).rows;
    if (!rows.length) continue;
    out[table] = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET_COLUMNS.has(k)).map(([k, v]) => [k, v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v])));
  }
  await db.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1,$2,'patient.downloaded_record',NULL,'{}')`, [space, actor.userId]);
  return { exportedAt: new Date().toISOString(), format: "Pumpkin export v1", note: "Everything in your Pumpkin space. Dates and times are in UTC unless marked.", data: out };
}

/**
 * Deletes her space and everything in it, including support people's access, the activity log and
 * her place on the waitlist. It can't be undone. Rows are removed child-first, retrying until clean.
 */
export async function deleteMyAccount(db: Db, actor: Actor, confirm: string) {
  if (confirm.trim().toLowerCase() !== "delete") throw new HandoffError('Type "delete" to confirm.');
  const space = await personalSpaceOf(db, actor);
  const users = (await db.query<{ id: string; email: string; phone: string | null }>(
    `SELECT u.id, u.email, s.phone FROM app_users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.clinic_id = $1`, [space])).rows;
  const ids = users.map((u) => u.id);
  const patients = (await db.query<{ id: string }>(`SELECT id FROM patients WHERE clinic_id = $1`, [space])).rows.map((p) => p.id);
  const tables = (await spaceTables(db)).filter((t) => t !== "clinics" && t !== "app_users");
  await db.transaction(async (tx) => {
    // Rows tied to her people but without a clinic_id.
    for (const [table, col] of [["sessions", "user_id"], ["sign_in_codes", "user_id"], ["user_credentials", "user_id"], ["user_settings", "user_id"], ["notification_prefs", "user_id"]] as const) {
      const exists = (await tx.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [table])).rows[0];
      if (exists) await tx.query(`DELETE FROM ${table} WHERE ${col} = ANY($1::uuid[])`, [ids]);
    }
    await tx.query(`DELETE FROM clinic_requests WHERE patient_id = ANY($1::uuid[])`, [patients]);
    await tx.query(`DELETE FROM early_access WHERE identifier = ANY($1::text[])`, [users.flatMap((u) => [u.email, u.phone].filter((x): x is string => !!x))]);
    let left = tables;
    for (let pass = 0; pass < 12 && left.length; pass++) {
      const next: string[] = [];
      for (const table of left) {
        await tx.exec("SAVEPOINT kp_del");
        try { await tx.query(`DELETE FROM ${table} WHERE clinic_id = $1`, [space]); await tx.exec("RELEASE SAVEPOINT kp_del"); }
        catch { await tx.exec("ROLLBACK TO SAVEPOINT kp_del"); next.push(table); }
      }
      if (next.length === left.length) throw new Error(`Couldn't delete: ${next.join(", ")}`);
      left = next;
    }
    await tx.query(`DELETE FROM app_users WHERE clinic_id = $1`, [space]);
    await tx.query(`DELETE FROM clinics WHERE id = $1 AND kind = 'personal'`, [space]);
  });
  return { deleted: true };
}
