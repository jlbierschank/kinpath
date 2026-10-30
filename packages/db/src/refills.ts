/**
 * Refill requests that land with the nurse. From the clinic's app, or from her own Pumpkin when she
 * connected it to her clinic and shares her medications. They go through the same safety check as any
 * message: if the note mentions an urgent symptom, it becomes an urgent item and a person calls her.
 */
import { classifyMessage, HandoffError, triage } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";
import { alertPatient, alertStaffOfMessage } from "./notify";

export interface RefillInput { medication: string; note?: string }

function clean(input: RefillInput) {
  const medication = (input.medication ?? "").trim();
  const note = (input.note ?? "").trim();
  if (!medication) throw new HandoffError("Pick the medication you need more of.");
  if (medication.length > 120) throw new HandoffError("That medication name is too long.");
  if (note.length > 800) throw new HandoffError("That note is too long. Keep it under 800 characters.");
  return { medication, note, message: `Refill request: ${medication}.${note ? ` ${note}` : ""}` };
}
const kindFor = (k: string) => (k === "crisis" || k === "urgent_symptom" ? k : "refill_request");

/** A clinic's patient asks for a refill from the clinic's app. */
export async function requestRefill(db: Db, actor: Actor, patientId: string, input: RefillInput) {
  const { medication, message } = clean(input);
  const r = await asActor(db, actor, async (tx) => {
    const terms = (await tx.query<{ term: string; level: "urgent" | "crisis" }>(`SELECT term, level FROM clinic_triage_terms`)).rows;
    const c = classifyMessage(message, { clinicTerms: terms });
    const kind = kindFor(c.kind);
    const res = await tx.query<{ id: string }>(
      `INSERT INTO handoffs (clinic_id, patient_id, kind, patient_message, triage) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [actor.clinicId, patientId, kind, message, JSON.stringify(c.triage)]);
    await audit(tx, actor, "patient.requested_refill", patientId, { handoffId: res.rows[0]!.id, medication, kind });
    return { handoffId: res.rows[0]!.id, kind };
  });
  await alertStaffOfMessage(db, patientId, r.handoffId, r.kind);
  return r;
}

/** She asks her connected clinic for a refill from her own Pumpkin. It lands on her chart there. */
export async function requestLinkRefill(db: Db, actor: Actor, input: RefillInput) {
  const { medication, message } = clean(input);
  const t = triage(message);
  const kind = t.level === "crisis" ? "crisis" : t.level === "urgent" ? "urgent_symptom" : "refill_request";
  const id = await asActor(db, actor, async (tx) => {
    try {
      return (await tx.query<{ id: string }>(`SELECT kp_link_refill($1,$2,$3,$4) AS id`, [medication, message, JSON.stringify(t), kind])).rows[0]!.id;
    } catch (e) {
      if (/no connected clinic/.test((e as Error).message)) throw new HandoffError("Connect to your clinic and share your medications first.");
      throw e;
    }
  });
  const chart = (await db.query<{ patient_id: string }>(`SELECT patient_id FROM handoffs WHERE id = $1`, [id])).rows[0]!.patient_id;
  await alertStaffOfMessage(db, chart, id, kind);
  return { handoffId: id, kind };
}

export type RefillOutcome = "sent" | "call" | "visit";
const OUTCOME: Record<RefillOutcome, string> = {
  sent: "sent your refill to your pharmacy.",
  call: "will call you about this refill.",
  visit: "needs to see you before this refill. They'll be in touch to book it.",
};

/** A nurse or physician marks a refill request handled. She sees who did it and what happens next. */
export async function closeRefill(db: Db, actor: Actor & { name: string }, handoffId: string, outcome: RefillOutcome, note = "") {
  if (!OUTCOME[outcome]) throw new HandoffError("Pick what happened.");
  if (note.length > 600) throw new HandoffError("That note is too long.");
  const r = await asActor(db, actor, async (tx) => {
    if (actor.role !== "nurse" && actor.role !== "physician") throw new HandoffError(`A ${actor.role} cannot handle refill requests.`);
    const text = `${actor.name} ${OUTCOME[outcome]}${note.trim() ? ` ${note.trim()}` : ""}`;
    const res = await tx.query<{ patient_id: string; via_link: string | null }>(
      `UPDATE handoffs SET status = 'closed', sent_text = $2, sent_by = $3, sent_at = now()
        WHERE id = $1 AND kind = 'refill_request' AND status IN ('open','drafted') RETURNING patient_id, via_link`,
      [handoffId, text, actor.userId]);
    const row = res.rows[0];
    if (!row) throw new HandoffError("This refill request was already handled.");
    await audit(tx, actor, "staff.handled_refill", row.patient_id, { handoffId, outcome });
    return row;
  });
  // From the clinic's app she gets a notice; from her own Pumpkin she sees it on her refills card.
  if (!r.via_link) await alertPatient(db, r.patient_id, "nurse_reply", "Your refill request was handled.");
  return { ok: true };
}

export interface MyRefill { id: string; clinicName: string; medication: string; status: "waiting" | "handled"; outcome: string | null; askedAt: string; handledAt: string | null }

/** Her refill requests to a connected clinic in the last 60 days, newest first. */
export async function myLinkRefills(db: Db, actor: Actor): Promise<MyRefill[]> {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; clinic_name: string; message: string; status: string; outcome: string | null; asked_at: Date; handled_at: Date | null }>(`SELECT * FROM kp_link_my_refills()`);
    return r.rows.map((x) => ({
      id: x.id, clinicName: x.clinic_name, medication: /^Refill request: ([^.]+)\./.exec(x.message)?.[1] ?? "Medication",
      status: x.status === "open" || x.status === "drafted" ? "waiting" : "handled", outcome: x.outcome,
      askedAt: new Date(x.asked_at).toISOString(), handledAt: x.handled_at ? new Date(x.handled_at).toISOString() : null,
    }));
  });
}

export interface PilotMetrics {
  days: number; activeCycles: number; patientsUsing: number; messages: Record<string, number>;
  medianReplyHours: number | null; medianUrgentMinutes: number | null;
  refills: number; refillsFromOwnPumpkin: number; medianRefillHours: number | null;
  callsLogged: number; dosesDue: number; dosesLogged: number; consults: number; consultsToCycles: number; connectedPatients: number;
}

/** Pilot numbers for the clinic, measured from what happens in Pumpkin. Counts only. */
export async function pilotMetrics(db: Db, actor: Actor, days = 30): Promise<PilotMetrics> {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ m: PilotMetrics }>(`SELECT kp_pilot_metrics($1) AS m`, [Math.round(days)]);
    const m = r.rows[0]!.m;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return { ...m, medianReplyHours: num(m.medianReplyHours), medianUrgentMinutes: num(m.medianUrgentMinutes), medianRefillHours: num(m.medianRefillHours) };
  });
}
