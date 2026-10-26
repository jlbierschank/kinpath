/**
 * The partner side. A partner sees only the sections the patient shares, can read the
 * clinic's injection walkthroughs to help, and can send the patient short private notes.
 * The patient controls sharing. Messages with the care team are never shared.
 */
import { createHash, randomInt } from "node:crypto";
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
      `SELECT patient_id, sections FROM partner_grants WHERE partner_user_id = $1 AND revoked_at IS NULL AND removed_at IS NULL AND cardinality(sections) > 0 ORDER BY created_at LIMIT 1`, [actor.userId]);
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
      `SELECT patient_id FROM partner_grants WHERE partner_user_id = $1 AND revoked_at IS NULL AND removed_at IS NULL AND cardinality(sections) > 0 ORDER BY created_at LIMIT 1`, [actor.userId]);
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
    const p = await tx.query<{ partner_user_id: string; partner_name: string; relationship: Relationship; sections: string[]; revoked: boolean }>(`SELECT * FROM kp_partner_names($1)`, [patientId]);
    const inv = await tx.query<{ id: string; name: string; relationship: Relationship; contact: string; sections: string[]; expires_at: Date }>(
      `SELECT id, name, relationship, contact, sections, expires_at FROM support_invites
        WHERE patient_id = $1 AND accepted_at IS NULL AND canceled_at IS NULL AND expires_at > now() ORDER BY created_at`, [patientId]);
    const n = await tx.query<NoteRow>(
      `SELECT id, from_name, body, level, created_at, seen_at FROM partner_notes WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10`, [patientId]);
    return {
      partners: p.rows.map((r) => ({
        userId: r.partner_user_id, name: r.partner_name, relationship: r.relationship,
        sections: r.revoked ? [] : r.sections.filter((s): s is Shareable => (SHAREABLE as readonly string[]).includes(s)),
      })),
      notes: n.rows.map(toNote),
      invites: inv.rows.map((r) => ({ id: r.id, name: r.name, relationship: r.relationship, contact: r.contact, sections: r.sections as Shareable[], expiresAt: new Date(r.expires_at).toISOString() })),
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
        ? `UPDATE partner_grants SET revoked_at = now() WHERE patient_id = $1 AND partner_user_id = $2 AND removed_at IS NULL RETURNING id`
        : `UPDATE partner_grants SET sections = $3::text[], revoked_at = NULL WHERE patient_id = $1 AND partner_user_id = $2 AND removed_at IS NULL RETURNING id`,
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

// ---------- inviting support people ----------

export const RELATIONSHIPS = ["partner", "family", "friend", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
const MAX_PEOPLE = 5;
// No 0/O, 1/I/L: easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashCode = (code: string) => createHash("sha256").update(normalizeCode(code)).digest("hex");

function cleanContact(raw: string): string {
  const c = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return c.toLowerCase();
  const digits = c.replace(/[^0-9+]/g, "");
  if (/^\+?[0-9]{10,15}$/.test(digits)) return digits;
  throw new HandoffError("Enter a mobile number or an email address.");
}

/**
 * The patient invites someone and picks what they'll see. Returns the one-time code, which is
 * shown once and never stored (only its hash is). The patient sends it with her phone's share sheet.
 */
export async function createInvite(db: Db, actor: Actor, patientId: string, input: { name: string; relationship: string; contact: string; sections: string[] }) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can invite someone.");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new HandoffError("Add their name.");
  if (!(RELATIONSHIPS as readonly string[]).includes(input.relationship)) throw new HandoffError("Choose how you know them.");
  const contact = cleanContact(input.contact);
  const sections = [...new Set(input.sections)];
  if (sections.length === 0) throw new HandoffError("Choose at least one thing to share.");
  if (sections.some((x) => !(SHAREABLE as readonly string[]).includes(x))) throw new HandoffError("Messages with your care team are always private.");
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return asActor(db, actor, async (tx) => {
    const n = await tx.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM partner_grants WHERE patient_id = $1 AND removed_at IS NULL)
            + (SELECT count(*) FROM support_invites WHERE patient_id = $1 AND accepted_at IS NULL AND canceled_at IS NULL AND expires_at > now()) AS n`, [patientId]);
    if (Number(n.rows[0]!.n) >= MAX_PEOPLE) throw new HandoffError(`You can have up to ${MAX_PEOPLE} support people. Remove someone first.`);
    const r = await tx.query<{ id: string; expires_at: Date }>(
      `INSERT INTO support_invites (clinic_id, patient_id, invited_by, name, relationship, contact, sections, code_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8) RETURNING id, expires_at`,
      [actor.clinicId, patientId, actor.userId, name, input.relationship, contact, sections, hashCode(code)]);
    await audit(tx, actor, "patient.invited_support_person", patientId, { inviteId: r.rows[0]!.id, relationship: input.relationship, sections });
    return { id: r.rows[0]!.id, code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(r.rows[0]!.expires_at).toISOString() };
  });
}

export async function cancelInvite(db: Db, actor: Actor, inviteId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(
      `UPDATE support_invites SET canceled_at = now() WHERE id = $1 AND accepted_at IS NULL AND canceled_at IS NULL RETURNING patient_id`, [inviteId]);
    if (!r.rows[0]) throw new HandoffError("That invite was already used or canceled.");
    await audit(tx, actor, "patient.canceled_invite", r.rows[0].patient_id, { inviteId });
    return true;
  });
}

/** Ends someone's access and takes them off the patient's list. */
export async function removeSupportPerson(db: Db, actor: Actor, patientId: string, partnerUserId: string) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can remove someone.");
  return asActor(db, actor, async (tx) => {
    const r = await tx.query(
      `UPDATE partner_grants SET revoked_at = coalesce(revoked_at, now()), removed_at = now() WHERE patient_id = $1 AND partner_user_id = $2 AND removed_at IS NULL RETURNING id`,
      [patientId, partnerUserId]);
    if (!r.rows[0]) throw new HandoffError("That person isn't connected to you.");
    await audit(tx, actor, "patient.removed_support_person", patientId, { partnerUserId });
    return true;
  });
}

const ACCEPT_ERRORS: Record<string, string> = {
  invite_invalid: "That code didn't work. It may have expired or already been used. Ask for a new one.",
  name_invalid: "Add your name.",
  already_connected: "This phone number or email is already connected. Sign in instead.",
};

/**
 * The invited person enters the code. This runs before they have an account, through one
 * narrow database function, the way a sign-up service would.
 */
export async function acceptInvite(db: Db, code: string, name: string) {
  if (normalizeCode(code).length !== 8) throw new HandoffError(ACCEPT_ERRORS.invite_invalid!);
  try {
    const r = await db.query<{ user_id: string; clinic_id: string; patient_first_name: string }>(`SELECT * FROM kp_accept_invite($1, $2)`, [hashCode(code), name]);
    const row = r.rows[0]!;
    return { userId: row.user_id, clinicId: row.clinic_id, patientFirstName: row.patient_first_name, name: name.trim() };
  } catch (e) {
    const key = Object.keys(ACCEPT_ERRORS).find((k) => (e as Error).message.includes(k));
    if (key) throw new HandoffError(ACCEPT_ERRORS[key]!);
    throw e;
  }
}
