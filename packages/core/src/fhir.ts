/**
 * Her record as FHIR R4 (the standard US health systems exchange), mapped at the edge from Pumpkin's
 * own tables. Every resource carries a Provenance saying who entered it (her clinic, Pumpkin reading a
 * document she checked, or her by hand), and a share carries the Consent it was sent under.
 *
 * Profiles: US Core where one exists (Patient, Observation lab, MedicationStatement isn't in US Core 6+
 * so it's base R4, Coverage). Things FHIR has no home for (her own cost entries, pregnancy dating) use
 * Pumpkin extensions under PUMPKIN_FHIR, to be published as an open implementation guide.
 */

export const PUMPKIN_FHIR = "https://thepumpkin.ai/fhir";
const US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition";

export type EnteredBy = "clinic" | "read" | "you";
export interface FhirRecordInput {
  id: string;
  patient: { name: string };
  createdAt: string;
  recipient?: string;
  expiresAt?: string;
  sections: string[];
  results?: { test: string; analyte: string; loinc?: string | null; value: number; unit: string; on: string; by: EnteredBy }[] | null;
  meds?: { medication: string; rxnorm?: string | null; dose: string; time: string; startsOn: string | null; endsOn: string | null; active: boolean; by: EnteredBy }[] | null;
  appointments?: { title: string; at: string; location?: string | null; by: EnteredBy }[];
  costs?: { kind: string; description: string; amountCents: number; on: string; dueOn: string | null; by: EnteredBy }[] | null;
  coverage?: { payer: string | null; plan: string | null; asOf: string | null; fertilityUsedCents: number | null; fertilityMaxCents: number | null; deductibleCents: number | null; deductibleMetCents: number | null; oopMaxCents: number | null; oopMetCents: number | null; by: EnteredBy }[] | null;
  pregnancy?: { conceivedOn: string | null; how: string | null; dueDate: string | null; ob: string | null };
}

type Resource = Record<string, unknown> & { resourceType: string; id: string };

/**
 * LOINC codes for the tests Pumpkin explains, serum or plasma. The first five match the codes checked
 * on loinc.org for the records connection (records.ts). AMH, TSH and prolactin are NOT YET CHECKED on
 * loinc.org; confirm before launch. The printed test name always travels with the code.
 */
export const LOINC_FOR_TEST: Record<string, { code: string; display: string }> = {
  estradiol: { code: "2243-4", display: "Estradiol (E2) [Mass/volume] in Serum or Plasma" },
  progesterone: { code: "2839-9", display: "Progesterone [Mass/volume] in Serum or Plasma" },
  lh: { code: "10501-5", display: "Lutropin [Units/volume] in Serum or Plasma" },
  fsh: { code: "15067-2", display: "Follitropin [Units/volume] in Serum or Plasma" },
  hcg: { code: "21198-7", display: "Choriogonadotropin.beta subunit [Units/volume] in Serum or Plasma" },
  amh: { code: "38476-3", display: "Mullerian inhibiting substance [Mass/volume] in Serum or Plasma" },
  tsh: { code: "3016-3", display: "Thyrotropin [Units/volume] in Serum or Plasma" },
  prolactin: { code: "2842-3", display: "Prolactin [Mass/volume] in Serum or Plasma" },
};

const PROVENANCE: Record<EnteredBy, { code: string; display: string; text: string }> = {
  clinic: { code: "clinic-sent", display: "Sent by a clinic", text: "From her clinic's system" },
  read: { code: "document-extracted", display: "Read from a document she checked", text: "Read by Pumpkin from a document she sent, then checked by her" },
  you: { code: "patient-entered", display: "Entered by the patient", text: "Entered by her" },
};

const ymd = (s: string) => s.slice(0, 10);
const dollars = (c: number) => ({ value: Math.round(c) / 100, currency: "USD" });
const nameParts = (full: string) => { const p = full.trim().split(/\s+/); return { family: p.length > 1 ? p[p.length - 1]! : p[0]!, given: p.length > 1 ? p.slice(0, -1) : [] }; };
// UCUM for the units labs print most; anything else travels as printed.
const UCUM: Record<string, string> = { "pg/ml": "pg/mL", "ng/ml": "ng/mL", "miu/ml": "m[IU]/mL", "uiu/ml": "u[IU]/mL", "µiu/ml": "u[IU]/mL", "iu/l": "[IU]/L", "ng/dl": "ng/dL", "pmol/l": "pmol/L", "nmol/l": "nmol/L" };

/** Her shared record as a FHIR R4 collection bundle, ready for any system that reads FHIR. */
export function recordToFhirBundle(r: FhirRecordInput): Resource {
  const entries: Resource[] = [];
  const pid = `patient-${r.id}`;
  const subject = { reference: `Patient/${pid}` };
  const n = nameParts(r.patient.name);
  // US Core Patient needs an identifier, a name and administrative gender. Pumpkin never assumes
  // gender, so it's "unknown" unless she adds it.
  entries.push({
    resourceType: "Patient", id: pid, meta: { profile: [`${US_CORE}/us-core-patient`] },
    identifier: [{ system: `${PUMPKIN_FHIR}/share`, value: r.id }],
    name: [{ text: r.patient.name, family: n.family, ...(n.given.length ? { given: n.given } : {}) }],
    gender: "unknown",
  });
  const provenanced: { res: Resource; by: EnteredBy }[] = [];
  const add = (res: Resource, by: EnteredBy) => { entries.push(res); provenanced.push({ res, by }); };

  (r.results ?? []).forEach((x, i) => {
    // The code stored on the result wins; otherwise Pumpkin's table for the tests it knows.
    const known = LOINC_FOR_TEST[x.analyte];
    const loinc = x.loinc ? { code: x.loinc, display: known?.code === x.loinc ? known.display : undefined } : known;
    const ucum = UCUM[x.unit.toLowerCase()];
    add({
      resourceType: "Observation", id: `result-${i + 1}`, meta: { profile: [`${US_CORE}/us-core-observation-lab`] },
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }] }],
      code: { ...(loinc ? { coding: [{ system: "http://loinc.org", code: loinc.code, ...(loinc.display ? { display: loinc.display } : {}) }] } : {}), text: x.test },
      subject, effectiveDateTime: ymd(x.on),
      valueQuantity: { value: x.value, unit: x.unit || undefined, ...(ucum ? { system: "http://unitsofmeasure.org", code: ucum } : {}) },
    }, x.by);
  });

  (r.meds ?? []).forEach((m, i) => {
    add({
      resourceType: "MedicationStatement", id: `med-${i + 1}`,
      status: m.active ? "active" : "completed",
      medicationCodeableConcept: { ...(m.rxnorm ? { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: m.rxnorm }] } : {}), text: m.medication },
      subject,
      ...(m.startsOn ? { effectivePeriod: { start: m.startsOn, ...(m.endsOn ? { end: m.endsOn } : {}) } } : {}),
      dosage: [{ text: `${m.dose} at ${m.time}`.trim(), timing: { repeat: { timeOfDay: [`${m.time}:00`] } } }],
    }, m.by);
  });

  (r.appointments ?? []).forEach((a, i) => {
    add({
      resourceType: "Appointment", id: `visit-${i + 1}`, status: "booked", description: a.title, start: new Date(a.at).toISOString(),
      participant: [{ actor: { ...subject, display: r.patient.name }, status: "accepted" }],
      ...(a.location ? { comment: a.location } : {}),
    }, a.by);
  });

  (r.coverage ?? []).forEach((c, i) => {
    const benefit = (type: string, allowed: number | null, used: number | null) => (allowed === null && used === null ? [] : [{
      type: { coding: [{ system: `${PUMPKIN_FHIR}/CodeSystem/benefit`, code: type }], text: type },
      ...(allowed !== null ? { allowedMoney: dollars(allowed) } : {}), ...(used !== null ? { usedMoney: dollars(used) } : {}),
    }]);
    add({
      resourceType: "Coverage", id: `coverage-${i + 1}`, meta: { profile: [`${US_CORE}/us-core-coverage`] },
      status: "active", beneficiary: subject,
      payor: [{ display: c.payer ?? "Unknown insurer" }],
      ...(c.plan ? { class: [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/coverage-class", code: "plan" }] }, value: c.plan, name: c.plan }] } : {}),
      extension: [{
        url: `${PUMPKIN_FHIR}/StructureDefinition/benefit-balance`,
        extension: [
          ...(c.asOf ? [{ url: "asOf", valueDate: ymd(c.asOf) }] : []),
          ...[...benefit("fertility", c.fertilityMaxCents, c.fertilityUsedCents), ...benefit("deductible", c.deductibleCents, c.deductibleMetCents), ...benefit("out-of-pocket", c.oopMaxCents, c.oopMetCents)]
            .map((b) => ({ url: "balance", extension: [{ url: "type", valueString: b.type.text }, ...("allowedMoney" in b ? [{ url: "allowed", valueMoney: b.allowedMoney }] : []), ...("usedMoney" in b ? [{ url: "used", valueMoney: b.usedMoney }] : [])] })),
        ],
      }],
    }, c.by);
  });

  // Her own charges and payments aren't claims, so they use the Pumpkin cost-entry profile on Basic.
  (r.costs ?? []).forEach((c, i) => {
    add({
      resourceType: "Basic", id: `cost-${i + 1}`, meta: { profile: [`${PUMPKIN_FHIR}/StructureDefinition/cost-entry`] },
      code: { coding: [{ system: `${PUMPKIN_FHIR}/CodeSystem/record-type`, code: "cost-entry" }], text: c.description },
      subject, created: ymd(c.on),
      extension: [
        { url: `${PUMPKIN_FHIR}/StructureDefinition/cost-kind`, valueCode: c.kind },
        { url: `${PUMPKIN_FHIR}/StructureDefinition/cost-amount`, valueMoney: dollars(c.amountCents) },
        ...(c.dueOn ? [{ url: `${PUMPKIN_FHIR}/StructureDefinition/cost-due`, valueDate: ymd(c.dueOn) }] : []),
      ],
    }, c.by);
  });

  const p = r.pregnancy;
  if (p && (p.conceivedOn || p.dueDate)) {
    add({
      resourceType: "Basic", id: "pregnancy", meta: { profile: [`${PUMPKIN_FHIR}/StructureDefinition/pregnancy-dating`] },
      code: { coding: [{ system: `${PUMPKIN_FHIR}/CodeSystem/record-type`, code: "pregnancy-dating" }], text: "Pregnancy dating" },
      subject,
      extension: [
        ...(p.conceivedOn ? [{ url: `${PUMPKIN_FHIR}/StructureDefinition/conceived-on`, valueDate: p.conceivedOn }] : []),
        ...(p.dueDate ? [{ url: `${PUMPKIN_FHIR}/StructureDefinition/estimated-due-date`, valueDate: p.dueDate }] : []),
        // Embryo details (transfer day, insemination) only when she chose to include them.
        ...(p.how ? [{ url: `${PUMPKIN_FHIR}/StructureDefinition/conception-method`, valueCode: p.how }] : []),
      ],
    }, "you");
  }

  // Who entered each item, as FHIR Provenance.
  provenanced.forEach(({ res, by }, i) => {
    const pv = PROVENANCE[by];
    entries.push({
      resourceType: "Provenance", id: `provenance-${i + 1}`,
      target: [{ reference: `${res.resourceType}/${res.id}` }],
      recorded: new Date(r.createdAt).toISOString(),
      activity: { coding: [{ system: `${PUMPKIN_FHIR}/CodeSystem/source`, code: pv.code, display: pv.display }], text: pv.text },
      agent: [{ who: by === "clinic" ? { display: "Her clinic" } : { ...subject, display: r.patient.name } }],
    });
  });

  // The consent this was shared under: who it's for, what's in it, and until when.
  if (r.recipient) {
    entries.push({
      resourceType: "Consent", id: "share-consent", status: "active",
      scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy" }] },
      category: [{ coding: [{ system: "http://loinc.org", code: "59284-0", display: "Patient Consent" }] }],
      patient: subject, dateTime: new Date(r.createdAt).toISOString(),
      policyRule: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "OPTIN" }] },
      provision: {
        type: "permit",
        ...(r.expiresAt ? { period: { start: new Date(r.createdAt).toISOString(), end: new Date(r.expiresAt).toISOString() } } : {}),
        actor: [{ role: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", code: "IRCP" }] }, reference: { display: r.recipient } }],
        code: r.sections.map((s) => ({ coding: [{ system: `${PUMPKIN_FHIR}/CodeSystem/share-section`, code: s }] })),
      },
    });
  }

  return {
    resourceType: "Bundle", id: `share-${r.id}`, type: "collection", timestamp: new Date(r.createdAt).toISOString(),
    meta: { tag: [{ system: `${PUMPKIN_FHIR}/CodeSystem/tag`, code: "patient-shared", display: "Shared by the patient from Pumpkin" }] },
    entry: entries.map((res) => ({ fullUrl: `urn:uuid:${uuidish(r.id, res.resourceType, res.id)}`, resource: res })),
  };
}

/** A stable UUID-shaped id per resource, so references inside the bundle are consistent. */
function uuidish(...parts: string[]) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const ch of parts.join("/")) { h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0; h2 = Math.imul(h2 + ch.charCodeAt(0), 2246822519) >>> 0; }
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(2);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Checks the rules a receiving system relies on. Not a replacement for the HL7 validator (run before
 * launch), but it catches the mistakes that make a bundle unusable: missing required fields, broken
 * references, items without a Provenance.
 */
export function checkFhirBundle(bundle: Resource): string[] {
  const problems: string[] = [];
  const entries = (bundle.entry as { fullUrl: string; resource: Resource }[] | undefined) ?? [];
  const ids = new Set(entries.map((e) => `${e.resource.resourceType}/${e.resource.id}`));
  const urls = new Set<string>();
  for (const { fullUrl, resource: r } of entries) {
    if (urls.has(fullUrl)) problems.push(`duplicate fullUrl ${fullUrl}`);
    urls.add(fullUrl);
    const where = `${r.resourceType}/${r.id}`;
    const need = (cond: unknown, what: string) => { if (!cond) problems.push(`${where}: missing ${what}`); };
    if (!/^[A-Za-z0-9\-.]{1,64}$/.test(r.id)) problems.push(`${where}: bad id`);
    switch (r.resourceType) {
      case "Patient": need(r.identifier, "identifier"); need(r.name, "name"); need(r.gender, "gender"); break;
      case "Observation": need(r.status, "status"); need(r.category, "category"); need((r.code as { text?: string })?.text, "code"); need(r.subject, "subject"); need(r.effectiveDateTime, "effective date"); break;
      case "MedicationStatement": need(r.status, "status"); need(r.medicationCodeableConcept, "medication"); need(r.subject, "subject"); break;
      case "Appointment": need(r.status, "status"); need(r.participant, "participant"); break;
      case "Coverage": need(r.status, "status"); need(r.beneficiary, "beneficiary"); need(r.payor, "payor"); break;
      case "Basic": need(r.code, "code"); break;
      case "Provenance": need(r.target, "target"); need(r.recorded, "recorded"); need(r.agent, "agent"); break;
      case "Consent": need(r.status, "status"); need(r.scope, "scope"); need(r.category, "category"); need(r.patient, "patient"); break;
    }
    // Every reference inside the bundle must point at something in it.
    const walk = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) { v.forEach(walk); return; }
      const ref = (v as { reference?: unknown }).reference;
      if (typeof ref === "string" && !ids.has(ref)) problems.push(`${where}: reference ${ref} isn't in the bundle`);
      Object.values(v).forEach(walk);
    };
    walk(r);
  }
  const traced = new Set(entries.filter((e) => e.resource.resourceType === "Provenance").flatMap((e) => (e.resource.target as { reference: string }[]).map((t) => t.reference)));
  for (const { resource: r } of entries) {
    if (["Patient", "Provenance", "Consent"].includes(r.resourceType)) continue;
    if (!traced.has(`${r.resourceType}/${r.id}`)) problems.push(`${r.resourceType}/${r.id}: no Provenance`);
  }
  return problems;
}
