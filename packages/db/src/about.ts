/**
 * "Make Pumpkin yours" and "How Pumpkin talks to me". Only the patient can read or change these.
 * Identity and health answers (gender, family path, her person, background) need her consent first;
 * withdrawing it clears them. Works for any patient, in her own space or a clinic's.
 */
import {
  ABOUT_STEPS, CONDITIONS, FAMILY_PATHS, HandoffError, SENSITIVE_FIELDS, cleanConditions, cleanPaths, cleanPronouns, cleanTitle,
  suggestedQuestions, tenderOn, validTenderDate, type AboutStep, type Condition, type FamilyPath, type TenderDate,
} from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";

export interface About {
  firstName: string; displayName: string;
  preferredName: string | null; pronunciation: string | null; pronouns: string | null;
  consented: boolean;
  gender: string | null; familyPath: FamilyPath[]; partnerName: string | null; partnerPronouns: string | null; partnerTitle: string | null;
  conditions: Condition[]; conditionsOther: string | null; pastCycles: number | null; pastLoss: "yes" | "no" | "skip" | null; allergies: string | null;
  tone: "facts" | "reassure"; revealResults: boolean; costCheckins: "always" | "when_due";
  pauseUntil: string | null; onBreak: boolean;
  alias: string | null; aliasIcon: string | null; aliasTint: string | null; aliasShows: ("stage" | "path")[];
  stepsLeft: AboutStep[];
  tenderDates: { id: string; month: number; day: number; year: number | null; label: string | null; mode: "quiet" | "gentle" }[];
}
export type AboutInput = Partial<Pick<About, "preferredName" | "pronunciation" | "pronouns" | "gender" | "familyPath" | "partnerName" | "partnerPronouns" | "partnerTitle"
  | "conditions" | "conditionsOther" | "pastCycles" | "pastLoss" | "allergies" | "tone" | "revealResults" | "costCheckins">>;

interface Row {
  preferred_name: string | null; pronunciation: string | null; pronouns: string | null; sensitive_consent_at: Date | null; gender: string | null; family_path: string[];
  partner_name: string | null; partner_pronouns: string | null; partner_title: string | null; conditions: string[]; conditions_other: string | null; past_cycles: number | null;
  past_loss: "yes" | "no" | "skip" | null; allergies: string | null; tone: "facts" | "reassure"; reveal_results: boolean; cost_checkins: "always" | "when_due";
  pause_until: Date | null; on_break: boolean; alias: string | null; alias_icon: string | null; alias_tint: string | null; alias_shows: ("stage" | "path")[]; steps_done: string[];
}
const EMPTY: Row = {
  preferred_name: null, pronunciation: null, pronouns: null, sensitive_consent_at: null, gender: null, family_path: [], partner_name: null, partner_pronouns: null,
  partner_title: null, conditions: [], conditions_other: null, past_cycles: null, past_loss: null, allergies: null, tone: "facts", reveal_results: false,
  cost_checkins: "always", pause_until: null, on_break: false, alias: null, alias_icon: null, alias_tint: null, alias_shows: [], steps_done: [],
};
const text = (v: unknown, max: number) => { if (v === null || v === undefined) return null; const s = String(v).trim().replace(/\s+/g, " "); return s ? s.slice(0, max) : null; };

async function readRow(tx: Tx, patientId: string): Promise<Row> {
  return (await tx.query<Row>(`SELECT * FROM patient_about WHERE patient_id = $1`, [patientId])).rows[0] ?? { ...EMPTY };
}
async function writeRow(tx: Tx, actor: Actor, patientId: string, r: Row) {
  await tx.query(
    `INSERT INTO patient_about (patient_id, clinic_id, preferred_name, pronunciation, pronouns, sensitive_consent_at, gender, family_path, partner_name, partner_pronouns, partner_title,
       conditions, conditions_other, past_cycles, past_loss, allergies, tone, reveal_results, cost_checkins, pause_until, on_break, alias, alias_icon, alias_tint, alias_shows, steps_done, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26, now())
     ON CONFLICT (patient_id) DO UPDATE SET preferred_name = EXCLUDED.preferred_name, pronunciation = EXCLUDED.pronunciation, pronouns = EXCLUDED.pronouns,
       sensitive_consent_at = EXCLUDED.sensitive_consent_at, gender = EXCLUDED.gender, family_path = EXCLUDED.family_path, partner_name = EXCLUDED.partner_name,
       partner_pronouns = EXCLUDED.partner_pronouns, partner_title = EXCLUDED.partner_title, conditions = EXCLUDED.conditions, conditions_other = EXCLUDED.conditions_other,
       past_cycles = EXCLUDED.past_cycles, past_loss = EXCLUDED.past_loss, allergies = EXCLUDED.allergies, tone = EXCLUDED.tone, reveal_results = EXCLUDED.reveal_results,
       cost_checkins = EXCLUDED.cost_checkins, pause_until = EXCLUDED.pause_until, on_break = EXCLUDED.on_break, alias = EXCLUDED.alias, alias_icon = EXCLUDED.alias_icon,
       alias_tint = EXCLUDED.alias_tint, alias_shows = EXCLUDED.alias_shows, steps_done = EXCLUDED.steps_done, updated_at = now()`,
    [patientId, actor.clinicId, r.preferred_name, r.pronunciation, r.pronouns, r.sensitive_consent_at, r.gender, r.family_path, r.partner_name, r.partner_pronouns, r.partner_title,
      r.conditions, r.conditions_other, r.past_cycles, r.past_loss, r.allergies, r.tone, r.reveal_results, r.cost_checkins, r.pause_until, r.on_break, r.alias, r.alias_icon,
      r.alias_tint, r.alias_shows, r.steps_done]);
}
function requirePatient(actor: Actor) { if (actor.role !== "patient") throw new HandoffError("Only you can see or change this."); }

async function load(tx: Tx, patientId: string): Promise<About> {
  const p = (await tx.query<{ first_name: string }>(`SELECT first_name FROM patients WHERE id = $1`, [patientId])).rows[0];
  if (!p) throw new HandoffError("We couldn't find your record. Sign in again.");
  const r = await readRow(tx, patientId);
  const t = await tx.query<{ id: string; month: number; day: number; year: number | null; label: string | null; mode: "quiet" | "gentle" }>(
    `SELECT id, month, day, year, label, mode FROM tender_dates WHERE patient_id = $1 ORDER BY month, day`, [patientId]);
  return {
    firstName: p.first_name, displayName: r.preferred_name ?? p.first_name,
    preferredName: r.preferred_name, pronunciation: r.pronunciation, pronouns: r.pronouns, consented: r.sensitive_consent_at !== null,
    gender: r.gender, familyPath: r.family_path as FamilyPath[], partnerName: r.partner_name, partnerPronouns: r.partner_pronouns, partnerTitle: r.partner_title,
    conditions: r.conditions as Condition[], conditionsOther: r.conditions_other, pastCycles: r.past_cycles, pastLoss: r.past_loss, allergies: r.allergies,
    tone: r.tone, revealResults: r.reveal_results, costCheckins: r.cost_checkins,
    pauseUntil: r.pause_until && new Date(r.pause_until) > new Date() ? new Date(r.pause_until).toISOString() : null, onBreak: r.on_break,
    alias: r.alias, aliasIcon: r.alias_icon, aliasTint: r.alias_tint, aliasShows: r.alias_shows,
    stepsLeft: (Object.keys(ABOUT_STEPS) as AboutStep[]).filter((s) => !r.steps_done.includes(s)),
    tenderDates: t.rows,
  };
}

export async function aboutMe(db: Db, actor: Actor, patientId: string): Promise<About> {
  requirePatient(actor);
  return asActor(db, actor, (tx) => load(tx, patientId));
}

/**
 * Saves part of her profile. Identity and health answers need `consent: true` the first time.
 * `step` marks that step of "Make Pumpkin yours" as done (also used to skip a step).
 */
export async function saveAbout(db: Db, actor: Actor, patientId: string, patch: AboutInput, opts: { consent?: boolean; step?: AboutStep } = {}) {
  requirePatient(actor);
  return asActor(db, actor, async (tx) => {
    const r = await readRow(tx, patientId);
    const has = (k: keyof AboutInput) => Object.prototype.hasOwnProperty.call(patch, k);
    if (has("preferredName")) r.preferred_name = text(patch.preferredName, 60);
    if (has("pronunciation")) r.pronunciation = text(patch.pronunciation, 80);
    if (has("pronouns")) r.pronouns = cleanPronouns(patch.pronouns);
    if (has("gender")) r.gender = text(patch.gender, 60);
    if (has("familyPath")) r.family_path = cleanPaths(patch.familyPath);
    if (has("partnerName")) r.partner_name = text(patch.partnerName, 60);
    if (has("partnerPronouns")) r.partner_pronouns = cleanPronouns(patch.partnerPronouns);
    if (has("partnerTitle")) r.partner_title = cleanTitle(patch.partnerTitle);
    if (has("conditions")) r.conditions = cleanConditions(patch.conditions);
    if (has("conditionsOther")) r.conditions_other = text(patch.conditionsOther, 300);
    if (has("pastCycles")) {
      const n = patch.pastCycles === null || patch.pastCycles === undefined || (patch.pastCycles as unknown) === "" ? null : Number(patch.pastCycles);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 50)) throw new HandoffError("Past cycles should be a whole number, like 2.");
      r.past_cycles = n;
    }
    if (has("pastLoss")) r.past_loss = patch.pastLoss === "yes" || patch.pastLoss === "no" || patch.pastLoss === "skip" ? patch.pastLoss : null;
    if (has("allergies")) r.allergies = text(patch.allergies, 300);
    if (has("tone")) r.tone = patch.tone === "reassure" ? "reassure" : "facts";
    if (has("revealResults")) r.reveal_results = patch.revealResults === true;
    if (has("costCheckins")) r.cost_checkins = patch.costCheckins === "when_due" ? "when_due" : "always";
    const sensitiveTouched = SENSITIVE_FIELDS.some((k) => has(k as keyof AboutInput));
    if (opts.consent) r.sensitive_consent_at = r.sensitive_consent_at ?? new Date();
    const anySensitive = r.gender || r.family_path.length || r.partner_name || r.partner_pronouns || r.partner_title || r.conditions.length || r.conditions_other || r.past_cycles !== null || r.past_loss || r.allergies;
    if (anySensitive && !r.sensitive_consent_at) throw new HandoffError("Before you add this, tick that it's OK for Pumpkin to keep these answers.");
    if (opts.step && opts.step in ABOUT_STEPS && !r.steps_done.includes(opts.step)) r.steps_done = [...r.steps_done, opts.step];
    await writeRow(tx, actor, patientId, r);
    // Only which parts changed, never the answers themselves.
    await audit(tx, actor, "patient.updated_about", patientId, { fields: Object.keys(patch), sensitive: sensitiveTouched, step: opts.step ?? null });
    return load(tx, patientId);
  });
}

/** She withdraws consent: every identity and health answer is cleared. */
export async function withdrawAboutConsent(db: Db, actor: Actor, patientId: string) {
  requirePatient(actor);
  return asActor(db, actor, async (tx) => {
    await tx.query(`UPDATE patient_about SET sensitive_consent_at = NULL, gender = NULL, family_path = '{}', partner_name = NULL, partner_pronouns = NULL, partner_title = NULL,
      conditions = '{}', conditions_other = NULL, past_cycles = NULL, past_loss = NULL, allergies = NULL, updated_at = now() WHERE patient_id = $1`, [patientId]);
    await audit(tx, actor, "patient.withdrew_about_consent", patientId, {});
    return load(tx, patientId);
  });
}

// ---------- quiet times ----------

export async function addTenderDate(db: Db, actor: Actor, patientId: string, d: { month: number; day: number; year?: number | null; label?: string | null; mode?: "quiet" | "gentle" }) {
  requirePatient(actor);
  const year = d.year ? Number(d.year) : null;
  if (!validTenderDate(Number(d.month), Number(d.day), year)) throw new HandoffError("Check the date.");
  return asActor(db, actor, async (tx) => {
    const n = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tender_dates WHERE patient_id = $1`, [patientId])).rows[0]!.n;
    if (n >= 20) throw new HandoffError("You can keep up to 20 dates.");
    await tx.query(`INSERT INTO tender_dates (patient_id, clinic_id, month, day, year, label, mode) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [patientId, actor.clinicId, Number(d.month), Number(d.day), year, text(d.label, 60), d.mode === "gentle" ? "gentle" : "quiet"]);
    await audit(tx, actor, "patient.added_quiet_date", patientId, {});
    return load(tx, patientId);
  });
}
export async function deleteTenderDate(db: Db, actor: Actor, patientId: string, id: string) {
  requirePatient(actor);
  return asActor(db, actor, async (tx) => { await tx.query(`DELETE FROM tender_dates WHERE id = $1 AND patient_id = $2`, [id, patientId]); return load(tx, patientId); });
}

/** Pause everything but medication reminders for some days, or take a break until she comes back. */
export async function setQuiet(db: Db, actor: Actor, patientId: string, q: { pauseDays?: number | null; onBreak?: boolean }) {
  requirePatient(actor);
  return asActor(db, actor, async (tx) => {
    const r = await readRow(tx, patientId);
    if (q.pauseDays !== undefined) {
      if (q.pauseDays !== null && (!Number.isInteger(q.pauseDays) || q.pauseDays < 1 || q.pauseDays > 30)) throw new HandoffError("Pause for 1 to 30 days.");
      r.pause_until = q.pauseDays === null ? null : new Date(Date.now() + q.pauseDays * 86400_000);
    }
    if (q.onBreak !== undefined) r.on_break = q.onBreak;
    await writeRow(tx, actor, patientId, r);
    await audit(tx, actor, "patient.changed_quiet", patientId, { pauseDays: q.pauseDays ?? null, onBreak: q.onBreak ?? null });
    return load(tx, patientId);
  });
}

/** What today should feel like: a tender date (quiet or gentle), a pause, or a break. */
export async function todayFeel(tx: Tx, patientId: string) {
  const day = (await tx.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id = kp_clinic()), 'YYYY-MM-DD') AS d`)).rows[0]!.d;
  const dates = (await tx.query<TenderDate>(`SELECT month, day, year, label, mode FROM tender_dates WHERE patient_id = $1`, [patientId])).rows;
  const r = await readRow(tx, patientId);
  const tender = tenderOn(day, dates);
  const paused = !!(r.pause_until && new Date(r.pause_until) > new Date());
  return {
    tender: tender ? { mode: tender.mode, label: tender.label } : null,
    paused, pauseUntil: paused ? new Date(r.pause_until!).toISOString() : null, onBreak: r.on_break,
    quiet: r.on_break || paused || tender?.mode === "quiet",
  };
}

// ---------- community alias ----------

export async function setAlias(db: Db, actor: Actor, patientId: string, a: { alias: string; icon?: string; tint?: string; shows?: string[] }) {
  requirePatient(actor);
  const alias = (a.alias ?? "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{1,22}[A-Za-z0-9]$/.test(alias)) throw new HandoffError("Use 3 to 24 letters or numbers (spaces, dots, dashes and underscores are OK in the middle).");
  return asActor(db, actor, async (tx) => {
    const p = (await tx.query<{ first_name: string; last_name: string }>(`SELECT first_name, last_name FROM patients WHERE id = $1`, [patientId])).rows[0];
    const lower = alias.toLowerCase();
    if (p && [p.first_name, p.last_name, `${p.first_name} ${p.last_name}`].some((n) => n && lower.includes(n.toLowerCase()) && n.length >= 3)) {
      throw new HandoffError("Pick a name that doesn't include your real name, so the community can't tell who you are.");
    }
    const r = await readRow(tx, patientId);
    r.alias = alias;
    r.alias_icon = ["heart", "people", "calendar", "pen", "doc", "eye", "tag", "shield"].includes(a.icon ?? "") ? a.icon! : "heart";
    r.alias_tint = ["lav", "sage", "clay", "oat"].includes(a.tint ?? "") ? a.tint! : "lav";
    r.alias_shows = (a.shows ?? []).filter((s): s is "stage" | "path" => s === "stage" || s === "path");
    await tx.exec("SAVEPOINT kp_alias");
    try { await writeRow(tx, actor, patientId, r); await tx.exec("RELEASE SAVEPOINT kp_alias"); }
    catch (e) {
      await tx.exec("ROLLBACK TO SAVEPOINT kp_alias");
      if (/patient_about_alias|unique/i.test(String((e as Error).message))) throw new HandoffError("Someone already has that name. Try another.");
      throw e;
    }
    await audit(tx, actor, "patient.set_alias", patientId, {});
    return load(tx, patientId);
  });
}

// ---------- visit help ----------

/** Questions she might want to ask, for her stage, path and background, that she hasn't already added. */
export async function questionIdeas(db: Db, actor: Actor, patientId: string) {
  requirePatient(actor);
  return asActor(db, actor, async (tx) => {
    const a = await readRow(tx, patientId);
    const stage = (await tx.query<{ stage: string }>(`SELECT stage FROM personal_profiles WHERE patient_id = $1`, [patientId])).rows[0]?.stage
      ?? ({ consult: "just_starting", stimulation: "in_cycle", wait: "two_week_wait", result: "after_hard_result" } as Record<string, string>)[
        (await tx.query<{ stage: string }>(`SELECT stage FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId])).rows[0]?.stage ?? ""] ?? "just_starting";
    const have = (await tx.query<{ question: string }>(`SELECT question FROM visit_questions WHERE patient_id = $1`, [patientId])).rows.map((x) => x.question);
    return suggestedQuestions({ stage, paths: a.family_path as FamilyPath[], conditions: a.conditions as Condition[], pastLoss: a.past_loss }, have);
  });
}

/** One page to bring to a visit: what she's chosen to record, in plain words. She shares it herself. */
export async function visitSummary(db: Db, actor: Actor, patientId: string) {
  requirePatient(actor);
  return asActor(db, actor, async (tx) => {
    const a = await load(tx, patientId);
    const meds = await tx.query<{ medication: string; dose: string; t: string }>(
      `SELECT medication, dose, to_char(time_of_day, 'HH24:MI') AS t FROM med_orders WHERE patient_id = $1 AND status = 'active' ORDER BY medication`, [patientId]);
    const results = await tx.query<{ name: string; value: string; unit: string; on: string; ref_text: string | null }>(
      `SELECT DISTINCT ON (analyte, coalesce(test_name, '')) coalesce(test_name, analyte) AS name, value::text, unit,
              to_char(collected_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id = lab_results.clinic_id), 'YYYY-MM-DD') AS on, ref_text
         FROM lab_results WHERE patient_id = $1 ORDER BY analyte, coalesce(test_name, ''), collected_at DESC`, [patientId]);
    const qs = await tx.query<{ question: string }>(`SELECT question FROM visit_questions WHERE patient_id = $1 AND asked_at IS NULL ORDER BY created_at`, [patientId]);
    await audit(tx, actor, "patient.viewed_visit_summary", patientId, {});
    return {
      name: a.displayName + (a.pronunciation ? ` (says it "${a.pronunciation}")` : ""), pronouns: a.pronouns,
      path: a.familyPath.filter((p) => p !== "prefer_not").map((p) => FAMILY_PATHS[p]),
      person: a.partnerName ? `${a.partnerName}${a.partnerTitle ? `, ${a.partnerTitle}` : ""}${a.partnerPronouns ? ` (${a.partnerPronouns})` : ""}` : null,
      background: [...a.conditions.map((c) => CONDITIONS[c]), ...(a.conditionsOther ? [a.conditionsOther] : [])],
      pastCycles: a.pastCycles, pastLoss: a.pastLoss === "yes", allergies: a.allergies,
      meds: meds.rows.map((m) => `${m.medication} ${m.dose} at ${m.t}`),
      results: results.rows.map((r) => `${r.name}: ${Number(r.value)} ${r.unit} (${r.on})${r.ref_text ? `, lab range ${r.ref_text}` : ""}`),
      questions: qs.rows.map((q) => q.question),
    };
  });
}
