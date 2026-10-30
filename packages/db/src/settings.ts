/**
 * Clinic settings: the patient-facing content nurses and physicians control.
 * Every write is checked by @kinpath/core, limited to clinicians by row-level security,
 * and recorded in content_changes with before and after.
 */
import {
  BUILT_IN_RULES, checkPatientText, checkRange, checkSteps, checkTriageTerm, checkVideoUrl, ContentError,
  type Lang, type RangeInput,
} from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";

export type Editor = Actor & { name: string };

function requireClinician(a: Actor) {
  if (a.role !== "nurse" && a.role !== "physician") throw new ContentError("Only nurses and physicians can change what patients see.");
}

async function record(tx: Tx, a: Editor, area: string, item: string, action: string, before: unknown, after: unknown) {
  await tx.query(
    `INSERT INTO content_changes (clinic_id, changed_by, changed_by_name, area, item, action, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.clinicId, a.userId, a.name, area, item, action, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
  );
  await audit(tx, a, `settings.${area}.${action}`, null, { item });
}

export interface RangeRow extends RangeInput { id: string; approvedBy: string; updatedAt: string }
export interface ProtocolRow { id: string; title: string; bodyEn: string; bodyEs: string; approvedBy: string; updatedAt: string }
export interface GuideRow { medication: string; steps: Record<Lang, string>[]; videoUrl: string | null; sortOrder: number; approvedBy: string; updatedAt: string }
export interface TermRow { id: string; term: string; level: "urgent" | "crisis"; addedBy: string; addedAt: string }
export interface ChangeRow { at: string; by: string; area: string; item: string; action: string; before: unknown; after: unknown }

export async function clinicSettings(db: Db, actor: Actor) {
  return asActor(db, actor, async (tx) => {
    const ranges = await tx.query<{ id: string; analyte: string; unit: string; day_from: number; day_to: number; low: string; high: string; in_range_en: string; in_range_es: string; approved_by: string; updated_at: Date }>(
      `SELECT * FROM clinic_ranges ORDER BY analyte, day_from`);
    const protocols = await tx.query<{ id: string; title: string; body_en: string; body_es: string; approved_by: string; updated_at: Date }>(`SELECT * FROM protocol_sections ORDER BY title`);
    const guides = await tx.query<{ medication: string; steps: Record<Lang, string>[]; video_url: string | null; sort_order: number; approved_by: string; updated_at: Date }>(`SELECT * FROM med_guides ORDER BY sort_order, medication`);
    const terms = await tx.query<{ id: string; term: string; level: "urgent" | "crisis"; added_by: string; added_at: Date }>(`SELECT * FROM clinic_triage_terms ORDER BY added_at DESC`);
    const changes = await tx.query<{ at: Date; changed_by_name: string; area: string; item: string; action: string; before: unknown; after: unknown }>(
      `SELECT at, changed_by_name, area, item, action, before, after FROM content_changes ORDER BY id DESC LIMIT 50`);
    return {
      canEdit: actor.role === "nurse" || actor.role === "physician",
      ranges: ranges.rows.map((r): RangeRow => ({ id: r.id, analyte: r.analyte, unit: r.unit, dayFrom: r.day_from, dayTo: r.day_to, low: Number(r.low), high: Number(r.high), inRangeEn: r.in_range_en, inRangeEs: r.in_range_es, approvedBy: r.approved_by, updatedAt: new Date(r.updated_at).toISOString() })),
      protocols: protocols.rows.map((p): ProtocolRow => ({ id: p.id, title: p.title, bodyEn: p.body_en, bodyEs: p.body_es, approvedBy: p.approved_by, updatedAt: new Date(p.updated_at).toISOString() })),
      guides: guides.rows.map((g): GuideRow => ({ medication: g.medication, steps: g.steps, videoUrl: g.video_url, sortOrder: g.sort_order, approvedBy: g.approved_by, updatedAt: new Date(g.updated_at).toISOString() })),
      terms: terms.rows.map((t): TermRow => ({ id: t.id, term: t.term, level: t.level, addedBy: t.added_by, addedAt: new Date(t.added_at).toISOString() })),
      builtInRules: BUILT_IN_RULES,
      changes: changes.rows.map((c): ChangeRow => ({ at: new Date(c.at).toISOString(), by: c.changed_by_name, area: c.area, item: c.item, action: c.action, before: c.before, after: c.after })),
    };
  });
}

export async function saveRange(db: Db, a: Editor, input: RangeInput & { id?: string }) {
  requireClinician(a);
  const r = checkRange(input);
  return asActor(db, a, async (tx) => {
    if (input.id) {
      const before = (await tx.query(`SELECT analyte, unit, day_from, day_to, low, high, in_range_en, in_range_es FROM clinic_ranges WHERE id = $1`, [input.id])).rows[0];
      if (!before) throw new ContentError("That range no longer exists.");
      await tx.query(`UPDATE clinic_ranges SET analyte=$2, unit=$3, day_from=$4, day_to=$5, low=$6, high=$7, in_range_en=$8, in_range_es=$9, approved_by=$10, updated_at=now() WHERE id=$1`,
        [input.id, r.analyte, r.unit, r.dayFrom, r.dayTo, r.low, r.high, r.inRangeEn, r.inRangeEs, a.name]);
      await record(tx, a, "range", `${r.analyte} days ${r.dayFrom}–${r.dayTo}`, "updated", before, r);
      return input.id;
    }
    const overlap = await tx.query(`SELECT 1 FROM clinic_ranges WHERE analyte=$1 AND unit=$2 AND day_from <= $4 AND day_to >= $3`, [r.analyte, r.unit, r.dayFrom, r.dayTo]);
    if (overlap.rows.length) throw new ContentError("That overlaps an existing range for the same test and unit. Edit that one instead.");
    const res = await tx.query<{ id: string }>(`INSERT INTO clinic_ranges (clinic_id, analyte, unit, day_from, day_to, low, high, in_range_en, in_range_es, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [a.clinicId, r.analyte, r.unit, r.dayFrom, r.dayTo, r.low, r.high, r.inRangeEn, r.inRangeEs, a.name]);
    await record(tx, a, "range", `${r.analyte} days ${r.dayFrom}–${r.dayTo}`, "created", null, r);
    return res.rows[0]!.id;
  });
}

export async function removeRange(db: Db, a: Editor, id: string) {
  requireClinician(a);
  return asActor(db, a, async (tx) => {
    const before = (await tx.query<{ analyte: string; day_from: number; day_to: number }>(`DELETE FROM clinic_ranges WHERE id = $1 RETURNING analyte, day_from, day_to, low, high, unit`, [id])).rows[0];
    if (!before) throw new ContentError("That range no longer exists.");
    await record(tx, a, "range", `${before.analyte} days ${before.day_from}–${before.day_to}`, "removed", before, null);
  });
}

export async function saveProtocol(db: Db, a: Editor, input: { id: string; title: string; bodyEn: string; bodyEs: string }) {
  requireClinician(a);
  const id = input.id.trim().toLowerCase().replace(/[^a-z0-9._]+/g, "_");
  if (!/^[a-z0-9._]{3,80}$/.test(id)) throw new ContentError("The protocol key needs 3–80 letters, numbers, dots or underscores.");
  const title = input.title.trim();
  if (title.length < 3) throw new ContentError("Give it a title.");
  const bodyEn = checkPatientText(input.bodyEn, "English text", 2000);
  const bodyEs = checkPatientText(input.bodyEs, "Spanish text", 2000);
  return asActor(db, a, async (tx) => {
    const before = (await tx.query(`SELECT title, body_en, body_es FROM protocol_sections WHERE id = $1`, [id])).rows[0] ?? null;
    if (before) await tx.query(`UPDATE protocol_sections SET title=$2, body_en=$3, body_es=$4, approved_by=$5, updated_at=now() WHERE id=$1`, [id, title, bodyEn, bodyEs, a.name]);
    else await tx.query(`INSERT INTO protocol_sections (clinic_id, id, title, body_en, body_es, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`, [a.clinicId, id, title, bodyEn, bodyEs, a.name]);
    await record(tx, a, "protocol", title, before ? "updated" : "created", before, { title, body_en: bodyEn, body_es: bodyEs });
    return id;
  });
}

export async function saveGuide(db: Db, a: Editor, input: { medication: string; steps: Record<Lang, string>[]; videoUrl: string }) {
  requireClinician(a);
  const steps = checkSteps(input.steps);
  const videoUrl = checkVideoUrl(input.videoUrl);
  return asActor(db, a, async (tx) => {
    const before = (await tx.query(`SELECT steps, video_url FROM med_guides WHERE medication = $1`, [input.medication])).rows[0];
    if (!before) throw new ContentError("No walkthrough for that medication.");
    await tx.query(`UPDATE med_guides SET steps=$2, video_url=$3, approved_by=$4, updated_at=now() WHERE medication=$1`, [input.medication, JSON.stringify(steps), videoUrl, a.name]);
    await record(tx, a, "walkthrough", input.medication, "updated", before, { steps, video_url: videoUrl });
  });
}

/** Move a medication up or down in the nightly walkthrough order. */
export async function moveGuide(db: Db, a: Editor, medication: string, direction: "up" | "down") {
  requireClinician(a);
  return asActor(db, a, async (tx) => {
    const rows = (await tx.query<{ medication: string }>(`SELECT medication FROM med_guides ORDER BY sort_order, medication`)).rows.map((r) => r.medication);
    const i = rows.indexOf(medication);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return rows;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (const [k, m] of rows.entries()) await tx.query(`UPDATE med_guides SET sort_order=$2 WHERE medication=$1`, [m, k + 1]);
    await record(tx, a, "walkthrough", medication, "reordered", null, { order: rows });
    return rows;
  });
}

export async function addTerm(db: Db, a: Editor, term: string, level: "urgent" | "crisis") {
  requireClinician(a);
  const t = checkTriageTerm(term);
  return asActor(db, a, async (tx) => {
    const dup = await tx.query(`SELECT 1 FROM clinic_triage_terms WHERE lower(term) = lower($1)`, [t]);
    if (dup.rows.length) throw new ContentError("That word is already on the list.");
    await tx.query(`INSERT INTO clinic_triage_terms (clinic_id, term, level, added_by) VALUES ($1,$2,$3,$4)`, [a.clinicId, t, level, a.name]);
    await record(tx, a, "urgent_word", t, "created", null, { term: t, level });
  });
}

export async function removeTerm(db: Db, a: Editor, id: string) {
  requireClinician(a);
  return asActor(db, a, async (tx) => {
    const before = (await tx.query<{ term: string; level: string }>(`DELETE FROM clinic_triage_terms WHERE id = $1 RETURNING term, level`, [id])).rows[0];
    if (!before) throw new ContentError("That word is already gone.");
    await record(tx, a, "urgent_word", before.term, "removed", before, null);
  });
}

/** The signed-in person's clinic name, for the top bar. */
export async function myClinicName(db: Db, actor: Actor): Promise<string | null> {
  return asActor(db, actor, async (tx) => (await tx.query<{ name: string }>(`SELECT name FROM clinics WHERE id = $1`, [actor.clinicId])).rows[0]?.name ?? null);
}
