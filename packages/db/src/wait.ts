/**
 * The two-week wait and result day.
 *
 * - A nurse records the transfer, which moves the cycle to "wait", cancels the rest of the
 *   stimulation doses and schedules the pregnancy blood test.
 * - The patient picks how she wants to hear her result, checks in each day, and can ask for a call.
 * - A nurse enters the hCG and the outcome by hand. Kinpath never decides the outcome.
 * - The result reaches the patient only when the nurse releases it, and only after a phone call if
 *   she asked for one. Support people never see it.
 * - After a negative result the app goes quiet for 14 days and a follow-up call lands on the
 *   nurse's list.
 */
import { HandoffError, type Lang } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";

export type ResultHow = "call" | "app" | "together";
export type Feeling = "okay" | "anxious" | "struggling";
export type Outcome = "positive" | "negative" | "repeat";
type Staff = Actor & { name: string };

export const QUIET_DAYS = 14;
const DAY = 86_400_000;

function requireClinician(a: Actor) {
  if (a.role !== "nurse" && a.role !== "physician") throw new HandoffError("Only nurses and physicians can do this.");
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localMidnight = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y!, m! - 1, d!); };

/** Day N of the wait: the day after transfer is day 1. */
export function waitDay(transferOn: string, now: Date): number {
  return Math.max(1, Math.round((localMidnight(ymd(now)).getTime() - localMidnight(transferOn).getTime()) / DAY));
}

// ---------- clinic side ----------

export async function recordTransfer(db: Db, nurse: Staff, input: { patientId: string; transferOn: string; testAt: string }) {
  requireClinician(nurse);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transferOn)) throw new HandoffError("Enter the transfer date.");
  const testAt = new Date(input.testAt);
  if (Number.isNaN(testAt.getTime())) throw new HandoffError("Enter the blood test date and time.");
  if (testAt.getTime() <= localMidnight(input.transferOn).getTime()) throw new HandoffError("The blood test has to be after the transfer.");
  return asActor(db, nurse, async (tx) => {
    const c = await tx.query<{ id: string; started_on: string }>(`SELECT id, started_on::text FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [input.patientId]);
    const cycleId = c.rows[0]?.id;
    if (!cycleId) throw new HandoffError("No active cycle for this patient.");
    if (input.transferOn < c.rows[0]!.started_on) throw new HandoffError("The transfer date can't be before the cycle started.");
    await tx.query(`UPDATE cycles SET stage = 'wait', transfer_on = $2, stim_day = NULL WHERE id = $1`, [cycleId, input.transferOn]);
    const canceled = await tx.query(
      `UPDATE dose_logs SET canceled_at = now() WHERE patient_id = $1 AND taken_at IS NULL AND reported_missed_at IS NULL AND canceled_at IS NULL AND scheduled_for > now() RETURNING id`,
      [input.patientId]);
    await tx.query(`INSERT INTO pregnancy_tests (clinic_id, patient_id, cycle_id, scheduled_at) VALUES ($1,$2,$3,$4)`, [nurse.clinicId, input.patientId, cycleId, testAt.toISOString()]);
    await audit(tx, nurse, "cycle.recorded_transfer", input.patientId, { transferOn: input.transferOn, testAt: testAt.toISOString(), canceledDoses: canceled.rows.length });
    return { canceledDoses: canceled.rows.length };
  });
}

/** The nurse enters the result. Nothing reaches the patient until releasePregnancyResult. */
export async function enterPregnancyResult(db: Db, nurse: Staff, input: { patientId: string; hcg: number; outcome: string; note: string }) {
  requireClinician(nurse);
  if (!Number.isFinite(input.hcg) || input.hcg < 0) throw new HandoffError("Enter the hCG value.");
  if (!["positive", "negative", "repeat"].includes(input.outcome)) throw new HandoffError("Choose the outcome.");
  const note = input.note.trim();
  if (!note) throw new HandoffError("Write the note the patient will read with her result.");
  if (note.length > 1000) throw new HandoffError("Keep the note under 1,000 characters.");
  return asActor(db, nurse, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `UPDATE pregnancy_tests SET hcg = $2, outcome = $3, nurse_note = $4, entered_by_name = $5
        WHERE id = (SELECT id FROM pregnancy_tests WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 1) AND released_at IS NULL RETURNING id`,
      [input.patientId, input.hcg, input.outcome, note, nurse.name]);
    if (!r.rows[0]) throw new HandoffError("There's no unreleased test to enter a result for.");
    // The audit log records that a result was entered, not what it was.
    await audit(tx, nurse, "result.entered_pregnancy_test", input.patientId, { testId: r.rows[0].id });
    return { testId: r.rows[0].id };
  });
}

/**
 * Releases the result to the patient's app. If she asked to hear by phone (alone or with her
 * partner), the nurse must confirm the call happened first.
 */
export async function releasePregnancyResult(db: Db, nurse: Staff, input: { patientId: string; toldByPhone: boolean }) {
  requireClinician(nurse);
  return asActor(db, nurse, async (tx) => {
    const t = await tx.query<{ id: string; outcome: Outcome | null; released_at: Date | null }>(
      `SELECT id, outcome, released_at FROM pregnancy_tests WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 1`, [input.patientId]);
    const test = t.rows[0];
    if (!test || !test.outcome) throw new HandoffError("Enter the result first.");
    if (test.released_at) throw new HandoffError("This result was already released.");
    const w = await tx.query<{ result_how: ResultHow | null }>(`SELECT result_how FROM wait_prefs WHERE patient_id = $1`, [input.patientId]);
    const how = w.rows[0]?.result_how ?? "call"; // no choice made: call first, the safer default
    if (how !== "app" && !input.toldByPhone) {
      throw new HandoffError(how === "together"
        ? "She asked to hear it on a call with her partner. Call them first, then release."
        : "She asked to hear it by phone. Call her first, then release.");
    }
    await tx.query(`UPDATE pregnancy_tests SET released_at = now(), released_by_name = $2, told_by = $3 WHERE id = $1`, [test.id, nurse.name, input.toldByPhone ? "phone" : "app"]);
    await tx.query(`UPDATE cycles SET stage = 'result' WHERE id = (SELECT cycle_id FROM pregnancy_tests WHERE id = $1)`, [test.id]);
    if (test.outcome === "negative") {
      await tx.query(`INSERT INTO nurse_tasks (clinic_id, patient_id, kind, reason) VALUES ($1,$2,'negative_followup',$3)`,
        [nurse.clinicId, input.patientId, `Follow-up call after a negative result. Her app is quiet for ${QUIET_DAYS} days.`]);
    }
    await audit(tx, nurse, "result.released_pregnancy_test", input.patientId, { testId: test.id, toldBy: input.toldByPhone ? "phone" : "app" });
    return { releasedTo: how };
  });
}

export async function nurseTasks(db: Db, nurse: Actor) {
  requireClinician(nurse);
  return asActor(db, nurse, async (tx) => {
    const r = await tx.query<{ id: string; patient_id: string; first_name: string; last_name: string; kind: string; reason: string; created_at: Date }>(
      `SELECT t.id, t.patient_id, p.first_name, p.last_name, t.kind, t.reason, t.created_at FROM nurse_tasks t JOIN patients p ON p.id = t.patient_id
        WHERE t.done_at IS NULL ORDER BY t.created_at`);
    return r.rows.map((x) => ({ id: x.id, patientId: x.patient_id, patientName: `${x.first_name} ${x.last_name}`, kind: x.kind, reason: x.reason, createdAt: new Date(x.created_at).toISOString() }));
  });
}

export async function completeTask(db: Db, nurse: Staff, taskId: string, note: string) {
  requireClinician(nurse);
  if (!note.trim()) throw new HandoffError("Add a short note about the call.");
  return asActor(db, nurse, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE nurse_tasks SET done_at = now(), done_by_name = $2, done_note = $3 WHERE id = $1 AND done_at IS NULL RETURNING patient_id`, [taskId, nurse.name, note.trim()]);
    if (!r.rows[0]) throw new HandoffError("That task is already done.");
    await audit(tx, nurse, "task.completed", r.rows[0].patient_id, { taskId });
    return true;
  });
}

/** One patient's cycle, for the nurse's patient page. */
export async function nursePatientCycle(db: Db, nurse: Actor, patientId: string) {
  requireClinician(nurse);
  return asActor(db, nurse, async (tx) => {
    const p = await tx.query<{ first_name: string; last_name: string; preferred_lang: Lang }>(`SELECT first_name, last_name, preferred_lang FROM patients WHERE id = $1`, [patientId]);
    if (!p.rows[0]) return null;
    const c = await tx.query<{ stage: string; stim_day: number | null; transfer_on: string | null }>(
      `SELECT stage, stim_day, transfer_on::text FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId]);
    const t = await tx.query<{ id: string; scheduled_at: Date; hcg: string | null; outcome: Outcome | null; nurse_note: string | null; entered_by_name: string | null; released_at: Date | null; released_by_name: string | null; told_by: string | null }>(
      `SELECT * FROM pregnancy_tests WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 1`, [patientId]);
    const w = await tx.query<{ result_how: ResultHow | null }>(`SELECT result_how FROM wait_prefs WHERE patient_id = $1`, [patientId]);
    const k = await tx.query<{ feeling: Feeling; created_at: Date }>(`SELECT feeling, created_at FROM wellbeing_checkins WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 7`, [patientId]);
    const test = t.rows[0];
    await audit(tx, nurse, "nurse.viewed_cycle", patientId);
    return {
      name: `${p.rows[0].first_name} ${p.rows[0].last_name}`, firstName: p.rows[0].first_name, lang: p.rows[0].preferred_lang,
      stage: c.rows[0]?.stage ?? null, stimDay: c.rows[0]?.stim_day ?? null, transferOn: c.rows[0]?.transfer_on ?? null,
      resultHow: w.rows[0]?.result_how ?? null,
      test: test ? {
        id: test.id, scheduledAt: new Date(test.scheduled_at).toISOString(), hcg: test.hcg === null ? null : Number(test.hcg), outcome: test.outcome,
        note: test.nurse_note, enteredBy: test.entered_by_name, releasedAt: test.released_at ? new Date(test.released_at).toISOString() : null,
        releasedBy: test.released_by_name, toldBy: test.told_by,
      } : null,
      checkins: k.rows.map((x) => ({ feeling: x.feeling, at: new Date(x.created_at).toISOString() })),
    };
  });
}

export async function clinicPatients(db: Db, nurse: Actor) {
  requireClinician(nurse);
  return asActor(db, nurse, async (tx) => {
    const r = await tx.query<{ id: string; first_name: string; last_name: string; stage: string | null }>(
      `SELECT p.id, p.first_name, p.last_name, (SELECT stage FROM cycles c WHERE c.patient_id = p.id ORDER BY started_on DESC LIMIT 1) AS stage
         FROM patients p ORDER BY p.last_name, p.first_name`);
    return r.rows.map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, stage: x.stage }));
  });
}

// ---------- patient side ----------

export interface WaitView {
  stage: string | null;
  dayOfWait: number | null;
  testAt: string | null;
  prefs: { resultHow: ResultHow | null; hideDayCount: boolean; quietOff: boolean; toldSupport: boolean };
  checkedInToday: Feeling | null;
  result: null | { outcome: Outcome; hcg: number | null; note: string; by: string; releasedAt: string };
  quietUntil: string | null;
  answers: { id: string; title: string; text: string }[];
}

export async function patientWait(db: Db, actor: Actor, patientId: string, now = new Date()): Promise<WaitView> {
  return asActor(db, actor, async (tx) => {
    const p = await tx.query<{ preferred_lang: Lang }>(`SELECT preferred_lang FROM patients WHERE id = $1`, [patientId]);
    const lang = p.rows[0]?.preferred_lang ?? "en";
    const c = await tx.query<{ stage: string; transfer_on: string | null }>(`SELECT stage, transfer_on::text FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId]);
    const t = await tx.query<{ scheduled_at: Date; released: boolean; outcome: Outcome | null; hcg: string | null; nurse_note: string | null; released_by_name: string | null; released_at: Date | null }>(
      `SELECT * FROM kp_pregnancy_test_view($1)`, [patientId]);
    const w = await tx.query<{ result_how: ResultHow | null; hide_day_count: boolean; quiet_off: boolean; told_support: boolean }>(`SELECT result_how, hide_day_count, quiet_off, told_support FROM wait_prefs WHERE patient_id = $1`, [patientId]);
    const k = await tx.query<{ feeling: Feeling }>(`SELECT feeling FROM wellbeing_checkins WHERE patient_id = $1 AND created_at > $2 ORDER BY created_at DESC LIMIT 1`, [patientId, localMidnight(ymd(now)).toISOString()]);
    const a = await tx.query<{ id: string; title: string; body_en: string; body_es: string }>(`SELECT id, title, body_en, body_es FROM protocol_sections WHERE id LIKE 'wait.%' ORDER BY id`);
    const cycle = c.rows[0];
    const test = t.rows[0];
    const prefs = { resultHow: w.rows[0]?.result_how ?? null, hideDayCount: w.rows[0]?.hide_day_count ?? false, quietOff: w.rows[0]?.quiet_off ?? false, toldSupport: w.rows[0]?.told_support ?? false };
    const result = test?.released && test.outcome && test.nurse_note && test.released_at
      ? { outcome: test.outcome, hcg: test.hcg === null ? null : Number(test.hcg), note: test.nurse_note, by: test.released_by_name ?? "", releasedAt: new Date(test.released_at).toISOString() }
      : null;
    const quietEnds = result?.outcome === "negative" ? new Date(new Date(result.releasedAt).getTime() + QUIET_DAYS * DAY) : null;
    return {
      stage: cycle?.stage ?? null,
      dayOfWait: cycle?.transfer_on ? waitDay(cycle.transfer_on, now) : null,
      testAt: test ? new Date(test.scheduled_at).toISOString() : null,
      prefs,
      checkedInToday: k.rows[0]?.feeling ?? null,
      result,
      quietUntil: quietEnds && quietEnds > now && !prefs.quietOff ? quietEnds.toISOString() : null,
      answers: a.rows.map((r) => ({ id: r.id, title: r.title, text: lang === "es" ? r.body_es : r.body_en })),
    };
  });
}

export async function setWaitPrefs(db: Db, actor: Actor, patientId: string, change: { resultHow?: string; hideDayCount?: boolean; quietOff?: boolean }) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can change this.");
  if (change.resultHow !== undefined && !["call", "app", "together"].includes(change.resultHow)) throw new HandoffError("Choose how you'd like to hear your result.");
  return asActor(db, actor, async (tx) => {
    await tx.query(`INSERT INTO wait_prefs (patient_id, clinic_id) VALUES ($1,$2) ON CONFLICT (patient_id) DO NOTHING`, [patientId, actor.clinicId]);
    await tx.query(
      `UPDATE wait_prefs SET result_how = coalesce($2, result_how), hide_day_count = coalesce($3, hide_day_count), quiet_off = coalesce($4, quiet_off), updated_at = now() WHERE patient_id = $1`,
      [patientId, change.resultHow ?? null, change.hideDayCount ?? null, change.quietOff ?? null]);
    await audit(tx, actor, "patient.changed_wait_prefs", patientId, change);
    return true;
  });
}

/** "How are you today?" Struggling puts a call on the nurse's list. */
export async function checkIn(db: Db, actor: Actor, patientId: string, feeling: string) {
  if (!["okay", "anxious", "struggling"].includes(feeling)) throw new HandoffError("Choose how you're feeling.");
  return asActor(db, actor, async (tx) => {
    await tx.query(`INSERT INTO wellbeing_checkins (clinic_id, patient_id, feeling) VALUES ($1,$2,$3)`, [actor.clinicId, patientId, feeling]);
    if (feeling === "struggling") {
      await tx.query(`INSERT INTO nurse_tasks (clinic_id, patient_id, kind, reason) VALUES ($1,$2,'wellbeing_call','Said she is struggling in the wait. Please call today.')`, [actor.clinicId, patientId]);
    }
    await audit(tx, actor, "patient.checked_in", patientId, { feeling });
    return { nurseWillCall: feeling === "struggling" };
  });
}

const CALL_REASONS = {
  rough_day: "Asked to talk to someone (rough day).",
  counselor: "Asked about a counselor after her result.",
} as const;

export async function askForCall(db: Db, actor: Actor, patientId: string, why: string) {
  if (!(why in CALL_REASONS)) throw new HandoffError("Something went wrong.");
  return asActor(db, actor, async (tx) => {
    await tx.query(`INSERT INTO nurse_tasks (clinic_id, patient_id, kind, reason) VALUES ($1,$2,'wellbeing_call',$3)`, [actor.clinicId, patientId, CALL_REASONS[why as keyof typeof CALL_REASONS]]);
    await audit(tx, actor, "patient.asked_for_call", patientId, { why });
    return true;
  });
}

/** What a support person may know: the stage, the day (unless she hid it) and the test date. Never the result. */
export async function partnerWait(db: Db, actor: Actor, patientId: string, now = new Date()) {
  return asActor(db, actor, async (tx) => {
    const c = await tx.query<{ stage: string; transfer_on: string | null }>(`SELECT stage, transfer_on::text FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId]);
    const t = await tx.query<{ scheduled_at: Date; released: boolean }>(`SELECT scheduled_at, released FROM kp_pregnancy_test_view($1)`, [patientId]);
    const h = await tx.query<{ hide: boolean }>(`SELECT kp_hide_day_count($1) AS hide`, [patientId]);
    const cycle = c.rows[0];
    return {
      dayOfWait: cycle?.transfer_on && !h.rows[0]?.hide ? waitDay(cycle.transfer_on, now) : null,
      testAt: t.rows[0] ? new Date(t.rows[0].scheduled_at).toISOString() : null,
      resultIsIn: t.rows[0]?.released ?? false,
    };
  });
}
