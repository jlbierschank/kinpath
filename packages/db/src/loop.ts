/**
 * The first full loop, as database operations. Each function runs as one person under
 * row-level security, writes an audit event, and uses @kinpath/core for every safety decision.
 */
import {
  approveAndSend, buildDraftPrompt, checkAIDraft, classifyMessage, draftFromProtocol, labelResult, HandoffError, pickSections, triage,
  type DraftProvider, type ProtocolText,
  type ClinicRange, type Handoff, type Lang, type TriageResult,
} from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { alertPatient, alertStaffOfMessage, notify } from "./notify";
import { aiProviderFromEnv } from "./ai";
import type { ClinicTerm } from "@kinpath/core";
import { DEFAULT_PREFS, type ReminderPrefs } from "@kinpath/core";

export interface QueueItem {
  id: string;
  patientId: string;
  patientName: string;
  preferredLang: Lang;
  kind: Handoff["kind"];
  status: Handoff["status"];
  patientMessage: string;
  createdAt: string;
  priority: number; // 0 = crisis, 1 = urgent, 2 = everything else
}

interface HandoffRow {
  id: string; patient_id: string; kind: Handoff["kind"]; status: Handoff["status"]; patient_message: string;
  triage: TriageResult; draft: string | null; draft_source: string | null; sent_text: string | null; sent_by: string | null;
  dose_log_id: string | null; created_at: string; sent_at: string | null; read_at: string | null;
}

async function clinicTerms(tx: Tx): Promise<ClinicTerm[]> {
  const r = await tx.query<{ term: string; level: "urgent" | "crisis" }>(`SELECT term, level FROM clinic_triage_terms`);
  return r.rows;
}

function toHandoff(r: HandoffRow): Handoff {
  return {
    id: r.id, patientId: r.patient_id, kind: r.kind, status: r.status, patientMessage: r.patient_message,
    triage: r.triage, attachedDoseLog: [], draft: r.draft, draftSource: r.draft_source, sentText: r.sent_text, sentBy: r.sent_by,
  };
}

/** Patient reports a missed dose (optionally with a note). The note is triaged first. */
export async function reportMissedDose(db: Db, actor: Actor, input: { patientId: string; doseLogId: string; note?: string }) {
  const r = await reportMissedDoseTx(db, actor, input);
  await alertStaffOfMessage(db, input.patientId, r.handoffId, r.kind);
  return r;
}
async function reportMissedDoseTx(db: Db, actor: Actor, input: { patientId: string; doseLogId: string; note?: string }) {
  return asActor(db, actor, async (tx) => {
    const message = input.note?.trim() || "I missed a dose.";
    const { kind, triage } = classifyMessage(message, { reportedMissedDose: true, clinicTerms: await clinicTerms(tx) });
    const upd = await tx.query(`UPDATE dose_logs SET reported_missed_at = now() WHERE id = $1 AND patient_id = $2 AND taken_at IS NULL RETURNING id`, [input.doseLogId, input.patientId]);
    if (upd.rows.length === 0) throw new HandoffError("That dose can't be reported as missed.");
    const res = await tx.query<{ id: string }>(
      `INSERT INTO handoffs (clinic_id, patient_id, kind, patient_message, triage, dose_log_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [actor.clinicId, input.patientId, kind, message, JSON.stringify(triage), input.doseLogId],
    );
    const id = res.rows[0]!.id;
    await audit(tx, actor, "patient.reported_missed_dose", input.patientId, { handoffId: id, kind, triage: triage.ruleIds });
    return { handoffId: id, kind, triage };
  });
}

/** Patient sends a free-text message. Urgent and crisis messages are flagged before anything else happens. */
export async function sendPatientMessage(db: Db, actor: Actor, input: { patientId: string; text: string }) {
  const r = await sendPatientMessageTx(db, actor, input);
  await alertStaffOfMessage(db, input.patientId, r.handoffId, r.kind);
  return r;
}
async function sendPatientMessageTx(db: Db, actor: Actor, input: { patientId: string; text: string }) {
  return asActor(db, actor, async (tx) => {
    const { kind, triage } = classifyMessage(input.text, { clinicTerms: await clinicTerms(tx) });
    const res = await tx.query<{ id: string }>(
      `INSERT INTO handoffs (clinic_id, patient_id, kind, patient_message, triage) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [actor.clinicId, input.patientId, kind, input.text, JSON.stringify(triage)],
    );
    await audit(tx, actor, "patient.sent_message", input.patientId, { handoffId: res.rows[0]!.id, kind });
    return { handoffId: res.rows[0]!.id, kind, triage };
  });
}

export async function nurseQueue(db: Db, actor: Actor): Promise<QueueItem[]> {
  return asActor(db, actor, async (tx) => {
    const res = await tx.query<{ id: string; patient_id: string; first_name: string; last_name: string; preferred_lang: Lang; kind: Handoff["kind"]; status: Handoff["status"]; patient_message: string; created_at: Date }>(
      `SELECT h.id, h.patient_id, p.first_name, p.last_name, p.preferred_lang, h.kind, h.status, h.patient_message, h.created_at
         FROM handoffs h JOIN patients p ON p.id = h.patient_id
        WHERE h.status IN ('open','drafted')
        ORDER BY CASE h.kind WHEN 'crisis' THEN 0 WHEN 'urgent_symptom' THEN 1 ELSE 2 END, h.created_at`,
    );
    return res.rows.map((r) => ({
      id: r.id, patientId: r.patient_id, patientName: `${r.first_name} ${r.last_name}`, preferredLang: r.preferred_lang,
      kind: r.kind, status: r.status, patientMessage: r.patient_message, createdAt: new Date(r.created_at).toISOString(),
      priority: r.kind === "crisis" ? 0 : r.kind === "urgent_symptom" ? 1 : 2,
    }));
  });
}

export interface HandoffDetail {
  handoff: Handoff;
  patientName: string;
  firstName: string;
  lang: Lang;
  stimDay: number | null;
  /** How the draft was made: protocol text, an AI draft that passed every check, or protocol text after an AI draft was held back. */
  draftEngine: "protocol" | "ai" | "ai_held_back" | "ai_error" | null;
  draftProblems: string[];
  doseLog: { medication: string; dose: string; scheduledFor: string; takenAt: string | null; reportedMissed: boolean }[];
}

export async function handoffDetail(db: Db, actor: Actor, handoffId: string): Promise<HandoffDetail | null> {
  return asActor(db, actor, async (tx) => {
    const h = await tx.query<HandoffRow>(`SELECT * FROM handoffs WHERE id = $1`, [handoffId]);
    const row = h.rows[0];
    if (!row) return null;
    const p = await tx.query<{ first_name: string; last_name: string; preferred_lang: Lang }>(`SELECT first_name, last_name, preferred_lang FROM patients WHERE id = $1`, [row.patient_id]);
    const c = await tx.query<{ stim_day: number | null }>(`SELECT stim_day FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [row.patient_id]);
    const doses = await tx.query<{ medication: string; dose: string; scheduled_for: Date; taken_at: Date | null; reported_missed_at: Date | null }>(
      `SELECT m.medication, m.dose, d.scheduled_for, d.taken_at, d.reported_missed_at
         FROM dose_logs d JOIN med_orders m ON m.id = d.med_order_id
        WHERE d.patient_id = $1 AND d.canceled_at IS NULL ORDER BY d.scheduled_for DESC LIMIT 6`, [row.patient_id]);
    await audit(tx, actor, "staff.viewed_handoff", row.patient_id, { handoffId });
    const pt = p.rows[0]!;
    return {
      handoff: toHandoff(row),
      patientName: `${pt.first_name} ${pt.last_name}`,
      firstName: pt.first_name,
      lang: pt.preferred_lang,
      stimDay: c.rows[0]?.stim_day ?? null,
      draftEngine: (row as unknown as { draft_engine: HandoffDetail["draftEngine"] }).draft_engine ?? null,
      draftProblems: (row as unknown as { draft_problems: string[] | null }).draft_problems ?? [],
      doseLog: doses.rows.map((d) => ({
        medication: d.medication, dose: d.dose, scheduledFor: new Date(d.scheduled_for).toISOString(),
        takenAt: d.taken_at ? new Date(d.taken_at).toISOString() : null, reportedMissed: d.reported_missed_at !== null,
      })),
    };
  });
}

/**
 * Draft a reply. Refuses urgent and crisis items. With an AI provider configured, the AI rephrases
 * only the matching approved protocol sections and every draft is checked before the nurse sees it;
 * a draft that fails a check is held back and the protocol text is shown instead, with the reason.
 */
export async function draftReply(db: Db, actor: Actor, handoffId: string, opts: { provider?: DraftProvider | null } = {}) {
  const provider = opts.provider === undefined ? aiProviderFromEnv() : opts.provider;
  const ctx = await asActor(db, actor, async (tx) => {
    const h = await tx.query<HandoffRow>(`SELECT * FROM handoffs WHERE id = $1`, [handoffId]);
    const row = h.rows[0];
    if (!row) throw new HandoffError("Not found.");
    // Never draft for urgent or crisis items, and re-check the words in case they were missed.
    if (row.kind === "urgent_symptom" || row.kind === "crisis" || triage(row.patient_message, await clinicTerms(tx)).level !== "routine") {
      throw new HandoffError("Urgent and crisis messages are never drafted. A person calls the patient.");
    }
    const p = await tx.query<{ first_name: string; preferred_lang: Lang }>(`SELECT first_name, preferred_lang FROM patients WHERE id = $1`, [row.patient_id]);
    let protocolId: string | null = null;
    if (row.kind === "missed_dose" && row.dose_log_id) {
      const m = await tx.query<{ medication: string }>(`SELECT m.medication FROM dose_logs d JOIN med_orders m ON m.id = d.med_order_id WHERE d.id = $1`, [row.dose_log_id]);
      const med = m.rows[0]?.medication.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (med) protocolId = `meds.missed_dose.${med}`;
    }
    const sections = (await tx.query<{ id: string; title: string; body_en: string; body_es: string }>(`SELECT id, title, body_en, body_es FROM protocol_sections`)).rows;
    const meds = (await tx.query<{ medication: string }>(`SELECT medication FROM med_guides`)).rows.map((r) => r.medication);
    return { row, first: p.rows[0]!.first_name, lang: p.rows[0]!.preferred_lang, protocolId, sections, meds };
  });
  const { row, first, lang, protocolId, sections, meds } = ctx;
  const proto = protocolId ? sections.find((s) => s.id === protocolId) : undefined;
  const base = draftFromProtocol(toHandoff(row), proto ? { id: proto.id, title: proto.title, body: { en: proto.body_en, es: proto.body_es } } : undefined, lang, first);
  let result: { draft: string; source: string | null; engine: "protocol" | "ai" | "ai_held_back" | "ai_error"; problems: string[] } = { ...base, engine: "protocol", problems: [] };

  if (provider) {
    const texts: ProtocolText[] = sections.map((s) => ({ id: s.id, title: s.title, body: lang === "es" ? s.body_es : s.body_en }));
    const picked = proto ? [texts.find((t) => t.id === proto.id)!, ...pickSections(row.patient_message, texts.filter((t) => t.id !== proto.id), 2)] : pickSections(row.patient_message, texts, 3);
    if (picked.length > 0) {
      try {
        // The AI never sees the patient's name or record: only her words and the protocol text.
        const out = await provider.complete(buildDraftPrompt({ message: row.patient_message, sections: picked, lang }));
        const check = checkAIDraft(out, picked, meds);
        const greeting = lang === "es" ? `Hola ${first},` : `Hi ${first},`;
        result = check.ok
          ? { draft: `${greeting}\n\n${check.draft}`, source: check.sources.join(", "), engine: "ai", problems: [] }
          : { ...base, engine: "ai_held_back", problems: check.problems };
      } catch {
        result = { ...base, engine: "ai_error", problems: ["the AI service didn't respond"] };
      }
    }
  }

  return asActor(db, actor, async (tx) => {
    await tx.query(`UPDATE handoffs SET draft = $2, draft_source = $3, status = 'drafted', draft_engine = $4, draft_problems = $5 WHERE id = $1`,
      [handoffId, result.draft, result.source, result.engine, result.problems.length ? JSON.stringify(result.problems) : null]);
    // Logged: how it was made and why it was held back. Never the text.
    await audit(tx, actor, "staff.drafted_reply", row.patient_id, { handoffId, source: result.source, engine: result.engine, heldBack: result.problems });
    return result;
  });
}

export async function sendReply(db: Db, actor: Actor & { name: string }, handoffId: string, finalText: string) {
  const sent = await sendReplyTx(db, actor, handoffId, finalText);
  const pid = (await db.query<{ patient_id: string }>(`SELECT patient_id FROM handoffs WHERE id = $1`, [handoffId])).rows[0]?.patient_id;
  if (pid) await alertPatient(db, pid, "nurse_reply", `${actor.name.split(/[ ,]/)[0]} replied to your message.`);
  return sent;
}
async function sendReplyTx(db: Db, actor: Actor & { name: string }, handoffId: string, finalText: string) {
  return asActor(db, actor, async (tx) => {
    const h = await tx.query<HandoffRow>(`SELECT * FROM handoffs WHERE id = $1`, [handoffId]);
    const row = h.rows[0];
    if (!row) throw new HandoffError("Not found.");
    const p = await tx.query<{ preferred_lang: Lang }>(`SELECT preferred_lang FROM patients WHERE id = $1`, [row.patient_id]);
    if (actor.role !== "nurse" && actor.role !== "physician") throw new HandoffError(`A ${actor.role} cannot send clinical replies.`);
    const sent = approveAndSend(toHandoff(row), { userId: actor.userId, name: actor.name, role: actor.role }, finalText, p.rows[0]!.preferred_lang);
    await tx.query(`UPDATE handoffs SET status = 'sent', sent_text = $2, sent_by = $3, sent_at = now() WHERE id = $1`, [handoffId, sent.sentText, actor.userId]);
    await audit(tx, actor, "staff.sent_reply", row.patient_id, { handoffId, edited: row.draft !== null && finalText.trim() !== row.draft });
    return sent;
  });
}

export async function patientInbox(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const res = await tx.query<HandoffRow & { sender: string | null }>(
      `SELECT h.*, u.display_name AS sender FROM handoffs h LEFT JOIN app_users u ON u.id = h.sent_by
        WHERE h.patient_id = $1 AND h.kind <> 'result_review' ORDER BY h.created_at DESC`, [patientId]);
    return res.rows.map((r) => ({ ...toHandoff(r), sender: r.sender, sentAt: r.sent_at, readAt: r.read_at }));
  });
}

export async function markReplyRead(db: Db, actor: Actor, handoffId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE handoffs SET status = 'read', read_at = now() WHERE id = $1 AND status = 'sent' RETURNING patient_id`, [handoffId]);
    if (r.rows[0]) await audit(tx, actor, "patient.read_reply", r.rows[0].patient_id, { handoffId });
    return r.rows.length === 1;
  });
}

/** Pilot path: clinic staff enter a result. Out-of-range results open a nurse task automatically. */
export async function enterLabResult(db: Db, actor: Actor, input: { patientId: string; analyte: string; unit: string; value: number; stimDay: number }) {
  const r = await enterLabResultTx(db, actor, input);
  if (r.label.routeToNurse) {
    const p = (await db.query<{ first_name: string; last_name: string }>(`SELECT first_name, last_name FROM patients WHERE id = $1`, [input.patientId])).rows[0];
    await notify(db, { clinicId: actor.clinicId, kind: "result_to_review", title: `${p?.first_name} ${p?.last_name} · ${input.analyte} to review`, link: "/nurse", to: { clinicians: true }, except: actor.userId });
  }
  return r;
}
async function enterLabResultTx(db: Db, actor: Actor, input: { patientId: string; analyte: string; unit: string; value: number; stimDay: number }) {
  return asActor(db, actor, async (tx) => {
    const ranges = await tx.query<{ analyte: string; unit: string; day_from: number; day_to: number; low: string; high: string; in_range_en: string; in_range_es: string; approved_by: string }>(`SELECT * FROM clinic_ranges`);
    const clinicRanges: ClinicRange[] = ranges.rows.map((r) => ({
      analyte: r.analyte, unit: r.unit, dayFrom: r.day_from, dayTo: r.day_to, low: Number(r.low), high: Number(r.high),
      inRangeText: { en: r.in_range_en, es: r.in_range_es }, approvedBy: r.approved_by,
    }));
    const label = labelResult({ analyte: input.analyte, unit: input.unit, value: input.value, stimDay: input.stimDay }, clinicRanges);
    const res = await tx.query<{ id: string }>(
      `INSERT INTO lab_results (clinic_id, patient_id, analyte, unit, value, stim_day, collected_at, status, entered_by) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8) RETURNING id`,
      [actor.clinicId, input.patientId, input.analyte, input.unit, input.value, input.stimDay, label.status, actor.userId],
    );
    const resultId = res.rows[0]!.id;
    if (label.routeToNurse) {
      await tx.query(
        `INSERT INTO handoffs (clinic_id, patient_id, kind, patient_message, triage, lab_result_id) VALUES ($1,$2,'result_review',$3,$4,$5)`,
        [actor.clinicId, input.patientId, `${input.analyte} ${input.value} ${input.unit} (${label.status.replace("_", " ")})`, JSON.stringify({ level: "routine", ruleIds: [], routeTo: "none" }), resultId],
      );
    }
    await audit(tx, actor, "staff.entered_result", input.patientId, { resultId, status: label.status });
    return { resultId, label };
  });
}

export async function auditLog(db: Db, actor: Actor, limit = 50) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ at: Date; actor: string; action: string; detail: Record<string, unknown> }>(
      `SELECT a.at, u.display_name AS actor, a.action, a.detail FROM audit_events a LEFT JOIN app_users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT $1`, [limit]);
    return r.rows;
  });
}

/** Urgent and crisis items are closed by a person after they call the patient. */
export async function closeAfterCall(db: Db, actor: Actor & { name: string }, handoffId: string, note: string) {
  return asActor(db, actor, async (tx) => {
    if (actor.role !== "nurse" && actor.role !== "physician") throw new HandoffError(`A ${actor.role} cannot close clinical items.`);
    const r = await tx.query<{ patient_id: string }>(
      `UPDATE handoffs SET status = 'closed', sent_text = $2, sent_by = $3, sent_at = now() WHERE id = $1 AND status IN ('open','drafted') RETURNING patient_id`,
      [handoffId, `${actor.name} called you. ${note}`.trim(), actor.userId]);
    if (!r.rows[0]) throw new HandoffError("Already closed.");
    await audit(tx, actor, "staff.called_patient", r.rows[0].patient_id, { handoffId });
  });
}

export interface DoseRow { id: string; medication: string; dose: string; scheduledFor: string; takenAt: string | null; reportedMissed: boolean }

export async function patientToday(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const p = await tx.query<{ first_name: string; preferred_lang: Lang }>(`SELECT first_name, preferred_lang FROM patients WHERE id = $1`, [patientId]);
    const c = await tx.query<{ stage: string; stim_day: number | null }>(`SELECT stage, stim_day FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId]);
    const d = await tx.query<{ id: string; medication: string; dose: string; scheduled_for: Date; taken_at: Date | null; reported_missed_at: Date | null }>(
      `SELECT d.id, m.medication, m.dose, d.scheduled_for, d.taken_at, d.reported_missed_at FROM dose_logs d JOIN med_orders m ON m.id = d.med_order_id
        WHERE d.patient_id = $1 AND d.canceled_at IS NULL ORDER BY d.scheduled_for DESC LIMIT 6`, [patientId]);
    const r = await tx.query<{ id: string }>(`SELECT id FROM lab_results WHERE patient_id = $1`, [patientId]);
    return {
      firstName: p.rows[0]?.first_name ?? null,
      lang: p.rows[0]?.preferred_lang ?? "en",
      stage: c.rows[0]?.stage ?? null,
      stimDay: c.rows[0]?.stim_day ?? null,
      doses: d.rows.map((x): DoseRow => ({ id: x.id, medication: x.medication, dose: x.dose, scheduledFor: new Date(x.scheduled_for).toISOString(), takenAt: x.taken_at ? new Date(x.taken_at).toISOString() : null, reportedMissed: x.reported_missed_at !== null })),
      visibleResults: r.rows.length,
    };
  });
}

export async function patientResults(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const p = await tx.query<{ preferred_lang: Lang }>(`SELECT preferred_lang FROM patients WHERE id = $1`, [patientId]);
    const lang = p.rows[0]?.preferred_lang ?? "en";
    const ranges = await tx.query<{ analyte: string; unit: string; day_from: number; day_to: number; low: string; high: string; in_range_en: string; in_range_es: string; approved_by: string }>(`SELECT * FROM clinic_ranges`);
    const cr: ClinicRange[] = ranges.rows.map((r) => ({ analyte: r.analyte, unit: r.unit, dayFrom: r.day_from, dayTo: r.day_to, low: Number(r.low), high: Number(r.high), inRangeText: { en: r.in_range_en, es: r.in_range_es }, approvedBy: r.approved_by }));
    const res = await tx.query<{ id: string; analyte: string; unit: string; value: string; stim_day: number }>(`SELECT id, analyte, unit, value, stim_day FROM lab_results WHERE patient_id = $1 ORDER BY collected_at DESC`, [patientId]);
    return res.rows.map((r) => ({ id: r.id, analyte: r.analyte, unit: r.unit, value: Number(r.value), stimDay: r.stim_day, label: labelResult({ analyte: r.analyte, unit: r.unit, value: Number(r.value), stimDay: r.stim_day }, cr, lang) }));
  });
}

// ---------- phone app: schedule, walkthroughs, logging, reminder settings ----------

export async function patientSchedule(db: Db, actor: Actor, patientId: string, now = new Date()) {
  return asActor(db, actor, async (tx) => {
    const d = await tx.query<{ id: string; medication: string; dose: string; scheduled_for: Date; taken_at: Date | null; reported_missed_at: Date | null }>(
      `SELECT d.id, m.medication, m.dose, d.scheduled_for, d.taken_at, d.reported_missed_at FROM dose_logs d JOIN med_orders m ON m.id = d.med_order_id
        LEFT JOIN med_guides g ON g.clinic_id = d.clinic_id AND g.medication = m.medication
        WHERE d.patient_id = $1 AND d.canceled_at IS NULL AND d.scheduled_for > $2::timestamptz - interval '3 days' ORDER BY d.scheduled_for, coalesce(g.sort_order, 100), m.medication`, [patientId, now.toISOString()]);
    const rows: DoseRow[] = d.rows.map((x) => ({ id: x.id, medication: x.medication, dose: x.dose, scheduledFor: new Date(x.scheduled_for).toISOString(), takenAt: x.taken_at ? new Date(x.taken_at).toISOString() : null, reportedMissed: x.reported_missed_at !== null }));
    return {
      upcoming: rows.filter((r) => new Date(r.scheduledFor) >= now),
      // Past and not logged: the patient can say "I took it" (late) or "I missed it".
      missed: rows.filter((r) => new Date(r.scheduledFor) < now && r.takenAt === null && !r.reportedMissed),
      recent: rows.filter((r) => new Date(r.scheduledFor) < now).reverse(),
    };
  });
}

export async function logDose(db: Db, actor: Actor, doseLogId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE dose_logs SET taken_at = now() WHERE id = $1 AND taken_at IS NULL RETURNING patient_id`, [doseLogId]);
    if (!r.rows[0]) throw new HandoffError("That dose is already logged or isn't yours.");
    await audit(tx, actor, "patient.logged_dose", r.rows[0].patient_id, { doseLogId });
    return true;
  });
}

export async function medGuide(db: Db, actor: Actor, medication: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ medication: string; steps: Record<Lang, string>[]; video_url: string | null; approved_by: string }>(
      `SELECT medication, steps, video_url, approved_by FROM med_guides WHERE medication = $1`, [medication]);
    return r.rows[0] ?? null;
  });
}

export async function getReminderPrefs(db: Db, actor: Actor, patientId: string): Promise<ReminderPrefs> {
  return asActor(db, actor, async (tx) => {
    const p = await tx.query<{ preferred_lang: Lang }>(`SELECT preferred_lang FROM patients WHERE id = $1`, [patientId]);
    const r = await tx.query<{ lead_minutes: number; follow_up_minutes: number; quiet_start: string; quiet_end: string; lock_screen_detail: boolean }>(
      `SELECT lead_minutes, follow_up_minutes, quiet_start::text, quiet_end::text, lock_screen_detail FROM patient_prefs WHERE patient_id = $1`, [patientId]);
    const row = r.rows[0];
    const lang = p.rows[0]?.preferred_lang ?? "en";
    if (!row) return { ...DEFAULT_PREFS, lang };
    return { leadMinutes: row.lead_minutes, followUpMinutes: row.follow_up_minutes, quietStart: row.quiet_start.slice(0, 5), quietEnd: row.quiet_end.slice(0, 5), lockScreenDetail: row.lock_screen_detail, lang };
  });
}

export async function setLockScreenDetail(db: Db, actor: Actor, patientId: string, on: boolean) {
  return asActor(db, actor, async (tx) => {
    await tx.query(
      `INSERT INTO patient_prefs (patient_id, clinic_id, lock_screen_detail) VALUES ($1,$2,$3)
       ON CONFLICT (patient_id) DO UPDATE SET lock_screen_detail = EXCLUDED.lock_screen_detail`, [patientId, actor.clinicId, on]);
    await audit(tx, actor, "patient.changed_reminder_privacy", patientId, { lockScreenDetail: on });
  });
}
