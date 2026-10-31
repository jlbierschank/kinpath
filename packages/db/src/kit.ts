/**
 * Stage kits for people on their own: the first-consult kit, the test calendar and the OB handoff.
 * What she ticks off is saved on her profile; her meds' last days end their reminders; and she can
 * share a summary of her own record with her OB through a link that expires and can be stopped.
 */
import { createHash, randomBytes } from "node:crypto";
import { dueDate, HandoffError, mergeKit, triage, type ClinicTerm, type Conception, type StageKit, type TriageLevel } from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { localToday, requirePersonal } from "./solo";
import { alertPatient } from "./notify";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function kitOf(tx: Tx, patientId: string): Promise<StageKit> {
  const r = await tx.query<{ kit: Partial<StageKit> | null }>(`SELECT kit FROM personal_profiles WHERE patient_id = $1`, [patientId]);
  return mergeKit(r.rows[0]?.kit ?? null, {});
}

/**
 * Saves a change to her kit. Notes after a visit are checked for urgent symptoms like anything else
 * she writes; they're still saved, and the app shows the urgent screen.
 */
export async function saveKit(db: Db, actor: Actor, patientId: string, patch: Record<string, unknown>): Promise<{ kit: StageKit; urgent: Exclude<TriageLevel, "routine"> | null }> {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can change this.");
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const before = await kitOf(tx, patientId);
    const kit = mergeKit(before, patch);
    await tx.query(`UPDATE personal_profiles SET kit = $2, updated_at = now() WHERE patient_id = $1`, [patientId, JSON.stringify(kit)]);
    let urgent: Exclude<TriageLevel, "routine"> | null = null;
    if (kit.consult.notes && kit.consult.notes !== before.consult.notes) {
      const terms = (await tx.query<ClinicTerm>(`SELECT term, level FROM clinic_triage_terms`)).rows;
      const t = triage(kit.consult.notes, terms);
      if (t.level !== "routine") urgent = t.level;
    }
    await audit(tx, actor, "patient.updated_kit", patientId, { sections: Object.keys(patch).filter((k) => ["consult", "tests", "ob"].includes(k)), urgent });
    return { kit, urgent };
  });
}

/**
 * The last day her clinic says to take a medication. Reminders after it are canceled; if it's later
 * than the current last day, the extra days are added. Pumpkin never suggests the date.
 */
export async function setMedLastDay(db: Db, actor: Actor, patientId: string, medication: string, lastDay: string) {
  if (!DATE.test(lastDay)) throw new HandoffError("Add the last day.");
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const today = await localToday(tx);
    if (lastDay < today) throw new HandoffError("Pick today or a later day. To stop now, use Stop in your record.");
    const orders = await tx.query<{ id: string; starts_on: string; ends_on: string | null }>(
      `SELECT id, starts_on::text, ends_on::text FROM med_orders WHERE patient_id = $1 AND medication = $2 AND status = 'active'`, [patientId, medication]);
    if (!orders.rows.length) throw new HandoffError("That medication isn't in your record anymore.");
    for (const o of orders.rows) {
      if ((Date.parse(lastDay) - Date.parse(o.starts_on)) / 86_400_000 > 180) throw new HandoffError("Add a last day within 6 months of the first.");
    }
    for (const o of orders.rows) {
      await tx.query(`UPDATE med_orders SET ends_on = $2 WHERE id = $1`, [o.id, lastDay]);
      // Cancel reminders after the last day, in her time zone.
      await tx.query(
        `UPDATE dose_logs d SET canceled_at = now() FROM med_orders m JOIN clinics c ON c.id = m.clinic_id
          WHERE d.med_order_id = $1 AND m.id = d.med_order_id AND d.taken_at IS NULL AND d.canceled_at IS NULL
            AND (d.scheduled_for AT TIME ZONE c.timezone)::date > $2::date`, [o.id, lastDay]);
      // Add the days between the old last day and the new one.
      await tx.query(
        `INSERT INTO dose_logs (clinic_id, patient_id, med_order_id, scheduled_for)
         SELECT m.clinic_id, m.patient_id, m.id, (g.d::date + m.time_of_day) AT TIME ZONE c.timezone
           FROM med_orders m JOIN clinics c ON c.id = m.clinic_id,
                generate_series(greatest(coalesce($3::date, m.starts_on) + 1, m.starts_on), $2::date, interval '1 day') AS g(d)
          WHERE m.id = $1 AND (g.d::date + m.time_of_day) AT TIME ZONE c.timezone > now() - interval '12 hours'
            AND NOT EXISTS (SELECT 1 FROM dose_logs x WHERE x.med_order_id = m.id AND x.scheduled_for = (g.d::date + m.time_of_day) AT TIME ZONE c.timezone)`,
        [o.id, lastDay, o.ends_on]);
    }
    await audit(tx, actor, "patient.set_med_last_day", patientId, { orders: orders.rows.length });
    return { lastDay };
  });
}

// ---------- the summary she shares with her OB ----------

export const SHARE_SECTIONS = ["meds", "results", "visits", "costs", "coverage", "pregnancy", "embryo"] as const;
export type ShareSection = (typeof SHARE_SECTIONS)[number];

/**
 * A link to her chosen sections: a page to read, a PDF and a data file (FHIR), no account needed.
 * She picks the sections every time; embryo details are only in it if she adds them. 30 days by default.
 */
export async function createPersonalShare(db: Db, actor: Actor, patientId: string, input: { recipient: string; includeResults?: boolean; includeMeds?: boolean; sections?: string[]; days?: number }) {
  if (actor.role !== "patient") throw new HandoffError("Only the patient can share her summary.");
  const recipient = input.recipient.trim();
  if (!recipient || recipient.length > 120) throw new HandoffError("Add who you're sharing with, like your OB's name.");
  const sections = input.sections
    ? [...new Set(input.sections)].filter((x): x is ShareSection => (SHARE_SECTIONS as readonly string[]).includes(x))
    : ["visits", "pregnancy", ...(input.includeResults ? ["results"] : []), ...(input.includeMeds ? ["meds"] : [])] as ShareSection[];
  if (sections.includes("embryo") && !sections.includes("pregnancy")) sections.push("pregnancy");
  if (!sections.length) throw new HandoffError("Pick at least one thing to share.");
  const days = input.days === 7 || input.days === 30 ? input.days : 30;
  const token = randomBytes(24).toString("base64url");
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const r = await tx.query<{ id: string; expires_at: Date }>(
      `INSERT INTO summary_shares (clinic_id, patient_id, created_by, recipient, include_results, include_meds, sections, token_hash, kind, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'personal', now() + make_interval(days => $9)) RETURNING id, expires_at`,
      [actor.clinicId, patientId, actor.userId, recipient, sections.includes("results"), sections.includes("meds"), sections, hash(token), days]);
    await audit(tx, actor, "patient.shared_summary", patientId, { shareId: r.rows[0]!.id, recipient, sections, days });
    return { id: r.rows[0]!.id, token, expiresAt: iso(r.rows[0]!.expires_at)!, sections };
  });
}

export async function personalShares(db: Db, actor: Actor, patientId: string) {
  return asActor(db, actor, async (tx) => {
    const s = await tx.query<{ id: string; recipient: string; include_results: boolean; include_meds: boolean; sections: string[] | null; created_at: Date; expires_at: Date; revoked_at: Date | null; views: number }>(
      `SELECT id, recipient, include_results, include_meds, sections, created_at, expires_at, revoked_at, views FROM summary_shares WHERE patient_id = $1 AND kind = 'personal' ORDER BY created_at DESC LIMIT 10`, [patientId]);
    return s.rows.map((r) => ({ id: r.id, recipient: r.recipient, includeResults: r.include_results, includeMeds: r.include_meds, sections: r.sections ?? ["visits", "pregnancy", ...(r.include_results ? ["results"] : []), ...(r.include_meds ? ["meds"] : [])], createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!, active: !r.revoked_at && new Date(r.expires_at) > new Date(), views: r.views }));
  });
}

/** Who entered each item: her clinic's system, Pumpkin reading a photo or PDF she checked, or her by hand. */
export type EnteredBy = "clinic" | "read" | "you";
export interface PersonalSummary {
  kind: "personal";
  patient: string; clinic: string | null; recipient: string; createdAt: string; expiresAt: string;
  pregnancy: { conceivedOn: string | null; how: Conception | null; dueDate: string | null; ob: string | null };
  results: { test: string; analyte: string; loinc?: string | null; value: number; unit: string; on: string; by: EnteredBy }[] | null;
  meds: { medication: string; rxnorm?: string | null; dose: string; time: string; startsOn: string | null; endsOn: string | null; active: boolean; by: EnteredBy }[] | null;
  appointments: { title: string; at: string; location?: string | null; by: EnteredBy }[];
  id: string; sections: string[];
  costs: { kind: "charge" | "payment" | "adjustment" | "refund"; description: string; amountCents: number; on: string; dueOn: string | null; by: EnteredBy }[] | null;
  coverage: { payer: string | null; plan: string | null; asOf: string | null; fertilityUsedCents: number | null; fertilityMaxCents: number | null; deductibleCents: number | null; deductibleMetCents: number | null; oopMaxCents: number | null; oopMetCents: number | null; by: EnteredBy }[] | null;
}

export async function openPersonalSummary(db: Db, tokenHash: string, how: "view" | "pdf" | "fhir" = "view"): Promise<PersonalSummary | null> {
  const r = await db.query<{ s: (Omit<PersonalSummary, "kind" | "pregnancy"> & { ob: Partial<StageKit["ob"]> | null }) | null }>(`SELECT kp_open_personal_summary($1, $2) AS s`, [tokenHash, how]);
  const s = r.rows[0]?.s;
  if (!s) return null;
  const ob = mergeKit({ ob: s.ob ?? {} } as Partial<StageKit>, {}).ob;
  const due = ob.conceivedOn && ob.how ? dueDate(ob.conceivedOn, ob.how) : null;
  return {
    kind: "personal", patient: s.patient, clinic: s.clinic, recipient: s.recipient, createdAt: s.createdAt, expiresAt: s.expiresAt,
    // Embryo details (how she conceived) only if she added them; the due date still shows.
    pregnancy: s.ob ? { conceivedOn: ob.conceivedOn, how: (s.sections ?? []).includes("embryo") ? ob.how : null, dueDate: due, ob: ob.obName || null } : { conceivedOn: null, how: null, dueDate: null, ob: null },
    results: s.results ? s.results.map((x) => ({ ...x, value: Number(x.value) })) : null,
    meds: s.meds, appointments: s.appointments ?? [],
    id: s.id, sections: s.sections ?? [],
    costs: s.costs ? s.costs.map((x) => ({ ...x, amountCents: Number(x.amountCents) })) : null,
    coverage: s.coverage ? s.coverage.map((x) => ({ ...x, fertilityUsedCents: x.fertilityUsedCents === null ? null : Number(x.fertilityUsedCents), fertilityMaxCents: x.fertilityMaxCents === null ? null : Number(x.fertilityMaxCents), deductibleCents: x.deductibleCents === null ? null : Number(x.deductibleCents), deductibleMetCents: x.deductibleMetCents === null ? null : Number(x.deductibleMetCents), oopMaxCents: x.oopMaxCents === null ? null : Number(x.oopMaxCents), oopMetCents: x.oopMetCents === null ? null : Number(x.oopMetCents) })) : null,
  };
}

/** Called by openSummary for 'personal' links. Lets her know it was opened. */
export async function openPersonalLink(db: Db, token: string, how: "view" | "pdf" | "fhir" = "view"): Promise<PersonalSummary | null> {
  const s = await openPersonalSummary(db, hash(token), how);
  if (s && how === "view") {
    const pid = (await db.query<{ patient_id: string }>(`SELECT patient_id FROM summary_shares WHERE token_hash = $1`, [hash(token)])).rows[0]?.patient_id;
    if (pid) await alertPatient(db, pid, "summary_opened", `${s.recipient} opened your summary.`);
  }
  return s;
}

/** Her whole record, every section, for her own FHIR download (her copy, so embryo details are in). */
export async function myRecordForFhir(db: Db, actor: Actor, patientId: string) {
  if (actor.role !== "patient") throw new HandoffError("Only she can download her record.");
  return asActor(db, actor, async (tx) => {
    await requirePersonal(tx);
    const q = async <T>(sql: string) => ((await tx.query<{ v: T }>(sql, [patientId])).rows[0]?.v ?? ([] as unknown as T));
    const by = (src: string, patient: string, cap: string) => `CASE WHEN ${src} <> '${patient}' THEN 'clinic' WHEN ${cap} IS NOT NULL THEN 'read' ELSE 'you' END`;
    const name = (await tx.query<{ n: string }>(`SELECT first_name || ' ' || last_name AS n FROM patients WHERE id = $1`, [patientId])).rows[0]?.n ?? "Patient";
    const kit = (await tx.query<{ kit: Partial<StageKit> }>(`SELECT kit FROM personal_profiles WHERE patient_id = $1`, [patientId])).rows[0]?.kit ?? {};
    const ob = mergeKit({ ob: kit.ob ?? {} } as Partial<StageKit>, {}).ob;
    const results = await q<PersonalSummary["results"]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('test', coalesce(l.test_name, l.analyte), 'analyte', l.analyte, 'loinc', l.loinc, 'value', l.value, 'unit', l.unit, 'on', l.collected_at::date, 'by', ${by("l.source", "patient_upload", "l.capture_id")}) ORDER BY l.collected_at), '[]') AS v FROM lab_results l WHERE l.patient_id = $1`);
    const meds = await q<PersonalSummary["meds"]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('medication', m.medication, 'rxnorm', m.rxnorm, 'dose', m.dose, 'time', to_char(m.time_of_day, 'HH24:MI'), 'startsOn', m.starts_on, 'endsOn', m.ends_on, 'active', m.status = 'active', 'by', ${by("m.source", "patient", "m.capture_id")})), '[]') AS v FROM med_orders m WHERE m.patient_id = $1 AND m.status <> 'pending_review'`);
    const appointments = await q<PersonalSummary["appointments"]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'at', a.starts_at, 'location', a.location, 'by', CASE WHEN a.source = 'patient' THEN 'you' ELSE 'clinic' END) ORDER BY a.starts_at), '[]') AS v FROM appointments a WHERE a.patient_id = $1 AND a.status = 'booked'`);
    const costs = await q<NonNullable<PersonalSummary["costs"]>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('kind', f.kind, 'description', f.description, 'amountCents', f.amount_cents, 'on', f.occurred_on, 'dueOn', f.due_on, 'by', ${by("f.source", "patient", "f.capture_id")}) ORDER BY f.occurred_on), '[]') AS v FROM finance_ledger f WHERE f.patient_id = $1 AND f.voided_at IS NULL`);
    const coverage = await q<NonNullable<PersonalSummary["coverage"]>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('payer', v.payer_name, 'plan', v.plan_name, 'asOf', v.as_of, 'fertilityUsedCents', v.lifetime_used_cents, 'fertilityMaxCents', v.lifetime_max_cents, 'deductibleCents', v.deductible_cents, 'deductibleMetCents', v.deductible_met_cents, 'oopMaxCents', v.oop_max_cents, 'oopMetCents', v.oop_met_cents, 'by', ${by("v.source", "patient", "v.capture_id")})), '[]') AS v FROM finance_coverage v WHERE v.patient_id = $1 AND v.active`);
    await audit(tx, actor, "patient.downloaded_fhir", patientId, {});
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      id: patientId, patient: { name }, createdAt: new Date().toISOString(), sections: ["meds", "results", "visits", "costs", "coverage", "pregnancy", "embryo"],
      results: (results ?? []).map((x) => ({ ...x, value: Number(x.value) })), meds, appointments,
      costs: costs.map((c) => ({ ...c, amountCents: Number(c.amountCents) })),
      coverage: coverage.map((c) => ({ ...c, fertilityUsedCents: num(c.fertilityUsedCents), fertilityMaxCents: num(c.fertilityMaxCents), deductibleCents: num(c.deductibleCents), deductibleMetCents: num(c.deductibleMetCents), oopMaxCents: num(c.oopMaxCents), oopMetCents: num(c.oopMetCents) })),
      pregnancy: { conceivedOn: ob.conceivedOn, how: ob.how, dueDate: ob.conceivedOn && ob.how ? dueDate(ob.conceivedOn, ob.how) : null, ob: ob.obName || null },
    };
  });
}
