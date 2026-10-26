/**
 * Reading records from a clinic's records system (EHR). Pure functions: they turn a FHIR R4
 * Bundle or a results CSV into a list of records Pumpkin understands, and say why anything was
 * skipped. Deciding what happens to each record (matching the patient, labeling the result,
 * asking a nurse) happens in @kinpath/db.
 *
 * Lab codes are LOINC, each checked on loinc.org (October 2026):
 *   2243-4  Estradiol (E2) [Mass/volume] in Serum or Plasma          pg/mL
 *   2839-9  Progesterone [Mass/volume] in Serum or Plasma            ng/mL
 *   10501-5 Lutropin [Units/volume] in Serum or Plasma (LH)          m[IU]/mL
 *   15067-2 Follitropin [Units/volume] in Serum or Plasma (FSH)      m[IU]/mL
 *   21198-7 Choriogonadotropin.beta subunit [Units/volume] in S/P    m[IU]/mL
 *   19080-1 Choriogonadotropin [Units/volume] in Serum or Plasma     m[IU]/mL
 */

export class RecordsError extends Error { name = "RecordsError"; }

export const LOINC_SYSTEM = "http://loinc.org";
export const LOINC: Record<string, { analyte: string; kind: "result" | "hcg" }> = {
  "2243-4": { analyte: "estradiol", kind: "result" },
  "2839-9": { analyte: "progesterone", kind: "result" },
  "10501-5": { analyte: "lh", kind: "result" },
  "15067-2": { analyte: "fsh", kind: "result" },
  "21198-7": { analyte: "hcg", kind: "hcg" },
  "19080-1": { analyte: "hcg", kind: "hcg" },
};

/** Names a CSV may use instead of a LOINC code. */
const TEST_NAMES: Record<string, string> = {
  estradiol: "2243-4", e2: "2243-4",
  progesterone: "2839-9", p4: "2839-9",
  lh: "10501-5", "luteinizing hormone": "10501-5",
  fsh: "15067-2", "follicle stimulating hormone": "15067-2",
  hcg: "21198-7", "beta hcg": "21198-7", "b-hcg": "21198-7", "quantitative hcg": "21198-7",
};

/** UCUM and common spellings → the unit Pumpkin's ranges use. Anything else passes through, and the
 *  range check flags it as a unit mismatch for the nurse (nothing is converted). */
const UNITS: Record<string, string> = {
  "pg/ml": "pg/mL", "ng/ml": "ng/mL",
  "m[iu]/ml": "mIU/mL", "miu/ml": "mIU/mL", "mu/ml": "mIU/mL", "[iu]/l": "mIU/mL", "iu/l": "mIU/mL",
};
export const normalizeUnit = (u: string) => UNITS[u.trim().toLowerCase()] ?? u.trim();

export interface ResultRecord {
  kind: "result" | "hcg";
  externalId: string;
  mrn: string | null;
  lastName: string | null;
  analyte: string;
  value: number;
  unit: string;
  collectedAt: string;
  /** The records system says this replaces an earlier version of the same result. */
  corrected: boolean;
  /** The records system says this result was entered in error. */
  withdrawn: boolean;
}
export interface MedRecord {
  kind: "med_order" | "med_stop";
  externalId: string;
  mrn: string | null;
  lastName: string | null;
  medication: string | null;
  dose: string | null;
  /** "HH:MM", clinic time */
  timeOfDay: string | null;
  startsOn: string | null;
  endsOn: string | null;
}
export type IncomingRecord = ResultRecord | MedRecord;
export interface ParsedRecords { records: IncomingRecord[]; skipped: string[] }

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const dateOnly = (v: unknown) => { const s = str(v); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
const hhmm = (v: unknown) => { const s = str(v); return s && /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : null; };

function mrnOf(identifiers: unknown): string | null {
  if (!Array.isArray(identifiers)) return null;
  const mr = identifiers.find((i: J) => i?.type?.coding?.some?.((c: J) => c?.code === "MR"));
  return str((mr ?? identifiers[0])?.value);
}
function familyOf(names: unknown): string | null {
  if (!Array.isArray(names) || !names.length) return null;
  const n = names.find((x: J) => x?.use === "official") ?? names[0];
  return str(n?.family);
}

/** Reads a FHIR R4 Bundle (transaction, batch, collection, or searchset). */
export function parseFhirBundle(input: unknown): ParsedRecords {
  const b = input as J;
  if (!b || typeof b !== "object" || b.resourceType !== "Bundle" || !Array.isArray(b.entry)) {
    throw new RecordsError("Expected a FHIR Bundle with entries.");
  }
  if (b.entry.length > 2000) throw new RecordsError("Send at most 2,000 records at a time.");

  // Patients in the bundle, by every way they might be referenced.
  const people = new Map<string, { mrn: string | null; lastName: string | null }>();
  for (const e of b.entry as J[]) {
    const r = e?.resource;
    if (r?.resourceType !== "Patient") continue;
    const who = { mrn: mrnOf(r.identifier), lastName: familyOf(r.name) };
    if (str(e.fullUrl)) people.set(e.fullUrl, who);
    if (str(r.id)) people.set(`Patient/${r.id}`, who);
  }
  const subjectOf = (s: J | undefined) => {
    if (!s) return { mrn: null, lastName: null };
    const ref = str(s.reference);
    if (ref && people.has(ref)) return people.get(ref)!;
    return { mrn: str(s.identifier?.value), lastName: null };
  };

  const records: IncomingRecord[] = [];
  const skipped: string[] = [];
  for (const e of b.entry as J[]) {
    const r = e?.resource;
    if (!r || r.resourceType === "Patient") continue;
    const externalId = str(r.identifier?.[0]?.value) ?? str(r.id);

    if (r.resourceType === "Observation") {
      if (!externalId) { skipped.push("a result without an id"); continue; }
      const status = str(r.status);
      const withdrawn = status === "entered-in-error";
      if (!withdrawn && !["final", "amended", "corrected"].includes(status ?? "")) { skipped.push(`a result that isn't final yet (${status ?? "no status"})`); continue; }
      const code = (r.code?.coding as J[] | undefined)?.find((c) => c?.system === LOINC_SYSTEM && LOINC[c?.code]);
      if (!code) { skipped.push("a result Pumpkin doesn't track"); continue; }
      const q = r.valueQuantity as J | undefined;
      const value = typeof q?.value === "number" ? q.value : Number(q?.value);
      if (!withdrawn && !Number.isFinite(value)) { skipped.push("a result without a number"); continue; }
      const who = subjectOf(r.subject);
      const map = LOINC[code.code]!;
      records.push({
        kind: map.kind, externalId, ...who, analyte: map.analyte,
        value: Number.isFinite(value) ? value : 0, unit: normalizeUnit(str(q?.code) ?? str(q?.unit) ?? ""),
        collectedAt: str(r.effectiveDateTime) ?? str(r.effectivePeriod?.start) ?? str(r.issued) ?? new Date().toISOString(),
        corrected: status === "amended" || status === "corrected", withdrawn,
      });
      continue;
    }

    if (r.resourceType === "MedicationRequest") {
      if (!externalId) { skipped.push("a medication order without an id"); continue; }
      const status = str(r.status);
      const intent = str(r.intent) ?? "order";
      if (!["order", "original-order", "reflex-order", "filler-order", "instance-order", "plan"].includes(intent)) { skipped.push("a medication proposal, not an order"); continue; }
      const stop = ["stopped", "cancelled", "completed", "entered-in-error"].includes(status ?? "");
      if (!stop && status !== "active") { skipped.push(`a medication order that isn't active (${status ?? "no status"})`); continue; }
      const med = (r.medicationCodeableConcept ?? r.medication?.concept) as J | undefined;
      const dosage = (r.dosageInstruction as J[] | undefined)?.[0];
      const dq = dosage?.doseAndRate?.[0]?.doseQuantity as J | undefined;
      const repeat = dosage?.timing?.repeat as J | undefined;
      records.push({
        kind: stop ? "med_stop" : "med_order", externalId, ...subjectOf(r.subject),
        medication: str(med?.text) ?? str(med?.coding?.[0]?.display),
        dose: dq && dq.value != null ? `${dq.value} ${str(dq.unit) ?? str(dq.code) ?? ""}`.trim() : str(dosage?.text),
        timeOfDay: hhmm(repeat?.timeOfDay?.[0]),
        startsOn: dateOnly(repeat?.boundsPeriod?.start) ?? dateOnly(r.dispenseRequest?.validityPeriod?.start),
        endsOn: dateOnly(repeat?.boundsPeriod?.end) ?? dateOnly(r.dispenseRequest?.validityPeriod?.end),
      });
      continue;
    }
    skipped.push(`a ${str(r.resourceType) ?? "record"} Pumpkin doesn't use`);
  }
  return { records, skipped };
}

/** Splits one CSV line, honoring quotes. */
function csvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export const CSV_COLUMNS = ["result_id", "mrn", "last_name", "test", "value", "unit", "collected_at"] as const;

/** Reads a results CSV with a header row: result_id, mrn, last_name, test, value, unit, collected_at.
 *  "test" is a LOINC code or a name like estradiol, progesterone, LH, FSH or hCG. */
export function parseResultsCsv(text: string): ParsedRecords {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new RecordsError("The file needs a header row and at least one result.");
  if (lines.length > 2001) throw new RecordsError("Send at most 2,000 results at a time.");
  const head = csvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const missing = CSV_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new RecordsError(`The header row is missing: ${missing.join(", ")}.`);
  const at = (row: string[], c: (typeof CSV_COLUMNS)[number]) => row[head.indexOf(c)] ?? "";
  const records: IncomingRecord[] = []; const skipped: string[] = [];
  for (const line of lines.slice(1)) {
    const row = csvLine(line);
    const test = at(row, "test");
    const code = LOINC[test] ? test : TEST_NAMES[test.toLowerCase()];
    const value = Number(at(row, "value"));
    const externalId = at(row, "result_id");
    if (!externalId) { skipped.push("a row without a result_id"); continue; }
    if (!code) { skipped.push("a result Pumpkin doesn't track"); continue; }
    if (!Number.isFinite(value) || at(row, "value") === "") { skipped.push("a row without a number"); continue; }
    const map = LOINC[code]!;
    records.push({
      kind: map.kind, externalId, mrn: at(row, "mrn") || null, lastName: at(row, "last_name") || null,
      analyte: map.analyte, value, unit: normalizeUnit(at(row, "unit")),
      collectedAt: at(row, "collected_at") || new Date().toISOString(), corrected: false, withdrawn: false,
    });
  }
  return { records, skipped };
}

/** Compares names loosely: case, accents, spaces and hyphens don't matter. */
export const sameName = (a: string, b: string) => {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  return n(a) === n(b);
};
