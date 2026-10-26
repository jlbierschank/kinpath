/**
 * The partner side. A partner sees only the sections the patient shares, can read the
 * clinic's injection walkthroughs to help, and can send the patient short private notes.
 * The patient controls sharing. Messages with the care team are never shared.
 */
import { HandoffError, triage, type ClinicTerm, type TriageResult } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";
import { patientResults, patientSchedule } from "./loop";

/** What a patient can choose to share with a partner from the phone app. */
export const SHAREABLE = ["schedule", "meds", "results"] as const;
export type Shareable = (typeof SHAREABLE)[number];

export interface PartnerNote { id: string; fromName: string; body: string; level: "routine" | "urgent" | "crisis"; createdAt: string; seenAt: string | null }

type NoteRow = { id: string; from_name: string; body: string; level: PartnerNote["level"]; created_at: Date; seen_at: Date | null };
const toNote = (r: NoteRow): PartnerNote => ({
  id: r.id, fromName: r.from_name, body: r.body, level: r.level, createdAt: new Date(r.created_at).toISOString(), seenAt: r.seen_at ? new Date(r.seen_at).toISOString() : null,
});

/** Everything the partner's home screen needs, limited to what the patient shares right now. */
export async function partnerHome(db: Db, actor: Actor, now = new Date()) {
  if (actor.role !== "partner") throw new HandoffError("This screen is for partners.");
  const base = await asActor(db, actor, async (tx) => {
    const g = await tx.query<{ patient_id: string; sections: string[] }>(
      `SELECT patient_id, sections FROM partner_grants WHERE partner_user_id = $1 AND revoked_at IS NULL AND cardinality(sections) > 0 ORDER BY created_at LIMIT 1`, [actor.userId]);
    const grant = g.rows[0];
    if (!grant) return null;
    const p = await tx.query<{ first_name: string }>(`SELECT first_name FROM patients WHERE id = $1`, [grant.patient_id]);
    const c = await tx.query<{ stage: string; stim_day: number | null }>(`SELECT stage, stim_day FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [grant.patient_id]);
    const n = await tx.query<NoteRow>(
      `SELECT id, from_name, body, level, created_at, seen_at FROM partner_notes WHERE from_user_id = $1 ORDER BY created_at DESC LIMIT 5`, [actor.userId]);
    await audit(tx, actor, "partner.viewed_shared", grant.patient_id, { sections: grant.sections });
    return {
      patientId: grant.patient_id,
      sections: grant.sections.filter((s): s is Shareable => (SHAREABLE as readonly string[]).includes(s)),
      firstName: p.rows[0]?.first_name ?? null,
      stage: c.rows[0]?.stage ?? null,
      stimDay: c.rows[0]?.stim_day ?? null,
      notes: n.rows.map(toNote),
    };
  });
  if (!base) return { shared: false as const };
  const [schedule, results] = await Promise.all([
    base.sections.includes("meds") ? patientSchedule(db, actor, base.patientId, now) : Promise.resolve(null),
    base.sections.includes("results") ? patientResults(db, actor, base.patientId) : Promise.resolve(null),
  ]);
  return { shared: true as const, ...base, schedule, results };
}

/**
 * A partner sends the patient a short note. It's checked for urgent symptoms first: if it
 * mentions one, the app tells the partner to call the nurse line (or 988, or 911) right away.
 * The note still reaches the patient. Clinic staff never see these notes.
 */
export async function sendPartnerNote(db: Db, actor: Actor & { name: string }, text: string): Promise<{ id: string; triage: TriageResult }> {
  const body = text.trim();
  if (!body) throw new HandoffError("Write a note first.");
  if (body.length > 500) throw new HandoffError("Keep notes under 500 characters.");
  return asActor(db, actor, async (tx) => {
    const g = await tx.query<{ patient_id: string }>(
      `SELECT patient_id FROM partner_grants WHERE partner_user_id = $1 AND revoked_at IS NULL AND cardinality(sections) > 0 ORDER BY created_at LIMIT 1`, [actor.userId]);
    const patientId = g.rows[0]?.patient_id;
    if (!patientId) throw new HandoffError("Nothing is shared with you right now.");
    const terms = await tx.query<ClinicTerm>(`SELECT term, level FROM clinic_triage_terms`);
    const t = triage(body, terms.rows);
    const r = await tx.query<{ id: string }>(
      `INSERT INTO partner_notes (clinic_id, patient_id, from_user_id, from_name, body, level) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [actor.clinicId, patientId, actor.userId, actor.name.split(" ")[0], body, t.level]);
    // The audit log records that a note was sent and how it was triaged, never its words.
    await audit(tx, actor, "partner.sent_note", patientId, { level: t.level, rules: t.ruleIds });
    return { id: r.rows[0]!.id, triage: t };
  });
}

/** The patient's view: who she shares with, what, and notes from them. */
export async function patientSharing(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const p = await tx.query<{ partner_user_id: string; partner_name: string; sections: string[]; revoked: boolean }>(`SELECT * FROM kp_partner_names($1)`, [patientId]);
    const n = await tx.query<NoteRow>(
      `SELECT id, from_name, body, level, created_at, seen_at FROM partner_notes WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10`, [patientId]);
    return {
      partners: p.rows.map((r) => ({
        userId: r.partner_user_id, name: r.partner_name,
        sections: r.revoked ? [] : r.sections.filter((s): s is Shareable => (SHAREABLE as readonly string[]).includes(s)),
      })),
      notes: n.rows.map(toNote),
    };
  });
}

/** The patient chooses exactly what a partner sees. An empty choice stops sharing. */
export async function setPartnerSharing(db: Db, actor: Actor, patientId: string, partnerUserId: string, sections: string[]) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can change sharing.");
  const clean = [...new Set(sections)];
  if (clean.some((s) => !(SHAREABLE as readonly string[]).includes(s))) throw new HandoffError("Messages with your care team are always private.");
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string }>(
      clean.length === 0
        ? `UPDATE partner_grants SET revoked_at = now() WHERE patient_id = $1 AND partner_user_id = $2 RETURNING id`
        : `UPDATE partner_grants SET sections = $3::text[], revoked_at = NULL WHERE patient_id = $1 AND partner_user_id = $2 RETURNING id`,
      clean.length === 0 ? [patientId, partnerUserId] : [patientId, partnerUserId, clean]);
    if (!r.rows[0]) throw new HandoffError("That person isn't connected to you.");
    await audit(tx, actor, "patient.changed_partner_sharing", patientId, { partnerUserId, sections: clean });
    return { sections: clean };
  });
}

export async function markNoteSeen(db: Db, actor: Actor, noteId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE partner_notes SET seen_at = now() WHERE id = $1 AND seen_at IS NULL RETURNING patient_id`, [noteId]);
    if (r.rows[0]) await audit(tx, actor, "patient.saw_partner_note", r.rows[0].patient_id, { noteId });
    return true;
  });
}
