/**
 * The records connection: lab results and medication orders from the clinic's records system.
 * See migrations/012_records_connection.sql for the rules. In short: match by MRN (and last name),
 * never guess, results go through the clinic's ranges, hCG only fills in the number, and
 * medication orders wait for a nurse.
 *
 * The importer has no signed-in person, so it runs as the database owner and scopes every query to
 * the clinic its key belongs to. Nurse review runs as the nurse, under row-level security.
 */
import { HandoffError, labelResult, parseFhirBundle, sameName, type AppointmentRecord, type IncomingRecord, type MedRecord, type ParsedRecords, type ResultRecord } from "@kinpath/core";
import { newToken, sha256 } from "@kinpath/core/server";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { recordLabResult, routeResultToNurse } from "./loop";
import { alertPatient, notify } from "./notify";

type Staff = Actor & { name: string };
const SYSTEM = "00000000-0000-0000-0000-000000000000";
const SYSTEM_NAME = "Records system";

function requireAdmin(a: Actor) { if (a.role !== "clinic_admin") throw new HandoffError("Only a clinic admin can manage the records connection."); }
function requireClinician(a: Actor) { if (a.role !== "nurse" && a.role !== "physician") throw new HandoffError("Only nurses and physicians can review records."); }

// ---------- keys ----------

/** Creates a key for the clinic's records system. The key is shown once; only its hash is kept. */
export async function createIntegrationKey(db: Db, admin: Actor, name: string): Promise<{ id: string; key: string }> {
  requireAdmin(admin);
  const label = name.trim();
  if (!label || label.length > 80) throw new HandoffError("Give the connection a short name, like “Epic results feed”.");
  const key = `pk_${newToken()}`;
  return db.transaction(async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO integration_keys (clinic_id, name, key_hash, key_hint, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [admin.clinicId, label, sha256(key), key.slice(-4), admin.userId]);
    await audit(tx, admin, "records.key_created", null, { keyId: r.rows[0]!.id });
    return { id: r.rows[0]!.id, key };
  });
}

export async function revokeIntegrationKey(db: Db, admin: Actor, keyId: string): Promise<void> {
  requireAdmin(admin);
  await db.transaction(async (tx) => {
    const r = await tx.query(`UPDATE integration_keys SET revoked_at = now() WHERE id = $1 AND clinic_id = $2 AND revoked_at IS NULL RETURNING id`, [keyId, admin.clinicId]);
    if (!r.rows[0]) throw new HandoffError("That key is already turned off.");
    await audit(tx, admin, "records.key_revoked", null, { keyId });
  });
}

export async function integrationKeys(db: Db, admin: Actor) {
  requireAdmin(admin);
  return asActor(db, admin, async (tx) => (await tx.query<{ id: string; name: string; key_hint: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
    `SELECT id, name, key_hint, created_at, last_used_at, revoked_at FROM integration_keys ORDER BY created_at DESC`)).rows.map((k) => ({
    id: k.id, name: k.name, hint: k.key_hint, createdAt: new Date(k.created_at).toISOString(),
    lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null, active: !k.revoked_at,
  })));
}

/** The clinic a key belongs to, or null. */
export async function keyFromToken(db: Db, token: string): Promise<{ keyId: string; clinicId: string } | null> {
  if (!/^pk_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const r = await db.query<{ id: string; clinic_id: string }>(
    `UPDATE integration_keys SET last_used_at = now() WHERE key_hash = $1 AND revoked_at IS NULL RETURNING id, clinic_id`, [sha256(token)]);
  return r.rows[0] ? { keyId: r.rows[0].id, clinicId: r.rows[0].clinic_id } : null;
}

// ---------- import ----------

export interface ImportCounts {
  received: number; resultsAdded: number; resultsToNurse: number; hcgAdded: number; corrected: number;
  ordersWaiting: number; appointments: number; toReview: number; duplicates: number; skipped: number;
}
const zero = (): ImportCounts => ({ received: 0, resultsAdded: 0, resultsToNurse: 0, hcgAdded: 0, corrected: 0, ordersWaiting: 0, appointments: 0, toReview: 0, duplicates: 0, skipped: 0 });

interface ItemRow {
  id: string; kind: string; status: string; reason: string | null; patient_id: string | null; mrn: string | null;
  data: Record<string, unknown>; lab_result_id: string | null; med_order_id: string | null; created_at: Date;
}

const resultData = (r: ResultRecord) => ({ analyte: r.analyte, value: r.value, unit: r.unit, collectedAt: r.collectedAt });
const apptData = (r: AppointmentRecord) => ({ startsAt: r.startsAt, title: r.title, kind: r.apptKind, location: r.location, cancelled: r.cancelled });
const medData = (r: MedRecord) => ({ medication: r.medication, dose: r.dose, timeOfDay: r.timeOfDay, startsOn: r.startsOn, endsOn: r.endsOn });
// jsonb reorders keys, so compare key by key.
const stable = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k] ?? null]));
const sameData = (a: Record<string, unknown>, b: Record<string, unknown>) => stable(a) === stable(b);

async function matchPatient(tx: Tx, clinicId: string, rec: IncomingRecord): Promise<{ id: string; first: string } | { reason: string }> {
  if (!rec.mrn) return { reason: "The record has no medical record number." };
  const p = (await tx.query<{ id: string; first_name: string; last_name: string }>(
    `SELECT id, first_name, last_name FROM patients WHERE clinic_id = $1 AND mrn = $2`, [clinicId, rec.mrn])).rows[0];
  if (!p) return { reason: "No patient in Pumpkin has this medical record number." };
  if (rec.lastName && !sameName(rec.lastName, p.last_name)) return { reason: "The last name doesn't match Pumpkin's record for this medical record number." };
  return { id: p.id, first: p.first_name };
}

/** A time with no zone (common in HL7 v2) is read as the clinic's local time. */
async function toInstant(tx: Tx, clinicId: string, s: string): Promise<string> {
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return s;
  const r = await tx.query<{ t: Date }>(`SELECT ($2::timestamp AT TIME ZONE timezone) AS t FROM clinics WHERE id = $1`, [clinicId, s]);
  return new Date(r.rows[0]!.t).toISOString();
}

/** Stimulation day on the day a sample was collected, from the patient's latest cycle (0 if unknown). */
async function stimDayAt(tx: Tx, clinicId: string, patientId: string, collectedAt: string): Promise<number> {
  const r = await tx.query<{ d: number | null }>(
    `SELECT ((($3::timestamptz) AT TIME ZONE c.timezone)::date - cy.started_on) + 1 AS d
       FROM cycles cy JOIN clinics c ON c.id = cy.clinic_id
      WHERE cy.clinic_id = $1 AND cy.patient_id = $2 ORDER BY cy.started_on DESC LIMIT 1`, [clinicId, patientId, collectedAt]);
  const d = r.rows[0]?.d;
  return d != null && d >= 1 ? Number(d) : 0;
}

async function addItem(tx: Tx, f: { clinicId: string; importId: string; rec: IncomingRecord; status: "applied" | "needs_review" | "dismissed"; reason?: string | null; patientId?: string | null; data: Record<string, unknown>; labResultId?: string | null; medOrderId?: string | null }) {
  await tx.query(
    `INSERT INTO record_items (clinic_id, import_id, external_id, kind, status, reason, patient_id, mrn, data, lab_result_id, med_order_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [f.clinicId, f.importId, f.rec.externalId, f.rec.kind, f.status, f.reason ?? null, f.patientId ?? null, f.rec.mrn, JSON.stringify(f.data), f.labResultId ?? null, f.medOrderId ?? null]);
}

/**
 * Applies records from the clinic's records system. One transaction: either all of it lands or
 * none of it does, and sending the same records again changes nothing.
 */
export async function importRecords(db: Db, source: { clinicId: string; keyId: string | null; format: "fhir" | "csv" | "sample" | "hl7" | "upload" | "pull"; uploadedBy?: string }, parsed: ParsedRecords) {
  const touched = { review: new Set<string>(), results: new Set<string>(), hcg: new Set<string>(), appts: new Set<string>() };
  const counts = zero();
  counts.received = parsed.records.length + parsed.skipped.length;
  counts.skipped = parsed.skipped.length;
  const clinicId = source.clinicId;

  const importId = await db.transaction(async (tx) => {
    const imp = await tx.query<{ id: string }>(`INSERT INTO record_imports (clinic_id, key_id, format, uploaded_by_name) VALUES ($1,$2,$3,$4) RETURNING id`, [clinicId, source.keyId, source.format, source.uploadedBy ?? null]);
    const importId = imp.rows[0]!.id;

    for (const rec of parsed.records) {
      if (rec.kind === "result" || rec.kind === "hcg") rec.collectedAt = await toInstant(tx, clinicId, rec.collectedAt);
      if (rec.kind === "appointment") rec.startsAt = await toInstant(tx, clinicId, rec.startsAt);
      const prior = (await tx.query<ItemRow>(`SELECT * FROM record_items WHERE clinic_id = $1 AND kind = $2 AND external_id = $3 FOR UPDATE`, [clinicId, rec.kind, rec.externalId])).rows[0];

      if (rec.kind === "result" || rec.kind === "hcg") {
        const data = resultData(rec);
        if (prior) {
          if (rec.withdrawn) {
            if (prior.status === "applied") {
              await tx.query(`UPDATE record_items SET status = 'needs_review', reason = $2, updated_at = now() WHERE id = $1`,
                [prior.id, "The records system withdrew this result (entered in error). Check whether the patient needs to hear about it."]);
              counts.toReview++; if (prior.patient_id) touched.review.add(prior.patient_id);
            } else {
              await tx.query(`UPDATE record_items SET status = 'dismissed', reason = 'Withdrawn by the records system.', updated_at = now() WHERE id = $1`, [prior.id]);
              counts.skipped++;
            }
            continue;
          }
          if (sameData(prior.data, data)) { counts.duplicates++; continue; }
          if (rec.kind === "result" && prior.status === "applied" && prior.lab_result_id && prior.patient_id) {
            // A corrected result: replace the number, label it again, and tell the nurse it changed.
            const old = prior.data as { value: number; unit: string };
            await tx.query(`DELETE FROM handoffs WHERE lab_result_id = $1 AND status = 'open'`, [prior.lab_result_id]);
            await tx.query(`UPDATE lab_results SET value = $2, unit = $3, corrected_at = now() WHERE id = $1`, [prior.lab_result_id, rec.value, rec.unit]);
            const relabeled = await relabel(tx, clinicId, prior.patient_id, prior.lab_result_id, rec);
            await routeResultToNurse(tx, clinicId, prior.patient_id, prior.lab_result_id,
              `Corrected by the records system: ${rec.analyte} ${rec.value} ${rec.unit}, was ${old.value} ${old.unit} (${relabeled.replace("_", " ")})`);
            await tx.query(`UPDATE record_items SET data = $2, updated_at = now() WHERE id = $1`, [prior.id, JSON.stringify(data)]);
            counts.corrected++; touched.results.add(prior.patient_id);
            continue;
          }
          await tx.query(`UPDATE record_items SET data = $2, status = 'needs_review', reason = $3, updated_at = now() WHERE id = $1`,
            [prior.id, JSON.stringify(data), "The records system sent a different value for a record Pumpkin already has."]);
          counts.toReview++; if (prior.patient_id) touched.review.add(prior.patient_id);
          continue;
        }
        if (rec.withdrawn) { counts.skipped++; continue; }

        const who = await matchPatient(tx, clinicId, rec);
        if ("reason" in who) {
          await addItem(tx, { clinicId, importId, rec, status: "needs_review", reason: who.reason, data });
          counts.toReview++; continue;
        }

        if (rec.kind === "hcg") {
          const t = (await tx.query<{ id: string; hcg: string | null }>(
            `SELECT id, hcg FROM pregnancy_tests WHERE clinic_id = $1 AND patient_id = $2 AND released_at IS NULL ORDER BY scheduled_at DESC LIMIT 1`, [clinicId, who.id])).rows[0];
          const why = !t ? "No pregnancy test is waiting for a result for this patient."
            : t.hcg != null && Number(t.hcg) !== rec.value ? "Pumpkin already has a different hCG for this test." : null;
          if (why) {
            await addItem(tx, { clinicId, importId, rec, status: "needs_review", reason: why, patientId: who.id, data });
            counts.toReview++; touched.review.add(who.id); continue;
          }
          // Only the number. The nurse still decides the outcome and when she hears it.
          await tx.query(`UPDATE pregnancy_tests SET hcg = $2, entered_by_name = coalesce(entered_by_name, $3) WHERE id = $1`, [t!.id, rec.value, SYSTEM_NAME]);
          await addItem(tx, { clinicId, importId, rec, status: "applied", patientId: who.id, data });
          await systemAudit(tx, clinicId, source.keyId, "records.added_hcg", who.id, { testId: t!.id });
          counts.hcgAdded++; touched.hcg.add(who.id); continue;
        }

        const stimDay = await stimDayAt(tx, clinicId, who.id, rec.collectedAt);
        const r = await recordLabResult(tx, { clinicId, patientId: who.id, analyte: rec.analyte, unit: rec.unit, value: rec.value, stimDay, collectedAt: rec.collectedAt, enteredBy: null, source: "emr_feed" });
        await addItem(tx, { clinicId, importId, rec, status: "applied", patientId: who.id, data, labResultId: r.resultId });
        await systemAudit(tx, clinicId, source.keyId, "records.added_result", who.id, { resultId: r.resultId, status: r.label.status });
        counts.resultsAdded++;
        if (r.label.routeToNurse) { counts.resultsToNurse++; touched.results.add(who.id); }
        continue;
      }

      // ----- appointments: applied directly (they don't change care), and the patient is told -----
      if (rec.kind === "appointment") {
        const data = apptData(rec);
        if (prior) {
          if (sameData(prior.data, data)) { counts.duplicates++; continue; }
          if (prior.status === "applied" && prior.patient_id) {
            await tx.query(`UPDATE appointments SET starts_at = $3, title = $4, kind = $5, location = $6, status = $7, updated_at = now() WHERE clinic_id = $1 AND external_id = $2`,
              [clinicId, rec.externalId, rec.startsAt, rec.title, rec.apptKind, rec.location, rec.cancelled ? "cancelled" : "booked"]);
            await tx.query(`UPDATE record_items SET data = $2, updated_at = now() WHERE id = $1`, [prior.id, JSON.stringify(data)]);
            counts.appointments++; touched.appts.add(prior.patient_id);
          } else {
            await tx.query(`UPDATE record_items SET data = $2, updated_at = now() WHERE id = $1`, [prior.id, JSON.stringify(data)]);
            counts.toReview++;
          }
          continue;
        }
        if (rec.cancelled) { counts.skipped++; continue; }
        const who = await matchPatient(tx, clinicId, rec);
        if ("reason" in who) { await addItem(tx, { clinicId, importId, rec, status: "needs_review", reason: who.reason, data }); counts.toReview++; continue; }
        await tx.query(`INSERT INTO appointments (clinic_id, patient_id, starts_at, kind, title, location, source, external_id) VALUES ($1,$2,$3,$4,$5,$6,'records',$7)`,
          [clinicId, who.id, rec.startsAt, rec.apptKind, rec.title, rec.location, rec.externalId]);
        await addItem(tx, { clinicId, importId, rec, status: "applied", patientId: who.id, data });
        counts.appointments++; touched.appts.add(who.id);
        continue;
      }

      // ----- medication orders -----
      const med = rec as MedRecord;
      const data = medData(med);
      if (rec.kind === "med_stop") {
        if (prior) { counts.duplicates++; continue; }
        const order = (await tx.query<{ id: string; patient_id: string; status: string }>(
          `SELECT id, patient_id, status FROM med_orders WHERE clinic_id = $1 AND external_id = $2`, [clinicId, rec.externalId])).rows[0];
        if (!order) { counts.skipped++; continue; }
        if (order.status === "pending_review") {
          // Never confirmed, so the patient never saw it. Just take it off the nurse's list.
          await tx.query(`UPDATE med_orders SET status = 'stopped' WHERE id = $1`, [order.id]);
          await tx.query(`UPDATE record_items SET status = 'dismissed', reason = 'Stopped by the records system before it was confirmed.', updated_at = now() WHERE clinic_id = $1 AND kind = 'med_order' AND external_id = $2`, [clinicId, rec.externalId]);
          await addItem(tx, { clinicId, importId, rec, status: "applied", patientId: order.patient_id, data, medOrderId: order.id });
          continue;
        }
        if (order.status === "stopped") { counts.duplicates++; continue; }
        await addItem(tx, { clinicId, importId, rec, status: "needs_review", reason: "The records system stopped this order. Confirm to cancel the remaining doses.", patientId: order.patient_id, data, medOrderId: order.id });
        counts.toReview++; touched.review.add(order.patient_id);
        continue;
      }

      if (prior) {
        if (sameData(prior.data, data)) { counts.duplicates++; continue; }
        const pending = prior.med_order_id ? (await tx.query<{ status: string }>(`SELECT status FROM med_orders WHERE id = $1`, [prior.med_order_id])).rows[0]?.status === "pending_review" : false;
        if (pending && missingFields(med).length === 0) {
          await tx.query(`UPDATE med_orders SET medication = $2, dose = $3, time_of_day = $4, starts_on = $5, ends_on = $6 WHERE id = $1`,
            [prior.med_order_id, med.medication, med.dose, med.timeOfDay, med.startsOn, med.endsOn]);
          await tx.query(`UPDATE record_items SET data = $2, reason = $3, updated_at = now() WHERE id = $1`, [prior.id, JSON.stringify(data), "Updated by the records system. Confirm before it appears on her schedule."]);
        } else {
          await tx.query(`UPDATE record_items SET data = $2, status = 'needs_review', reason = $3, updated_at = now() WHERE id = $1`,
            [prior.id, JSON.stringify(data), "The records system changed an order Pumpkin already has. Update it by hand on the patient's page."]);
        }
        counts.toReview++; if (prior.patient_id) touched.review.add(prior.patient_id);
        continue;
      }

      const who = await matchPatient(tx, clinicId, rec);
      if ("reason" in who) {
        await addItem(tx, { clinicId, importId, rec, status: "needs_review", reason: who.reason, data });
        counts.toReview++; continue;
      }
      const missing = missingFields(med);
      const cycle = (await tx.query<{ id: string }>(`SELECT id FROM cycles WHERE clinic_id = $1 AND patient_id = $2 ORDER BY started_on DESC LIMIT 1`, [clinicId, who.id])).rows[0];
      if (missing.length || !cycle) {
        await addItem(tx, { clinicId, importId, rec, status: "needs_review", patientId: who.id, data,
          reason: !cycle ? "This patient has no cycle in Pumpkin yet." : `The order is missing ${missing.join(" and ")}. Add it by hand.` });
        counts.toReview++; touched.review.add(who.id); continue;
      }
      const m = await tx.query<{ id: string }>(
        `INSERT INTO med_orders (clinic_id, patient_id, cycle_id, medication, dose, time_of_day, starts_on, ends_on, external_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review') RETURNING id`,
        [clinicId, who.id, cycle.id, med.medication, med.dose, med.timeOfDay, med.startsOn, med.endsOn ?? med.startsOn, rec.externalId]);
      await addItem(tx, { clinicId, importId, rec, status: "needs_review", patientId: who.id, data, medOrderId: m.rows[0]!.id,
        reason: `New order. Confirm before it appears on ${who.first}'s schedule.` });
      counts.ordersWaiting++; touched.review.add(who.id);
    }

    await tx.query(`UPDATE record_imports SET counts = $2 WHERE id = $1`, [importId, JSON.stringify(counts)]);
    await systemAudit(tx, clinicId, source.keyId, "records.imported", null, { importId, ...counts });
    return importId;
  });

  // Alerts after the records are saved. Titles name the patient but never a value.
  const names = async (ids: Set<string>) => (await db.query<{ id: string; name: string }>(
    `SELECT id, first_name || ' ' || last_name AS name FROM patients WHERE id = ANY($1::uuid[])`, [[...ids]])).rows;
  for (const p of await names(touched.results)) await notify(db, { clinicId, kind: "result_to_review", title: `${p.name} · result from the records system to review`, link: "/nurse", to: { clinicians: true } });
  for (const p of await names(touched.hcg)) await notify(db, { clinicId, kind: "result_to_review", title: `${p.name} · hCG arrived. You decide the outcome`, link: `/nurse/patients/${p.id}`, to: { clinicians: true } });
  for (const id of touched.appts) await alertPatient(db, id, "schedule_changed", "Your appointments were updated.");
  const unmatched = counts.toReview + counts.ordersWaiting - touched.review.size;
  if (touched.review.size || unmatched > 0) {
    const n = counts.toReview + counts.ordersWaiting;
    await notify(db, { clinicId, kind: "records_to_review", title: `${n} record${n === 1 ? "" : "s"} from the records system to review`, link: "/nurse#records", to: { clinicians: true } });
  }
  return { importId, ...counts };
}

function missingFields(r: MedRecord): string[] {
  const m: string[] = [];
  if (!r.medication) m.push("the medication");
  if (!r.dose) m.push("the dose");
  if (!r.timeOfDay) m.push("the time");
  if (!r.startsOn) m.push("the start date");
  return m;
}

async function relabel(tx: Tx, clinicId: string, patientId: string, resultId: string, rec: ResultRecord): Promise<string> {
  const stimDay = await stimDayAt(tx, clinicId, patientId, rec.collectedAt);
  const ranges = (await tx.query<{ analyte: string; unit: string; day_from: number; day_to: number; low: string; high: string; in_range_en: string; in_range_es: string; approved_by: string }>(
    `SELECT * FROM clinic_ranges WHERE clinic_id = $1`, [clinicId])).rows.map((r) => ({
    analyte: r.analyte, unit: r.unit, dayFrom: r.day_from, dayTo: r.day_to, low: Number(r.low), high: Number(r.high),
    inRangeText: { en: r.in_range_en, es: r.in_range_es }, approvedBy: r.approved_by,
  }));
  const label = labelResult({ analyte: rec.analyte, unit: rec.unit, value: rec.value, stimDay }, ranges);
  await tx.query(`UPDATE lab_results SET status = $2, stim_day = $3 WHERE id = $1`, [resultId, label.status, stimDay]);
  return label.status;
}

async function systemAudit(tx: Tx, clinicId: string, keyId: string | null, action: string, patientId: string | null, detail: Record<string, unknown>) {
  await tx.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1,$2,$3,$4,$5)`,
    [clinicId, keyId ?? SYSTEM, action, patientId, JSON.stringify(detail)]);
}

/** The import log: when records arrived and what happened, in counts only. */
export async function recordImports(db: Db, actor: Actor, limit = 20) {
  return asActor(db, actor, async (tx) => (await tx.query<{ id: string; format: string; received_at: Date; counts: ImportCounts; key_name: string | null; uploaded_by_name: string | null }>(
    `SELECT i.id, i.format, i.received_at, i.counts, i.uploaded_by_name, k.name AS key_name FROM record_imports i LEFT JOIN integration_keys k ON k.id = i.key_id ORDER BY i.received_at DESC LIMIT $1`, [limit])).rows.map((r) => ({
    id: r.id, format: r.format, receivedAt: new Date(r.received_at).toISOString(), counts: { ...zero(), ...r.counts },
    source: r.key_name ?? (r.format === "sample" ? "Sample records" : r.format === "upload" ? `Upload by ${r.uploaded_by_name ?? "staff"}` : r.format === "pull" ? "FHIR check" : "Records system"),
  })));
}

// ---------- nurse review ----------

export interface RecordToReview {
  id: string; kind: "result" | "hcg" | "med_order" | "med_stop" | "appointment"; reason: string; createdAt: string;
  patientId: string | null; patientName: string | null; mrn: string | null; data: Record<string, unknown>;
  canConfirm: boolean;
}

export async function recordsToReview(db: Db, nurse: Actor): Promise<RecordToReview[]> {
  requireClinician(nurse);
  return asActor(db, nurse, async (tx) => (await tx.query<ItemRow & { first_name: string | null; last_name: string | null }>(
    `SELECT i.*, p.first_name, p.last_name FROM record_items i LEFT JOIN patients p ON p.id = i.patient_id
      WHERE i.status = 'needs_review' ORDER BY i.created_at`)).rows.map((r) => ({
    id: r.id, kind: r.kind as RecordToReview["kind"], reason: r.reason ?? "", createdAt: new Date(r.created_at).toISOString(),
    patientId: r.patient_id, patientName: r.first_name ? `${r.first_name} ${r.last_name}` : null, mrn: r.mrn, data: r.data,
    canConfirm: r.kind === "med_stop" || r.kind === "appointment" ? true : r.kind === "med_order" ? !!r.med_order_id || missingFields({ kind: "med_order", externalId: "", mrn: null, lastName: null, ...(r.data as object) } as MedRecord).length === 0 : !r.lab_result_id,
  })));
}

/**
 * The nurse confirms a record: a new order goes on the schedule, a stop cancels remaining doses,
 * and a result or hCG the importer couldn't place goes to the patient she chooses.
 */
export async function confirmRecord(db: Db, nurse: Staff, itemId: string, opts: { patientId?: string } = {}) {
  requireClinician(nurse);
  const out = await asActor(db, nurse, async (tx) => {
    const item = (await tx.query<ItemRow>(`SELECT * FROM record_items WHERE id = $1 AND status = 'needs_review' FOR UPDATE`, [itemId])).rows[0];
    if (!item) throw new HandoffError("That record was already handled.");
    const patientId = opts.patientId || item.patient_id;
    if (!patientId) throw new HandoffError("Choose which patient this record belongs to.");
    const p = (await tx.query<{ id: string; first_name: string }>(`SELECT id, first_name FROM patients WHERE id = $1`, [patientId])).rows[0];
    if (!p) throw new HandoffError("That patient isn't in this clinic.");
    const done = async (extra: { labResultId?: string } = {}) => tx.query(
      `UPDATE record_items SET status = 'applied', patient_id = $2, reviewed_by_name = $3, reviewed_at = now(), updated_at = now(), lab_result_id = coalesce($4, lab_result_id) WHERE id = $1`,
      [itemId, patientId, nurse.name, extra.labResultId ?? null]);
    const d = item.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (item.kind === "result") {
      if (item.lab_result_id) { await done(); await audit(tx, nurse, "records.reviewed", patientId, { itemId }); return { patientId, alert: false }; }
      const stimDay = await stimDayAt(tx, nurse.clinicId, patientId, d.collectedAt);
      const r = await recordLabResult(tx, { clinicId: nurse.clinicId, patientId, analyte: d.analyte, unit: d.unit, value: Number(d.value), stimDay, collectedAt: d.collectedAt, enteredBy: nurse.userId, source: "emr_feed" });
      await done({ labResultId: r.resultId });
      await audit(tx, nurse, "records.placed_result", patientId, { itemId, resultId: r.resultId, status: r.label.status });
      return { patientId, alert: false };
    }
    if (item.kind === "hcg") {
      const t = (await tx.query<{ id: string }>(`SELECT id FROM pregnancy_tests WHERE patient_id = $1 AND released_at IS NULL ORDER BY scheduled_at DESC LIMIT 1`, [patientId])).rows[0];
      if (!t) throw new HandoffError(`${p.first_name} has no pregnancy test waiting for a result. Record the transfer on her page first.`);
      await tx.query(`UPDATE pregnancy_tests SET hcg = $2, entered_by_name = $3 WHERE id = $1`, [t.id, Number(d.value), nurse.name]);
      await done();
      await audit(tx, nurse, "records.placed_hcg", patientId, { itemId, testId: t.id });
      return { patientId, alert: false };
    }
    if (item.kind === "appointment") {
      const ext = (await tx.query<{ external_id: string }>(`SELECT external_id FROM record_items WHERE id = $1`, [itemId])).rows[0]!.external_id;
      await tx.query(`INSERT INTO appointments (clinic_id, patient_id, starts_at, kind, title, location, source, external_id, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'records',$7,$8)`,
        [nurse.clinicId, patientId, d.startsAt, d.kind, d.title, d.location ?? null, ext, nurse.name]);
      await done();
      await audit(tx, nurse, "records.placed_appointment", patientId, { itemId });
      return { patientId, alert: true, text: "You have a new appointment." as string | undefined };
    }
    if (item.kind === "med_stop") {
      await tx.query(`UPDATE dose_logs SET canceled_at = now() WHERE med_order_id = $1 AND scheduled_for > now() AND taken_at IS NULL AND canceled_at IS NULL`, [item.med_order_id]);
      await tx.query(`UPDATE med_orders SET status = 'stopped' WHERE id = $1`, [item.med_order_id]);
      await done();
      await audit(tx, nurse, "records.stopped_order", patientId, { itemId, medOrderId: item.med_order_id });
      return { patientId, alert: true };
    }
    // New order.
    let orderId = item.med_order_id;
    if (!orderId) {
      const missing = missingFields({ kind: "med_order", externalId: "", mrn: null, lastName: null, ...d } as MedRecord);
      if (missing.length) throw new HandoffError(`This order is missing ${missing.join(" and ")}. Add it by hand on ${p.first_name}'s page, then dismiss this record.`);
      const cycle = (await tx.query<{ id: string }>(`SELECT id FROM cycles WHERE patient_id = $1 ORDER BY started_on DESC LIMIT 1`, [patientId])).rows[0];
      if (!cycle) throw new HandoffError(`${p.first_name} has no cycle in Pumpkin yet.`);
      orderId = (await tx.query<{ id: string }>(
        `INSERT INTO med_orders (clinic_id, patient_id, cycle_id, medication, dose, time_of_day, starts_on, ends_on, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_review') RETURNING id`,
        [nurse.clinicId, patientId, cycle.id, d.medication, d.dose, d.timeOfDay, d.startsOn, d.endsOn ?? d.startsOn])).rows[0]!.id;
    }
    const o = (await tx.query<{ patient_id: string; status: string }>(`SELECT patient_id, status FROM med_orders WHERE id = $1`, [orderId])).rows[0];
    if (!o || o.patient_id !== patientId) throw new HandoffError("This order belongs to a different patient.");
    if (o.status !== "pending_review") throw new HandoffError("This order was already confirmed or stopped.");
    await tx.query(`UPDATE med_orders SET status = 'active' WHERE id = $1`, [orderId]);
    // Doses from the start date (or now) through the end date, at most 60 days, in clinic time. Only future ones.
    await tx.query(
      `INSERT INTO dose_logs (clinic_id, patient_id, med_order_id, scheduled_for)
       SELECT m.clinic_id, m.patient_id, m.id, (g.d::date + m.time_of_day) AT TIME ZONE c.timezone
         FROM med_orders m JOIN clinics c ON c.id = m.clinic_id,
              generate_series(m.starts_on, least(coalesce(m.ends_on, m.starts_on), m.starts_on + 59), interval '1 day') AS g(d)
        WHERE m.id = $1 AND (g.d::date + m.time_of_day) AT TIME ZONE c.timezone > now()`, [orderId]);
    await tx.query(`UPDATE record_items SET med_order_id = $2 WHERE id = $1`, [itemId, orderId]);
    await done();
    await audit(tx, nurse, "records.confirmed_order", patientId, { itemId, medOrderId: orderId });
    return { patientId, alert: true };
  });
  if (out.alert) await alertPatient(db, out.patientId, "schedule_changed", ("text" in out && out.text) || "Your medication schedule was updated.");
  return { ok: true };
}

/** The nurse decides a record doesn't belong in Pumpkin. A pending order is dropped. */
export async function dismissRecord(db: Db, nurse: Staff, itemId: string) {
  requireClinician(nurse);
  return asActor(db, nurse, async (tx) => {
    const item = (await tx.query<ItemRow>(`SELECT * FROM record_items WHERE id = $1 AND status = 'needs_review' FOR UPDATE`, [itemId])).rows[0];
    if (!item) throw new HandoffError("That record was already handled.");
    if (item.kind === "med_order" && item.med_order_id) await tx.query(`UPDATE med_orders SET status = 'stopped' WHERE id = $1 AND status = 'pending_review'`, [item.med_order_id]);
    await tx.query(`UPDATE record_items SET status = 'dismissed', reviewed_by_name = $2, reviewed_at = now(), updated_at = now() WHERE id = $1`, [itemId, nurse.name]);
    await audit(tx, nurse, "records.dismissed", item.patient_id, { itemId });
    return { ok: true };
  });
}

// ---------- demo ----------

/** Sample records for the demo: the same ids each day, so sending twice shows nothing is duplicated. */
export function sampleBundle(today: string) {
  const id = today.replace(/-/g, "");
  const maya = { fullUrl: "urn:uuid:maya", resource: { resourceType: "Patient", id: "maya", identifier: [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, value: "BF-100231" }], name: [{ use: "official", family: "Torres", given: ["Maya"] }] } };
  const obs = (key: string, code: string, display: string, value: number, unit: string, mrnRef = "urn:uuid:maya") => ({ resource: {
    resourceType: "Observation", id: `demo-${id}-${key}`, status: "final",
    code: { coding: [{ system: "http://loinc.org", code, display }] }, subject: mrnRef.startsWith("urn") ? { reference: mrnRef } : { identifier: { value: mrnRef } },
    effectiveDateTime: `${today}T07:45:00-04:00`, valueQuantity: { value, unit, system: "http://unitsofmeasure.org", code: unit } } });
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const t = tomorrow.toISOString().slice(0, 10);
  return {
    resourceType: "Bundle", type: "collection",
    entry: [
      maya,
      obs("e2", "2243-4", "Estradiol (E2) [Mass/volume] in Serum or Plasma", 412, "pg/mL"),
      obs("p4", "2839-9", "Progesterone [Mass/volume] in Serum or Plasma", 1.9, "ng/mL"),
      obs("tsh", "3016-3", "Thyrotropin [Units/volume] in Serum or Plasma", 1.2, "m[IU]/L"),
      obs("e2x", "2243-4", "Estradiol (E2) [Mass/volume] in Serum or Plasma", 655, "pg/mL", "BF-999999"),
      { resource: { resourceType: "Appointment", id: `demo-${id}-visit`, status: "booked", start: `${t}T07:30:00-04:00`,
        serviceType: [{ text: "Monitoring visit: ultrasound and blood work" }],
        participant: [{ actor: { reference: "urn:uuid:maya" } }, { actor: { reference: "Location/tampa", display: "Bayside Tampa, 2nd floor" } }] } },
      { resource: { resourceType: "MedicationRequest", id: `demo-${id}-trigger`, status: "active", intent: "order",
        medicationCodeableConcept: { text: "Ovidrel (trigger shot)" }, subject: { reference: "urn:uuid:maya" },
        dosageInstruction: [{ text: "250 mcg once at 9:30 pm", timing: { repeat: { timeOfDay: ["21:30:00"], boundsPeriod: { start: t, end: t } } }, doseAndRate: [{ doseQuantity: { value: 250, unit: "mcg" } }] }] } },
    ],
  };
}

/** Demo only: sends the sample records as if they came from the clinic's records system. */
export async function sendSampleRecords(db: Db, actor: Actor) {
  const today = (await db.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM clinics WHERE id = $1`, [actor.clinicId])).rows[0]!.d;
  return importRecords(db, { clinicId: actor.clinicId, keyId: null, format: "sample" }, parseFhirBundle(sampleBundle(today)));
}
