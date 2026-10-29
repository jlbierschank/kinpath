/**
 * Graduation to the OB-GYN.
 *
 * - A nurse or physician graduates a patient after a released positive result.
 * - The patient gets a keepsake of her journey (she can leave out any part of it), can send her
 *   care team a thank-you, and can share an IVF pregnancy summary with her OB-GYN through a
 *   secure link that expires in 7 days, includes only what she chooses, and can be stopped.
 * - Her support people learn the outcome only when she chooses to share the news.
 */
import { createHash, randomBytes } from "node:crypto";
import { HandoffError, triage, type ClinicTerm } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";
import { sendPatientMessage } from "./loop";
import { alertPatient, notify, patientInfo, supportPeople } from "./notify";
import { openPersonalLink, type PersonalSummary } from "./kit";

type Staff = Actor & { name: string };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function graduatePatient(db: Db, nurse: Staff, input: { patientId: string; obName: string }) {
  if (nurse.role !== "nurse" && nurse.role !== "physician") throw new HandoffError("Only nurses and physicians can do this.");
  const ob = input.obName.trim();
  if (!ob || ob.length > 120) throw new HandoffError("Add her OB-GYN's name or practice.");
  return asActor(db, nurse, async (tx) => {
    const t = await tx.query<{ outcome: string | null; released_at: Date | null; cycle_id: string }>(
      `SELECT outcome, released_at, cycle_id FROM pregnancy_tests WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 1`, [input.patientId]);
    const test = t.rows[0];
    if (!test || test.outcome !== "positive" || !test.released_at) throw new HandoffError("Graduation comes after a released positive result.");
    await tx.query(`UPDATE cycles SET stage = 'graduated', graduated_on = current_date, ob_name = $2 WHERE id = $1`, [test.cycle_id, ob]);
    await audit(tx, nurse, "cycle.graduated", input.patientId, {});
    return true;
  });
}

export const KEEPSAKE_ITEMS = ["start", "injections", "transfer", "wait", "positive", "graduated"] as const;

/** Everything the patient's graduation screen needs. */
export async function patientGraduation(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const c = await tx.query<{ started_on: string; transfer_on: string | null; graduated_on: string | null; ob_name: string | null }>(
      `SELECT started_on::text, transfer_on::text, graduated_on::text, ob_name FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId]);
    const cyc = c.rows[0];
    const d = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM dose_logs WHERE patient_id = $1 AND taken_at IS NOT NULL`, [patientId]);
    const t = await tx.query<{ scheduled_at: Date; hcg: string | null; released_at: Date | null }>(`SELECT scheduled_at, hcg, released_at FROM kp_pregnancy_test_view($1)`, [patientId]);
    const k = await tx.query<{ hidden: string[] }>(`SELECT hidden FROM keepsakes WHERE patient_id = $1`, [patientId]);
    const s = await tx.query<{ id: string; recipient: string; include_results: boolean; include_meds: boolean; created_at: Date; expires_at: Date; revoked_at: Date | null; views: number; last_viewed_at: Date | null }>(
      `SELECT id, recipient, include_results, include_meds, created_at, expires_at, revoked_at, views, last_viewed_at FROM summary_shares WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 5`, [patientId]);
    const w = await tx.query<{ told_support: boolean }>(`SELECT told_support FROM wait_prefs WHERE patient_id = $1`, [patientId]);
    const days = cyc?.graduated_on ? Math.round((new Date(cyc.graduated_on).getTime() - new Date(cyc.started_on).getTime()) / 86_400_000) + 1 : null;
    return {
      graduatedOn: cyc?.graduated_on ?? null,
      ob: cyc?.ob_name ?? null,
      days,
      keepsake: {
        saved: k.rows.length > 0,
        hidden: k.rows[0]?.hidden ?? [],
        items: [
          { id: "start", date: cyc?.started_on ?? null, injections: null as number | null, hcg: null as number | null },
          { id: "injections", date: null, injections: d.rows[0]!.n, hcg: null },
          { id: "transfer", date: cyc?.transfer_on ?? null, injections: null, hcg: null },
          { id: "wait", date: null, injections: null, hcg: null },
          { id: "positive", date: iso(t.rows[0]?.released_at ?? null), injections: null, hcg: t.rows[0]?.hcg ? Number(t.rows[0].hcg) : null },
          { id: "graduated", date: cyc?.graduated_on ?? null, injections: null, hcg: null },
        ],
      },
      shares: s.rows.map((r) => ({
        id: r.id, recipient: r.recipient, includeResults: r.include_results, includeMeds: r.include_meds,
        createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!, active: !r.revoked_at && new Date(r.expires_at) > new Date(),
        views: r.views, lastViewedAt: iso(r.last_viewed_at),
      })),
      toldSupport: w.rows[0]?.told_support ?? false,
    };
  });
}

export async function saveKeepsake(db: Db, actor: Actor, patientId: string, hidden: string[]) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can save her keepsake.");
  const clean = [...new Set(hidden)].filter((h) => (KEEPSAKE_ITEMS as readonly string[]).includes(h));
  return asActor(db, actor, async (tx) => {
    await tx.query(
      `INSERT INTO keepsakes (patient_id, clinic_id, hidden) VALUES ($1,$2,$3::text[])
       ON CONFLICT (patient_id) DO UPDATE SET hidden = EXCLUDED.hidden, saved_at = now()`, [patientId, actor.clinicId, clean]);
    await audit(tx, actor, "patient.saved_keepsake", patientId, {});
    return true;
  });
}

/** Creates the OB-GYN link. The token is returned once and only its hash is stored. */
export async function createSummaryShare(db: Db, actor: Actor, patientId: string, input: { recipient: string; includeResults: boolean; includeMeds: boolean }) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can share her summary.");
  const recipient = input.recipient.trim();
  if (!recipient || recipient.length > 120) throw new HandoffError("Add who you're sharing with.");
  const token = randomBytes(24).toString("base64url");
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; expires_at: Date }>(
      `INSERT INTO summary_shares (clinic_id, patient_id, created_by, recipient, include_results, include_meds, token_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, expires_at`,
      [actor.clinicId, patientId, actor.userId, recipient, input.includeResults === true, input.includeMeds === true, hash(token)]);
    await audit(tx, actor, "patient.shared_summary", patientId, { shareId: r.rows[0]!.id, recipient, includeResults: input.includeResults, includeMeds: input.includeMeds });
    return { id: r.rows[0]!.id, token, expiresAt: iso(r.rows[0]!.expires_at)! };
  });
}

export async function stopSummaryShare(db: Db, actor: Actor, shareId: string) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE summary_shares SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING patient_id`, [shareId]);
    if (!r.rows[0]) throw new HandoffError("That link is already stopped.");
    await audit(tx, actor, "patient.stopped_summary_share", r.rows[0].patient_id, { shareId });
    return true;
  });
}

export interface SharedSummary {
  patient: string; clinic: string; recipient: string; expiresAt: string;
  cycle: { kind: string; startedOn: string; transferOn: string | null; graduatedOn: string | null; ob: string | null };
  tests: { at: string; hcg: number | null; outcome: string }[] | null;
  labs: { analyte: string; value: number; unit: string; stimDay: number; at: string }[] | null;
  meds: { medication: string; dose: string; taken: number }[] | null;
}

/** Opening the link (no sign-in). Returns null for a wrong, stopped or expired link. */
export async function openSummary(db: Db, token: string): Promise<SharedSummary | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  if ((await db.query<{ kind: string }>(`SELECT kind FROM summary_shares WHERE token_hash = $1`, [hash(token)])).rows[0]?.kind === "personal") return null;
  const r = await db.query<{ s: SharedSummary | null }>(`SELECT kp_open_summary($1) AS s`, [hash(token)]);
  const s = r.rows[0]?.s ?? null;
  if (s) {
    const pid = (await db.query<{ patient_id: string }>(`SELECT patient_id FROM summary_shares WHERE token_hash = $1`, [hash(token)])).rows[0]?.patient_id;
    if (pid) await alertPatient(db, pid, "summary_opened", `${s.recipient} opened your summary.`);
  }
  return s;
}

/** Any summary link: clinic mode (graduation) or her own record. */
export async function openAnySummary(db: Db, token: string): Promise<({ kind: "clinic" } & SharedSummary) | PersonalSummary | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const kind = (await db.query<{ kind: string }>(`SELECT kind FROM summary_shares WHERE token_hash = $1`, [hash(token)])).rows[0]?.kind;
  if (kind === "personal") return openPersonalLink(db, token);
  const s = await openSummary(db, token);
  return s ? { kind: "clinic", ...s } : null;
}

/** She chooses when Jordan and the others hear the news. */
export async function shareNews(db: Db, actor: Actor, patientId: string) {
  const r = await shareNewsTx(db, actor, patientId);
  const p = await patientInfo(db, patientId);
  const people = await supportPeople(db, patientId, "schedule");
  if (p && people.length) await notify(db, { clinicId: p.clinic_id, kind: "news_shared", title: `${p.first_name} shared news with you.`, to: { userIds: people } });
  return r;
}
async function shareNewsTx(db: Db, actor: Actor, patientId: string) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can share her news.");
  return asActor(db, actor, async (tx) => {
    const t = await tx.query<{ released: boolean }>(`SELECT released FROM kp_pregnancy_test_view($1)`, [patientId]);
    if (!t.rows[0]?.released) throw new HandoffError("There's no result to share yet.");
    await tx.query(`INSERT INTO wait_prefs (patient_id, clinic_id, told_support) VALUES ($1,$2,true) ON CONFLICT (patient_id) DO UPDATE SET told_support = true, updated_at = now()`, [patientId, actor.clinicId]);
    await audit(tx, actor, "patient.shared_news_with_support", patientId, {});
    return true;
  });
}

/** What a support person may know: 'positive', 'negative', 'repeat', 'graduated', or null (not shared). */
export async function partnerNews(db: Db, actor: Actor, patientId: string): Promise<string | null> {
  return asActor(db, actor, async (tx) => (await tx.query<{ n: string | null }>(`SELECT kp_shared_news($1) AS n`, [patientId])).rows[0]?.n ?? null);
}

/**
 * A thank-you to the care team. It's still checked for urgent symptoms: if it mentions one, it
 * goes to the nurse queue as an urgent message instead, and the app shows the safety screen.
 */
export async function sendThankYou(db: Db, actor: Actor & { name: string }, patientId: string, text: string) {
  const body = text.trim();
  if (!body) throw new HandoffError("Write a note first.");
  if (body.length > 1000) throw new HandoffError("Keep it under 1,000 characters.");
  const terms = await asActor(db, actor, async (tx) => (await tx.query<ClinicTerm>(`SELECT term, level FROM clinic_triage_terms`)).rows);
  const t = triage(body, terms);
  if (t.level !== "routine") {
    const r = await sendPatientMessage(db, actor, { patientId, text: body });
    return { sent: "urgent" as const, kind: r.kind, handoffId: r.handoffId };
  }
  return asActor(db, actor, async (tx) => {
    await tx.query(`INSERT INTO thank_you_notes (clinic_id, patient_id, from_name, body) VALUES ($1,$2,$3,$4)`, [actor.clinicId, patientId, actor.name, body]);
    await audit(tx, actor, "patient.sent_thank_you", patientId, {});
    return { sent: "thanks" as const };
  }).then(async (r) => {
    const p = await patientInfo(db, patientId);
    if (p) await notify(db, { clinicId: p.clinic_id, kind: "thank_you", title: `${p.first_name} ${p.last_name} sent the team a thank-you.`, link: "/nurse", to: { clinicians: true } });
    return r;
  });
}

export async function thankYouNotes(db: Db, nurse: Actor) {
  if (nurse.role !== "nurse" && nurse.role !== "physician") return [];
  return asActor(db, nurse, async (tx) => {
    const r = await tx.query<{ id: string; from_name: string; body: string; created_at: Date }>(`SELECT id, from_name, body, created_at FROM thank_you_notes ORDER BY created_at DESC LIMIT 5`);
    return r.rows.map((x) => ({ id: x.id, from: x.from_name, body: x.body, at: iso(x.created_at)! }));
  });
}
