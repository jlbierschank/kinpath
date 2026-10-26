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
export interface AppointmentRecord {
  kind: "appointment";
  externalId: string;
  mrn: string | null;
  lastName: string | null;
  startsAt: string;
  apptKind: "monitoring" | "blood_test" | "consult" | "retrieval" | "transfer" | "procedure" | "other";
  title: string;
  location: string | null;
  cancelled: boolean;
}
export type IncomingRecord = ResultRecord | MedRecord | AppointmentRecord;

const APPT_TITLES: Record<AppointmentRecord["apptKind"], string> = {
  monitoring: "Monitoring visit", blood_test: "Blood test", consult: "Consultation", retrieval: "Egg retrieval",
  transfer: "Embryo transfer", procedure: "Procedure", other: "Appointment",
};
/** Guesses the kind of visit from its description, for the icon and default title only. */
export function apptKindOf(text: string): AppointmentRecord["apptKind"] {
  const t = text.toLowerCase();
  if (/monitor|ultrasound|scan|follicle/.test(t)) return "monitoring";
  if (/blood|lab|draw|beta|hcg|pregnancy test/.test(t)) return "blood_test";
  if (/retriev/.test(t)) return "retrieval";
  if (/transfer|\bfet\b/.test(t)) return "transfer";
  if (/consult|follow.?up|new patient|visit with/.test(t)) return "consult";
  if (/procedure|hysteroscop|sono|hsg|iui|insemination/.test(t)) return "procedure";
  return "other";
}
const apptTitle = (text: string | null, kind: AppointmentRecord["apptKind"]) => (text && text.length <= 120 ? text : APPT_TITLES[kind]);
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
    // Absolute references ("https://ehr.example/fhir/Patient/123") match by their last two parts.
    const tail = ref?.match(/(Patient\/[^/]+)$/)?.[1];
    if (tail && people.has(tail)) return people.get(tail)!;
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
    if (r.resourceType === "Appointment") {
      if (!externalId) { skipped.push("an appointment without an id"); continue; }
      const status = str(r.status) ?? "";
      const cancelled = ["cancelled", "noshow", "entered-in-error"].includes(status);
      if (!cancelled && !["booked", "pending", "arrived", "checked-in", "fulfilled"].includes(status)) { skipped.push(`an appointment that isn't booked (${status || "no status"})`); continue; }
      const start = str(r.start);
      if (!start) { skipped.push("an appointment without a start time"); continue; }
      const parts = (r.participant as J[] | undefined) ?? [];
      const who = parts.map((x) => x?.actor).find((a: J) => /(^|\/)Patient\//.test(str(a?.reference) ?? "") || a?.type === "Patient" || people.has(str(a?.reference) ?? ""));
      const loc = parts.map((x) => x?.actor).find((a: J) => /(^|\/)Location\//.test(str(a?.reference) ?? "") || a?.type === "Location");
      const text = str(r.appointmentType?.text) ?? str(r.serviceType?.[0]?.text) ?? str(r.serviceType?.[0]?.coding?.[0]?.display) ?? str(r.description);
      const kind = apptKindOf(text ?? "");
      records.push({ kind: "appointment", externalId, ...subjectOf(who), startsAt: start, apptKind: kind, title: apptTitle(text, kind), location: str(loc?.display), cancelled });
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

// ---------- HL7 v2 ----------
// Field positions (HL7 v2.5.1): PID-3 patient identifier list (CX, component 5 = identifier type, "MR"),
// PID-5 name; OBR-3 filler order number, OBR-7 observation date/time; OBX-3 observation identifier
// (code^text^system, "LN" = LOINC), OBX-5 value, OBX-6 units, OBX-11 result status, OBX-14 observation
// date/time; ORC-1 order control (NW new, CA cancel, DC discontinue, OD discontinued, XO change),
// ORC-2/3 placer/filler order number; RXE-2 give code, RXE-3 give amount minimum, RXE-5 give units;
// TQ1-4 explicit time, TQ1-7 start, TQ1-8 end; SCH-1/2 placer/filler appointment id, SCH-7 reason,
// SCH-25 filler status; AIS-3 service, AIS-4 start date/time.

/** "20261026074500-0400" → ISO. Dates without a zone are read as the clinic's local time by the caller. */
export function hl7Time(v: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4})?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", se = "00", z] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}${z ? `${z.slice(0, 3)}:${z.slice(3)}` : ""}`;
}

/** segments[segment][field][repetition][component] */
interface Hl7Message { type: string; event: string; controlId: string; segments: string[][][][] }

/** Splits a batch of HL7 v2 messages (segments separated by CR or newlines). */
export function splitHl7(text: string): Hl7Message[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(FHS|BHS|BTS|FTS)\|/.test(l));
  const msgs: string[][] = [];
  for (const l of lines) { if (l.startsWith("MSH")) msgs.push([l]); else if (msgs.length) msgs[msgs.length - 1]!.push(l); }
  if (!msgs.length) throw new RecordsError("Expected HL7 v2 messages starting with MSH.");
  return msgs.map((segs) => {
    const msh = segs[0]!;
    const fs = msh[3] ?? "|";
    const comp = msh[4] ?? "^";
    const rep = msh[5] ?? "~";
    const parsed = segs.map((seg) => {
      const fields = seg.split(fs);
      // MSH-1 is the field separator itself; shift so field numbers line up with the standard.
      if (fields[0] === "MSH") fields.splice(1, 0, fs);
      return fields.map((f) => f.split(rep).map((r) => r.split(comp)));
    });
    const mshF = parsed[0]!;
    return { type: mshF[9]?.[0]?.[0] ?? "", event: mshF[9]?.[0]?.[1] ?? "", controlId: mshF[10]?.[0]?.[0] ?? "", segments: parsed };
  });
}

const fld = (seg: string[][][] | undefined, n: number, c = 1) => (seg?.[n]?.[0]?.[c - 1] ?? "").trim();
const segsOf = (m: Hl7Message, name: string) => m.segments.filter((s) => s[0]?.[0]?.[0] === name);

function hl7Patient(m: Hl7Message): { mrn: string | null; lastName: string | null } {
  const pid = segsOf(m, "PID")[0];
  if (!pid) return { mrn: null, lastName: null };
  // PID-3 may repeat (MRN, account number, …): prefer the one typed MR.
  const ids = pid[3] ?? [];
  const mr = ids.find((r) => (r[4] ?? "").trim() === "MR") ?? ids[0];
  const mrn = (mr?.[0] ?? "").trim();
  return { mrn: mrn || null, lastName: fld(pid, 5) || null };
}

/** Reads HL7 v2 lab results (ORU^R01), pharmacy orders (RDE^O11, OMP^O09) and scheduling (SIU^S12–S17). */
export function parseHl7(text: string): ParsedRecords & { messages: { controlId: string; type: string }[] } {
  const msgs = splitHl7(text);
  if (msgs.length > 2000) throw new RecordsError("Send at most 2,000 messages at a time.");
  const records: IncomingRecord[] = []; const skipped: string[] = [];
  for (const m of msgs) {
    const who = hl7Patient(m);
    if (m.type === "ORU") {
      let obr: string[][][] | undefined;
      for (const seg of m.segments) {
        if (seg[0]?.[0]?.[0] === "OBR") { obr = seg; continue; }
        if (seg[0]?.[0]?.[0] !== "OBX") continue;
        const code = fld(seg, 3, 1), system = fld(seg, 3, 3);
        const loincCode = system === "LN" || LOINC[code] ? code : fld(seg, 3, 6) === "LN" ? fld(seg, 3, 4) : "";
        const map = LOINC[loincCode];
        if (!map) { skipped.push("a result Pumpkin doesn't track"); continue; }
        const status = fld(seg, 11);
        const withdrawn = status === "W" || status === "D";
        if (!withdrawn && !["F", "C"].includes(status)) { skipped.push(`a result that isn't final yet (${status || "no status"})`); continue; }
        const value = Number(fld(seg, 5));
        if (!withdrawn && !Number.isFinite(value)) { skipped.push("a result without a number"); continue; }
        const order = fld(obr, 3) || fld(obr, 2) || m.controlId;
        const when = hl7Time(fld(seg, 14)) ?? hl7Time(fld(obr, 7)) ?? new Date().toISOString();
        records.push({ kind: map.kind, externalId: `${order}:${loincCode}:${fld(seg, 4) || "1"}`, ...who, analyte: map.analyte,
          value: Number.isFinite(value) ? value : 0, unit: normalizeUnit(fld(seg, 6)), collectedAt: when, corrected: status === "C", withdrawn });
      }
      continue;
    }
    if (m.type === "RDE" || m.type === "OMP") {
      const orc = segsOf(m, "ORC")[0];
      const rx = segsOf(m, m.type === "RDE" ? "RXE" : "RXO")[0];
      const tq1 = segsOf(m, "TQ1")[0];
      const control = fld(orc, 1);
      const externalId = fld(orc, 3) || fld(orc, 2);
      if (!externalId) { skipped.push("a medication order without an id"); continue; }
      const stop = ["CA", "DC", "OD", "OC"].includes(control);
      if (!stop && !["NW", "XO", "OK", "SC", ""].includes(control)) { skipped.push(`a medication message Pumpkin doesn't use (${control})`); continue; }
      // RXE-2 / RXO-1 give code (code^text); RXE-3 / RXO-2 amount; RXE-5 / RXO-4 units.
      const codeField = m.type === "RDE" ? 2 : 1, amt = m.type === "RDE" ? 3 : 2, units = m.type === "RDE" ? 5 : 4;
      const medication = fld(rx, codeField, 2) || fld(rx, codeField, 1) || null;
      const dose = fld(rx, amt) ? `${fld(rx, amt)} ${fld(rx, units, 2) || fld(rx, units, 1)}`.trim() : null;
      // TQ1-4 explicit time ("2130"); otherwise the time part of TQ1-7 start, if it has one.
      const t = fld(tq1, 4);
      const startIso = hl7Time(fld(tq1, 7));
      const startTime = fld(tq1, 7).length >= 12 ? startIso?.slice(11, 16) ?? null : null;
      records.push({ kind: stop ? "med_stop" : "med_order", externalId, ...who, medication, dose,
        timeOfDay: /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : startTime,
        startsOn: hl7Time(fld(tq1, 7))?.slice(0, 10) ?? null, endsOn: hl7Time(fld(tq1, 8))?.slice(0, 10) ?? null });
      continue;
    }
    if (m.type === "SIU") {
      const sch = segsOf(m, "SCH")[0]; const ais = segsOf(m, "AIS")[0]; const ail = segsOf(m, "AIL")[0];
      const externalId = fld(sch, 2) || fld(sch, 1);
      if (!externalId) { skipped.push("an appointment without an id"); continue; }
      const cancelled = ["S15", "S17"].includes(m.event) || /cancel/i.test(fld(sch, 25));
      const start = hl7Time(fld(ais, 4)) ?? hl7Time(fld(sch, 11, 4));
      if (!start) { skipped.push("an appointment without a start time"); continue; }
      const text = fld(ais, 3, 2) || fld(sch, 7, 2) || fld(sch, 7, 1) || null;
      const kind = apptKindOf(text ?? "");
      records.push({ kind: "appointment", externalId, ...who, startsAt: start, apptKind: kind, title: apptTitle(text, kind), location: fld(ail, 3, 1) || null, cancelled });
      continue;
    }
    skipped.push(`an HL7 ${m.type}^${m.event} message Pumpkin doesn't use`);
  }
  return { records, skipped, messages: msgs.map((m) => ({ controlId: m.controlId, type: `${m.type}^${m.event}` })) };
}

/** An HL7 v2 acknowledgment for each message: AA accepted, AE error. */
export function hl7Ack(messages: { controlId: string; type: string }[], ok: boolean, text = ""): string {
  const now = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return messages.map((m) => [
    `MSH|^~\\&|PUMPKIN|PUMPKIN|||${now}||ACK^${m.type.split("^")[1] ?? ""}|ACK${m.controlId}|P|2.5.1`,
    `MSA|${ok ? "AA" : "AE"}|${m.controlId}${text ? `|${text.replace(/[|^~\\&\r\n]/g, " ").slice(0, 80)}` : ""}`,
  ].join("\r")).join("\r");
}
