/**
 * Adding patients, starting cycles, and appointments.
 *
 * Nurses, physicians and schedulers add patients. Only nurses and physicians start a cycle (that's a
 * clinical step). Appointments can be booked by nurses, physicians and schedulers, or arrive from the
 * records system. Clinic admins manage the team, not patients.
 */
import { HandoffError, type Lang } from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { alertPatient, sendDirect } from "./notify";

type Staff = Actor & { name: string };
const ADDERS = ["nurse", "physician", "scheduler"];
const CLINICIANS = ["nurse", "physician"];
function requireAdder(a: Actor) { if (!ADDERS.includes(a.role)) throw new HandoffError("Only nurses, physicians and schedulers can add patients."); }

/** Email (lowercased) or phone (digits only), the same form sign-in uses. */
export function contactOf(s: string): { value: string; channel: "email" | "sms" } | null {
  const t = s.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { value: t, channel: "email" };
  const digits = t.replace(/[^0-9+]/g, "");
  if (/^\+?\d{10,15}$/.test(digits)) return { value: digits, channel: "sms" };
  return null;
}

const clean = (s: string | undefined | null) => (s ?? "").trim();
const MRN = /^[A-Za-z0-9-]{3,40}$/;

export const CYCLE_KINDS = { ivf: "IVF", egg_freezing: "Egg freezing", fet: "Frozen embryo transfer", iui: "IUI" } as const;

export async function addPatient(db: Db, staff: Staff, input: {
  firstName: string; lastName: string; mrn?: string; lang?: Lang; contact: string;
  cycle?: { kind: keyof typeof CYCLE_KINDS; startedOn: string } | null;
}) {
  requireAdder(staff);
  const first = clean(input.firstName), last = clean(input.lastName), mrn = clean(input.mrn) || null;
  if (!first || !last || first.length > 60 || last.length > 60) throw new HandoffError("Enter her first and last name.");
  if (mrn && !MRN.test(mrn)) throw new HandoffError("The medical record number can have letters, numbers and dashes only.");
  const contact = contactOf(input.contact);
  if (!contact) throw new HandoffError("Enter her mobile number or email. That's how she signs in.");
  const lang: Lang = input.lang === "es" ? "es" : "en";
  if (input.cycle) {
    if (!CLINICIANS.includes(staff.role)) throw new HandoffError("Only a nurse or physician can start a cycle.");
    if (!(input.cycle.kind in CYCLE_KINDS) || !/^\d{4}-\d{2}-\d{2}$/.test(input.cycle.startedOn)) throw new HandoffError("Choose the cycle type and start date.");
  }
  const clinic = (await db.query<{ name: string }>(`SELECT name FROM clinics WHERE id = $1`, [staff.clinicId])).rows[0]!.name;
  const out = await db.transaction(async (tx) => {
    if (mrn && (await tx.query(`SELECT 1 FROM patients WHERE clinic_id = $1 AND mrn = $2`, [staff.clinicId, mrn])).rows[0]) {
      throw new HandoffError("Another patient already has this medical record number.");
    }
    const taken = await tx.query(`SELECT 1 FROM app_users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.clinic_id = $1 AND (lower(u.email) = $2 OR s.phone = $2)`, [staff.clinicId, contact.value]);
    if (taken.rows[0]) throw new HandoffError("Someone at this clinic already signs in with that phone or email.");
    const u = await tx.query<{ id: string }>(`INSERT INTO app_users (clinic_id, role, display_name, email, preferred_lang) VALUES ($1,'patient',$2,$3,$4) RETURNING id`,
      [staff.clinicId, `${first} ${last}`, contact.value, lang]);
    const p = await tx.query<{ id: string }>(`INSERT INTO patients (clinic_id, user_id, first_name, last_name, preferred_lang, mrn, added_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [staff.clinicId, u.rows[0]!.id, first, last, lang, mrn, staff.name]);
    const patientId = p.rows[0]!.id;
    await tx.query(`INSERT INTO patient_prefs (patient_id, clinic_id) VALUES ($1,$2)`, [patientId, staff.clinicId]);
    if (input.cycle) await insertCycle(tx, staff.clinicId, patientId, input.cycle);
    await tx.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1,$2,'staff.added_patient',$3,$4)`,
      [staff.clinicId, staff.userId, patientId, JSON.stringify({ cycle: !!input.cycle })]);
    return { patientId, userId: u.rows[0]!.id };
  });
  // Welcome: how to get in. No health details.
  await sendDirect(db, { clinicId: staff.clinicId, userId: out.userId, channel: contact.channel, to: contact.value,
    subject: lang === "es" ? `${clinic} te invitó a Pumpkin` : `${clinic} added you to Pumpkin`,
    body: lang === "es"
      ? `Hola ${first}: ${clinic} usa Pumpkin para acompañarte en tu tratamiento. Descarga la app y entra con este ${contact.channel === "email" ? "correo" : "número"}. Te enviaremos un código.`
      : `Hi ${first}, ${clinic} uses Pumpkin to support you through treatment. Get the app and sign in with this ${contact.channel === "email" ? "email" : "number"}. We'll send you a code.` });
  return { patientId: out.patientId };
}

async function insertCycle(tx: Tx, clinicId: string, patientId: string, c: { kind: string; startedOn: string }) {
  await tx.query(
    `INSERT INTO cycles (clinic_id, patient_id, kind, stage, stim_day, started_on) VALUES ($1,$2,$3,'stimulation', greatest(1, (current_date - $4::date) + 1), $4)`,
    [clinicId, patientId, c.kind, c.startedOn]);
}

export async function updatePatient(db: Db, staff: Staff, patientId: string, change: { mrn?: string; contact?: string; lang?: Lang }) {
  requireAdder(staff);
  // Visibility check under row-level security first.
  const seen = await asActor(db, staff, async (tx) => (await tx.query<{ user_id: string }>(`SELECT user_id FROM patients WHERE id = $1`, [patientId])).rows[0]);
  if (!seen) throw new HandoffError("That patient isn't in this clinic.");
  const mrn = change.mrn === undefined ? undefined : clean(change.mrn) || null;
  if (mrn && !MRN.test(mrn)) throw new HandoffError("The medical record number can have letters, numbers and dashes only.");
  const contact = change.contact === undefined || !clean(change.contact) ? undefined : contactOf(change.contact);
  if (contact === null) throw new HandoffError("Enter a mobile number or email.");
  await db.transaction(async (tx) => {
    if (mrn !== undefined) {
      if (mrn && (await tx.query(`SELECT 1 FROM patients WHERE clinic_id = $1 AND mrn = $2 AND id <> $3`, [staff.clinicId, mrn, patientId])).rows[0]) throw new HandoffError("Another patient already has this medical record number.");
      await tx.query(`UPDATE patients SET mrn = $2 WHERE id = $1 AND clinic_id = $3`, [patientId, mrn, staff.clinicId]);
    }
    if (contact) {
      if ((await tx.query(`SELECT 1 FROM app_users WHERE clinic_id = $1 AND lower(email) = $2 AND id <> $3`, [staff.clinicId, contact.value, seen.user_id])).rows[0]) throw new HandoffError("Someone at this clinic already signs in with that phone or email.");
      await tx.query(`UPDATE app_users SET email = $2 WHERE id = $1 AND clinic_id = $3`, [seen.user_id, contact.value, staff.clinicId]);
    }
    if (change.lang) {
      const lang = change.lang === "es" ? "es" : "en";
      await tx.query(`UPDATE patients SET preferred_lang = $2 WHERE id = $1 AND clinic_id = $3`, [patientId, lang, staff.clinicId]);
      await tx.query(`UPDATE app_users SET preferred_lang = $2 WHERE id = $1 AND clinic_id = $3`, [seen.user_id, lang, staff.clinicId]);
    }
    await tx.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1,$2,'staff.updated_patient',$3,$4)`,
      [staff.clinicId, staff.userId, patientId, JSON.stringify({ mrn: mrn !== undefined, contact: !!contact, lang: !!change.lang })]);
  });
}

export async function startCycle(db: Db, staff: Staff, patientId: string, c: { kind: keyof typeof CYCLE_KINDS; startedOn: string }) {
  if (!CLINICIANS.includes(staff.role)) throw new HandoffError("Only a nurse or physician can start a cycle.");
  if (!(c.kind in CYCLE_KINDS) || !/^\d{4}-\d{2}-\d{2}$/.test(c.startedOn)) throw new HandoffError("Choose the cycle type and start date.");
  const seen = await asActor(db, staff, async (tx) => (await tx.query(`SELECT 1 FROM patients WHERE id = $1`, [patientId])).rows[0]);
  if (!seen) throw new HandoffError("That patient isn't in this clinic.");
  await db.transaction(async (tx) => {
    await insertCycle(tx, staff.clinicId, patientId, c);
    await tx.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1,$2,'staff.started_cycle',$3,$4)`,
      [staff.clinicId, staff.userId, patientId, JSON.stringify({ kind: c.kind })]);
  });
}

export interface DirectoryRow { id: string; name: string; mrn: string | null; contact: string; lang: Lang; stage: string | null; cycleKind: string | null; nextVisit: string | null }

export async function patientDirectory(db: Db, staff: Actor): Promise<DirectoryRow[]> {
  requireAdder(staff);
  return asActor(db, staff, async (tx) => (await tx.query<{ id: string; first_name: string; last_name: string; mrn: string | null; email: string; preferred_lang: Lang; stage: string | null; kind: string | null; next: Date | null }>(
    `SELECT p.id, p.first_name, p.last_name, p.mrn, u.email, p.preferred_lang,
            c.stage, c.kind,
            (SELECT min(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'booked' AND a.starts_at > now()) AS next
       FROM patients p JOIN app_users u ON u.id = p.user_id
       LEFT JOIN LATERAL (SELECT stage, kind FROM cycles WHERE patient_id = p.id ORDER BY started_on DESC LIMIT 1) c ON true
      ORDER BY p.last_name, p.first_name`)).rows.map((r) => ({
    id: r.id, name: `${r.first_name} ${r.last_name}`, mrn: r.mrn, contact: r.email, lang: r.preferred_lang, stage: r.stage, cycleKind: r.kind,
    nextVisit: r.next ? new Date(r.next).toISOString() : null,
  })));
}

// ---------- appointments ----------

export const APPOINTMENT_KINDS = {
  monitoring: "Monitoring visit", blood_test: "Blood test", consult: "Consultation", retrieval: "Egg retrieval",
  transfer: "Embryo transfer", procedure: "Procedure", other: "Appointment",
} as const;
export type AppointmentKind = keyof typeof APPOINTMENT_KINDS;

export interface Appointment { id: string; startsAt: string; kind: AppointmentKind; title: string; location: string | null; status: "booked" | "cancelled"; source: "staff" | "records" }

export async function bookAppointment(db: Db, staff: Staff, input: { patientId: string; startsAt: string; kind: string; title?: string; location?: string }) {
  if (!ADDERS.includes(staff.role)) throw new HandoffError("Only nurses, physicians and schedulers can book appointments.");
  const at = new Date(input.startsAt);
  if (Number.isNaN(at.getTime())) throw new HandoffError("Choose the date and time.");
  if (!(input.kind in APPOINTMENT_KINDS)) throw new HandoffError("Choose the kind of visit.");
  const title = clean(input.title) || APPOINTMENT_KINDS[input.kind as AppointmentKind];
  if (title.length > 120) throw new HandoffError("Keep the title under 120 characters.");
  const location = clean(input.location) || null;
  const id = await asActor(db, staff, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO appointments (clinic_id, patient_id, starts_at, kind, title, location, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [staff.clinicId, input.patientId, at.toISOString(), input.kind, title, location, staff.name]);
    await audit(tx, staff, "staff.booked_appointment", input.patientId, { appointmentId: r.rows[0]!.id });
    return r.rows[0]!.id;
  });
  await alertPatient(db, input.patientId, "schedule_changed", "You have a new appointment.");
  return { id };
}

export async function cancelAppointment(db: Db, staff: Staff, appointmentId: string) {
  if (!ADDERS.includes(staff.role)) throw new HandoffError("Only nurses, physicians and schedulers can change appointments.");
  const p = await asActor(db, staff, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE appointments SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'booked' RETURNING patient_id`, [appointmentId]);
    if (!r.rows[0]) throw new HandoffError("That appointment was already canceled.");
    await audit(tx, staff, "staff.canceled_appointment", r.rows[0].patient_id, { appointmentId });
    return r.rows[0].patient_id;
  });
  await alertPatient(db, p, "schedule_changed", "An appointment was canceled.");
}

/** Upcoming visits for the patient, a support person she shares her schedule with, or staff. */
export async function upcomingAppointments(db: Db, actor: Actor, patientId: string, opts: { includePast?: boolean } = {}): Promise<Appointment[]> {
  return asActor(db, actor, async (tx) => (await tx.query<{ id: string; starts_at: Date; kind: AppointmentKind; title: string; location: string | null; status: "booked" | "cancelled"; source: "staff" | "records" }>(
    `SELECT id, starts_at, kind, title, location, status, source FROM appointments
      WHERE patient_id = $1 AND ($2 OR (starts_at > now() - interval '2 hours' AND status = 'booked')) ORDER BY starts_at LIMIT 50`, [patientId, !!opts.includePast])).rows.map((r) => ({
    id: r.id, startsAt: new Date(r.starts_at).toISOString(), kind: r.kind, title: r.title, location: r.location, status: r.status, source: r.source,
  })));
}
