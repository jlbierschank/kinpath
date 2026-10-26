/**
 * Money: cost estimates, insurance and benefits, charges and payments, receipts, financing options,
 * and questions about costs. See migrations/014_money.sql for who sees what.
 *
 * Financial counselors enter and share everything here, or it arrives from the clinic's billing
 * system through the records connection. Pumpkin doesn't take payments (yet); a payment recorded
 * here was made somewhere else and is shown so the patient can plan.
 */
import { HandoffError } from "@kinpath/core";
import { asActor, audit, type Actor, type Db, type Tx } from "./client";
import { alertPatient, notify } from "./notify";

type Staff = Actor & { name: string };
function requireCounselor(a: Actor) { if (a.role !== "financial_counselor") throw new HandoffError("Only financial counselors can change cost information."); }

export const ESTIMATE_CATEGORIES = { clinic: "Clinic and procedure fees", medications: "Medications", lab: "Lab and embryology", anesthesia: "Anesthesia", storage: "Storage", other: "Other" } as const;
export type EstimateCategory = keyof typeof ESTIMATE_CATEGORIES;
export const LEDGER_KINDS = { charge: "Charge", payment: "Payment", adjustment: "Adjustment", refund: "Refund" } as const;
export type LedgerKind = keyof typeof LEDGER_KINDS;
export const PAY_METHODS = { card: "Card", check: "Check", cash: "Cash", bank: "Bank transfer", financing: "Financing", insurance: "Insurance", other: "Other" } as const;
export const PARTNER_KINDS = { loan: "Loan", grant: "Grant", discount: "Discount program", employer: "Employer benefit", other: "Other" } as const;

/** "$1,234.50" ↔ cents. Accepts "1234.5", "$1,234.50". */
export function toCents(v: string | number): number {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new HandoffError("Enter an amount like 1,250.00.");
  return Math.round(n * 100);
}
export const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const clean = (s: string | undefined | null) => (s ?? "").trim();
const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const day = (d: string | Date | null) => (d == null ? null : typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

// ---------- the money view (patient, support person, counselor) ----------

export interface EstimateView {
  id: string; title: string; note: string | null; status: "draft" | "shared" | "replaced"; validUntil: string | null; sharedAt: string | null; source: string;
  items: { id: string; label: string; category: EstimateCategory; amountCents: number; insuranceCents: number }[];
  totalCents: number; insuranceCents: number; youPayCents: number;
}
export interface CoverageView {
  id: string; kind: "insurance" | "employer_benefit" | "self_pay"; payerName: string | null; planName: string | null; memberLast4: string | null;
  fertilityBenefit: string | null; lifetimeMaxCents: number | null; lifetimeUsedCents: number; cyclesMax: number | null; cyclesUsed: number;
  deductibleCents: number | null; deductibleMetCents: number; oopMaxCents: number | null; oopMetCents: number;
  priorAuth: "none" | "needed" | "submitted" | "approved" | "denied"; endsOn: string | null; active: boolean; source: string; updatedAt: string;
}
export interface LedgerEntry {
  id: string; kind: LedgerKind; description: string; amountCents: number; occurredOn: string; dueOn: string | null;
  method: string | null; receiptNumber: string | null; source: string;
}
export interface MoneyView {
  estimates: EstimateView[];
  coverage: CoverageView[];
  ledger: LedgerEntry[];
  /** Charges minus payments and adjustments, plus refunds. Positive = she owes. */
  balanceCents: number;
  paidCents: number;
  nextDue: { dueOn: string; amountCents: number } | null;
  questions: { id: string; question: string; answer: string | null; answeredBy: string | null; createdAt: string; answeredAt: string | null; read: boolean; estimateId: string | null }[];
  partners: { id: string; kind: string; name: string; description: string; url: string | null; phone: string | null }[];
}

const cents = (v: unknown) => Number(v ?? 0);

export async function patientMoney(db: Db, actor: Actor, patientId: string): Promise<MoneyView> {
  return asActor(db, actor, async (tx) => {
    const est = (await tx.query<{ id: string; title: string; note: string | null; status: EstimateView["status"]; valid_until: string | null; shared_at: Date | null; source: string }>(
      `SELECT id, title, note, status, valid_until::text, shared_at, source FROM finance_estimates WHERE patient_id = $1 AND status <> 'replaced' ORDER BY coalesce(shared_at, created_at) DESC`, [patientId])).rows;
    const items = est.length ? (await tx.query<{ id: string; estimate_id: string; label: string; category: EstimateCategory; amount_cents: string; insurance_cents: string }>(
      `SELECT id, estimate_id, label, category, amount_cents, insurance_cents FROM finance_estimate_items WHERE estimate_id = ANY($1::uuid[]) ORDER BY sort_order, label`, [est.map((e) => e.id)])).rows : [];
    const estimates: EstimateView[] = est.map((e) => {
      const its = items.filter((i) => i.estimate_id === e.id).map((i) => ({ id: i.id, label: i.label, category: i.category, amountCents: cents(i.amount_cents), insuranceCents: cents(i.insurance_cents) }));
      const total = its.reduce((s, i) => s + i.amountCents, 0), ins = its.reduce((s, i) => s + i.insuranceCents, 0);
      return { id: e.id, title: e.title, note: e.note, status: e.status, validUntil: e.valid_until, sharedAt: iso(e.shared_at), source: e.source, items: its, totalCents: total, insuranceCents: ins, youPayCents: total - ins };
    });
    const coverage = (await tx.query<Record<string, unknown>>(`SELECT * FROM finance_coverage WHERE patient_id = $1 ORDER BY active DESC, updated_at DESC`, [patientId])).rows.map((c): CoverageView => ({
      id: String(c.id), kind: c.kind as CoverageView["kind"], payerName: (c.payer_name as string) ?? null, planName: (c.plan_name as string) ?? null, memberLast4: (c.member_last4 as string) ?? null,
      fertilityBenefit: (c.fertility_benefit as string) ?? null, lifetimeMaxCents: c.lifetime_max_cents == null ? null : cents(c.lifetime_max_cents), lifetimeUsedCents: cents(c.lifetime_used_cents),
      cyclesMax: (c.cycles_max as number) ?? null, cyclesUsed: Number(c.cycles_used ?? 0), deductibleCents: c.deductible_cents == null ? null : cents(c.deductible_cents), deductibleMetCents: cents(c.deductible_met_cents),
      oopMaxCents: c.oop_max_cents == null ? null : cents(c.oop_max_cents), oopMetCents: cents(c.oop_met_cents), priorAuth: c.prior_auth as CoverageView["priorAuth"],
      endsOn: day(c.ends_on as string | null), active: !!c.active, source: String(c.source), updatedAt: iso(c.updated_at as Date)!,
    }));
    const ledger = (await tx.query<{ id: string; kind: LedgerKind; description: string; amount_cents: string; occurred_on: string; due_on: string | null; method: string | null; receipt_number: string | null; source: string }>(
      `SELECT id, kind, description, amount_cents, occurred_on::text, due_on::text, method, receipt_number, source FROM finance_ledger WHERE patient_id = $1 AND voided_at IS NULL ORDER BY occurred_on DESC, created_at DESC`, [patientId])).rows
      .map((l) => ({ id: l.id, kind: l.kind, description: l.description, amountCents: cents(l.amount_cents), occurredOn: l.occurred_on, dueOn: l.due_on, method: l.method, receiptNumber: l.receipt_number, source: l.source }));
    const sum = (k: LedgerKind) => ledger.filter((l) => l.kind === k).reduce((s, l) => s + l.amountCents, 0);
    const balance = sum("charge") - sum("payment") - sum("adjustment") + sum("refund");
    // Next due: the earliest due date among charges, if she still owes anything.
    const due = ledger.filter((l) => l.kind === "charge" && l.dueOn).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
    const upcoming = due.find((l) => l.dueOn! >= new Date().toISOString().slice(0, 10)) ?? due[due.length - 1];
    const questions = (await tx.query<{ id: string; question: string; answer: string | null; answered_by_name: string | null; created_at: Date; answered_at: Date | null; read_at: Date | null; estimate_id: string | null }>(
      `SELECT id, question, answer, answered_by_name, created_at, answered_at, read_at, estimate_id FROM finance_questions WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50`, [patientId])).rows
      .map((q) => ({ id: q.id, question: q.question, answer: q.answer, answeredBy: q.answered_by_name, createdAt: iso(q.created_at)!, answeredAt: iso(q.answered_at), read: !!q.read_at, estimateId: q.estimate_id }));
    const partners = (await tx.query<{ id: string; kind: string; name: string; description: string; url: string | null; phone: string | null }>(
      `SELECT id, kind, name, description, url, phone FROM finance_partners WHERE active ORDER BY sort_order, name`)).rows;
    return { estimates, coverage, ledger, balanceCents: balance, paidCents: sum("payment") - sum("refund"),
      nextDue: balance > 0 && upcoming ? { dueOn: upcoming.dueOn!, amountCents: Math.min(balance, upcoming.amountCents) } : null, questions, partners };
  });
}

// ---------- counselor: list ----------

export async function moneyPatients(db: Db, counselor: Actor) {
  requireCounselor(counselor);
  return asActor(db, counselor, async (tx) => (await tx.query<{ id: string; first_name: string; last_name: string; mrn: string | null; balance: string; next_due: string | null; est: string | null; payer: string | null; open_q: number }>(
    `SELECT p.id, p.first_name, p.last_name, p.mrn,
            coalesce((SELECT sum(CASE kind WHEN 'charge' THEN amount_cents WHEN 'refund' THEN amount_cents ELSE -amount_cents END) FROM finance_ledger l WHERE l.patient_id = p.id AND voided_at IS NULL), 0) AS balance,
            (SELECT min(due_on)::text FROM finance_ledger l WHERE l.patient_id = p.id AND kind = 'charge' AND voided_at IS NULL AND due_on >= current_date) AS next_due,
            (SELECT status FROM finance_estimates e WHERE e.patient_id = p.id AND status <> 'replaced' ORDER BY created_at DESC LIMIT 1) AS est,
            (SELECT payer_name FROM finance_coverage c WHERE c.patient_id = p.id AND active ORDER BY updated_at DESC LIMIT 1) AS payer,
            (SELECT count(*)::int FROM finance_questions q WHERE q.patient_id = p.id AND answer IS NULL) AS open_q
       FROM patients p ORDER BY open_q DESC, p.last_name, p.first_name`)).rows.map((r) => ({
    id: r.id, name: `${r.first_name} ${r.last_name}`, mrn: r.mrn, balanceCents: Number(r.balance), nextDue: r.next_due, estimate: r.est as "draft" | "shared" | null, payer: r.payer, openQuestions: r.open_q,
  })));
}

// ---------- counselor: estimates ----------

export interface EstimateInput {
  patientId: string; estimateId?: string; title: string; note?: string; validUntil?: string;
  items: { label: string; category: string; amount: string | number; insurance?: string | number }[];
}

export async function saveEstimate(db: Db, counselor: Staff, input: EstimateInput): Promise<{ id: string }> {
  requireCounselor(counselor);
  const title = clean(input.title);
  if (!title || title.length > 120) throw new HandoffError("Give the estimate a short title, like “IVF cycle with ICSI”.");
  const items = input.items.filter((i) => clean(i.label) || clean(String(i.amount ?? "")));
  if (!items.length) throw new HandoffError("Add at least one line.");
  const rows = items.map((i, n) => {
    const label = clean(i.label);
    if (!label || label.length > 120) throw new HandoffError(`Line ${n + 1} needs a description.`);
    const amount = toCents(i.amount), ins = clean(String(i.insurance ?? "")) ? toCents(i.insurance!) : 0;
    if (ins > amount) throw new HandoffError(`Line ${n + 1}: insurance can't cover more than the line costs.`);
    const category = (i.category in ESTIMATE_CATEGORIES ? i.category : "other") as EstimateCategory;
    return { label, category, amount, ins, n };
  });
  if (input.validUntil && !isDate(input.validUntil)) throw new HandoffError("Choose a valid-until date.");
  const note = clean(input.note) || null;
  if (note && note.length > 1000) throw new HandoffError("Keep the note under 1,000 characters.");
  return asActor(db, counselor, async (tx) => {
    let id = input.estimateId;
    if (id) {
      const r = await tx.query(`UPDATE finance_estimates SET title = $2, note = $3, valid_until = $4, updated_at = now() WHERE id = $1 AND patient_id = $5 AND status = 'draft' RETURNING id`,
        [id, title, note, input.validUntil || null, input.patientId]);
      if (!r.rows[0]) throw new HandoffError("Only a draft can be edited. Make a new estimate to change a shared one.");
      await tx.query(`DELETE FROM finance_estimate_items WHERE estimate_id = $1`, [id]);
    } else {
      id = (await tx.query<{ id: string }>(`INSERT INTO finance_estimates (clinic_id, patient_id, title, note, valid_until, created_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [counselor.clinicId, input.patientId, title, note, input.validUntil || null, counselor.name])).rows[0]!.id;
    }
    for (const r of rows) {
      await tx.query(`INSERT INTO finance_estimate_items (clinic_id, estimate_id, label, category, amount_cents, insurance_cents, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [counselor.clinicId, id, r.label, r.category, r.amount, r.ins, r.n]);
    }
    await audit(tx, counselor, "money.saved_estimate", input.patientId, { estimateId: id, lines: rows.length });
    return { id: id! };
  });
}

/** Shows the estimate to the patient. Any earlier shared estimate is marked replaced. */
export async function shareEstimate(db: Db, counselor: Staff, estimateId: string) {
  requireCounselor(counselor);
  const patientId = await asActor(db, counselor, async (tx) => {
    const e = (await tx.query<{ patient_id: string; n: number }>(`SELECT e.patient_id, (SELECT count(*)::int FROM finance_estimate_items i WHERE i.estimate_id = e.id) AS n FROM finance_estimates e WHERE e.id = $1 AND e.status = 'draft'`, [estimateId])).rows[0];
    if (!e) throw new HandoffError("That estimate was already shared.");
    if (!e.n) throw new HandoffError("Add at least one line before sharing.");
    await tx.query(`UPDATE finance_estimates SET status = 'replaced', updated_at = now() WHERE patient_id = $1 AND status = 'shared'`, [e.patient_id]);
    await tx.query(`UPDATE finance_estimates SET status = 'shared', shared_at = now(), updated_at = now() WHERE id = $1`, [estimateId]);
    await audit(tx, counselor, "money.shared_estimate", e.patient_id, { estimateId });
    return e.patient_id;
  });
  await alertPatient(db, patientId, "billing_update", "Your cost estimate is ready.");
}

export async function deleteDraftEstimate(db: Db, counselor: Staff, estimateId: string) {
  requireCounselor(counselor);
  await asActor(db, counselor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`DELETE FROM finance_estimates WHERE id = $1 AND status = 'draft' RETURNING patient_id`, [estimateId]);
    if (!r.rows[0]) throw new HandoffError("Only drafts can be deleted.");
    await audit(tx, counselor, "money.deleted_draft", r.rows[0].patient_id, { estimateId });
  });
}

// ---------- counselor: coverage ----------

export interface CoverageInput {
  patientId: string; coverageId?: string; kind: string; payerName?: string; planName?: string; memberLast4?: string; fertilityBenefit?: string;
  lifetimeMax?: string; lifetimeUsed?: string; cyclesMax?: string; cyclesUsed?: string; deductible?: string; deductibleMet?: string;
  oopMax?: string; oopMet?: string; priorAuth?: string; endsOn?: string;
}
const optCents = (v?: string) => (clean(v) ? toCents(v!) : null);
const optInt = (v?: string) => { if (!clean(v)) return null; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new HandoffError("Cycles must be a whole number."); return n; };

export async function saveCoverage(db: Db, counselor: Staff, c: CoverageInput): Promise<{ id: string }> {
  requireCounselor(counselor);
  const kind = ["insurance", "employer_benefit", "self_pay"].includes(c.kind) ? c.kind : "insurance";
  const last4 = clean(c.memberLast4).slice(-4) || null;
  if (last4 && !/^[A-Za-z0-9]{1,4}$/.test(last4)) throw new HandoffError("Member id: enter only the last 4 letters or numbers.");
  const prior = ["none", "needed", "submitted", "approved", "denied"].includes(c.priorAuth ?? "") ? c.priorAuth : "none";
  if (c.endsOn && !isDate(c.endsOn)) throw new HandoffError("Choose the coverage end date.");
  const v = [clean(c.payerName) || null, clean(c.planName) || null, last4, clean(c.fertilityBenefit) || null,
    optCents(c.lifetimeMax), optCents(c.lifetimeUsed) ?? 0, optInt(c.cyclesMax), optInt(c.cyclesUsed) ?? 0,
    optCents(c.deductible), optCents(c.deductibleMet) ?? 0, optCents(c.oopMax), optCents(c.oopMet) ?? 0, prior, c.endsOn || null];
  if ((v[0] as string | null)?.length! > 120 || (v[1] as string | null)?.length! > 120) throw new HandoffError("Keep the plan names under 120 characters.");
  return asActor(db, counselor, async (tx) => {
    let id = c.coverageId;
    if (id) {
      const r = await tx.query(`UPDATE finance_coverage SET kind = $2, payer_name = $3, plan_name = $4, member_last4 = $5, fertility_benefit = $6, lifetime_max_cents = $7, lifetime_used_cents = $8,
          cycles_max = $9, cycles_used = $10, deductible_cents = $11, deductible_met_cents = $12, oop_max_cents = $13, oop_met_cents = $14, prior_auth = $15, ends_on = $16,
          updated_by_name = $17, updated_at = now() WHERE id = $1 AND patient_id = $18 RETURNING id`, [id, kind, ...v, counselor.name, c.patientId]);
      if (!r.rows[0]) throw new HandoffError("That coverage wasn't found.");
    } else {
      id = (await tx.query<{ id: string }>(`INSERT INTO finance_coverage (clinic_id, patient_id, kind, payer_name, plan_name, member_last4, fertility_benefit, lifetime_max_cents, lifetime_used_cents,
          cycles_max, cycles_used, deductible_cents, deductible_met_cents, oop_max_cents, oop_met_cents, prior_auth, ends_on, updated_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`, [counselor.clinicId, c.patientId, kind, ...v, counselor.name])).rows[0]!.id;
    }
    await audit(tx, counselor, "money.saved_coverage", c.patientId, { coverageId: id });
    return { id: id! };
  });
}

// ---------- counselor: charges and payments ----------

async function receiptNumber(tx: Tx, clinicId: string, on: string): Promise<string> {
  const n = (await tx.query<{ n: number }>(`SELECT count(*)::int + 1 AS n FROM finance_ledger WHERE clinic_id = $1 AND kind = 'payment' AND occurred_on = $2`, [clinicId, on])).rows[0]!.n;
  return `R-${on.replace(/-/g, "")}-${String(n).padStart(3, "0")}`;
}

export async function addLedgerEntry(db: Db, counselor: Staff, e: { patientId: string; kind: string; description: string; amount: string | number; occurredOn: string; dueOn?: string; method?: string }) {
  requireCounselor(counselor);
  if (!(e.kind in LEDGER_KINDS)) throw new HandoffError("Choose charge, payment, adjustment or refund.");
  const description = clean(e.description);
  if (!description || description.length > 160) throw new HandoffError("Add a short description.");
  const amount = toCents(e.amount);
  if (amount <= 0) throw new HandoffError("Enter an amount.");
  if (!isDate(e.occurredOn)) throw new HandoffError("Choose the date.");
  const dueOn = e.kind === "charge" && e.dueOn ? e.dueOn : null;
  if (dueOn && !isDate(dueOn)) throw new HandoffError("Choose the due date.");
  const method = e.kind === "payment" || e.kind === "refund" ? (e.method && e.method in PAY_METHODS ? e.method : "other") : null;
  const out = await asActor(db, counselor, async (tx) => {
    const receipt = e.kind === "payment" ? await receiptNumber(tx, counselor.clinicId, e.occurredOn) : null;
    const r = await tx.query<{ id: string }>(`INSERT INTO finance_ledger (clinic_id, patient_id, kind, description, amount_cents, occurred_on, due_on, method, receipt_number, created_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [counselor.clinicId, e.patientId, e.kind, description, amount, e.occurredOn, dueOn, method, receipt, counselor.name]);
    await audit(tx, counselor, "money.added_entry", e.patientId, { entryId: r.rows[0]!.id, kind: e.kind });
    return { id: r.rows[0]!.id, receipt };
  });
  if (e.kind === "payment") await alertPatient(db, e.patientId, "billing_update", "Your payment was recorded. Your receipt is in the app.");
  else if (e.kind === "charge") await alertPatient(db, e.patientId, "billing_update", "Your account was updated.");
  return out;
}

export async function voidLedgerEntry(db: Db, counselor: Staff, entryId: string) {
  requireCounselor(counselor);
  await asActor(db, counselor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE finance_ledger SET voided_at = now() WHERE id = $1 AND voided_at IS NULL RETURNING patient_id`, [entryId]);
    if (!r.rows[0]) throw new HandoffError("That entry was already removed.");
    await audit(tx, counselor, "money.voided_entry", r.rows[0].patient_id, { entryId });
  });
}

/** What goes on an HSA/FSA or tax receipt. Only for payments. */
export async function paymentReceipt(db: Db, actor: Actor, entryId: string) {
  return asActor(db, actor, async (tx) => {
    const r = (await tx.query<{ receipt_number: string | null; occurred_on: string; description: string; amount_cents: string; method: string | null; first_name: string; last_name: string; clinic: string; patient_id: string }>(
      `SELECT l.receipt_number, l.occurred_on::text, l.description, l.amount_cents, l.method, p.first_name, p.last_name, c.name AS clinic, p.id AS patient_id
         FROM finance_ledger l JOIN patients p ON p.id = l.patient_id JOIN clinics c ON c.id = l.clinic_id
        WHERE l.id = $1 AND l.kind = 'payment' AND l.voided_at IS NULL`, [entryId])).rows[0];
    if (!r) return null;
    return { receiptNumber: r.receipt_number ?? entryId.slice(0, 8).toUpperCase(), date: r.occurred_on, description: r.description, amountCents: Number(r.amount_cents),
      method: r.method ? PAY_METHODS[r.method as keyof typeof PAY_METHODS] : null, patientName: `${r.first_name} ${r.last_name}`, clinicName: r.clinic, patientId: r.patient_id };
  });
}

// ---------- financing options ----------

export async function financePartners(db: Db, actor: Actor, opts: { includeInactive?: boolean } = {}) {
  return asActor(db, actor, async (tx) => (await tx.query<{ id: string; kind: string; name: string; description: string; url: string | null; phone: string | null; active: boolean; sort_order: number }>(
    `SELECT id, kind, name, description, url, phone, active, sort_order FROM finance_partners WHERE active OR $1 ORDER BY sort_order, name`, [!!opts.includeInactive])).rows);
}

export async function savePartner(db: Db, staff: Staff, p: { id?: string; kind: string; name: string; description: string; url?: string; phone?: string; active?: boolean; sortOrder?: number }) {
  if (staff.role !== "financial_counselor" && staff.role !== "clinic_admin") throw new HandoffError("Only financial counselors and admins can change financing options.");
  const name = clean(p.name), description = clean(p.description), url = clean(p.url) || null, phone = clean(p.phone) || null;
  if (!name || name.length > 80) throw new HandoffError("Give the option a name.");
  if (!description || description.length > 400) throw new HandoffError("Add a short description (up to 400 characters).");
  if (url && !/^https:\/\/\S+$/.test(url)) throw new HandoffError("Links must start with https://");
  const kind = p.kind in PARTNER_KINDS ? p.kind : "other";
  return asActor(db, staff, async (tx) => {
    const id = p.id
      ? (await tx.query<{ id: string }>(`UPDATE finance_partners SET kind = $2, name = $3, description = $4, url = $5, phone = $6, active = $7, sort_order = $8, updated_by_name = $9, updated_at = now() WHERE id = $1 RETURNING id`,
          [p.id, kind, name, description, url, phone, p.active ?? true, p.sortOrder ?? 0, staff.name])).rows[0]?.id
      : (await tx.query<{ id: string }>(`INSERT INTO finance_partners (clinic_id, kind, name, description, url, phone, sort_order, updated_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [staff.clinicId, kind, name, description, url, phone, p.sortOrder ?? 0, staff.name])).rows[0]!.id;
    if (!id) throw new HandoffError("That option wasn't found.");
    await audit(tx, staff, "money.saved_partner", null, { partnerId: id });
    return { id };
  });
}

// ---------- questions about costs ----------

async function counselorIds(db: Db, clinicId: string): Promise<string[]> {
  return (await db.query<{ id: string }>(`SELECT id FROM app_users WHERE clinic_id = $1 AND role = 'financial_counselor' AND deactivated_at IS NULL`, [clinicId])).rows.map((r) => r.id);
}

export async function askAboutCosts(db: Db, patient: Actor, input: { patientId: string; question: string; estimateId?: string | null }) {
  const q = clean(input.question);
  if (!q) throw new HandoffError("Write your question.");
  if (q.length > 1000) throw new HandoffError("Keep it under 1,000 characters.");
  const name = await asActor(db, patient, async (tx) => {
    const p = (await tx.query<{ first_name: string; last_name: string }>(`SELECT first_name, last_name FROM patients WHERE id = $1`, [input.patientId])).rows[0];
    await tx.query(`INSERT INTO finance_questions (clinic_id, patient_id, estimate_id, question) VALUES ($1,$2,$3,$4)`, [patient.clinicId, input.patientId, input.estimateId || null, q]);
    await audit(tx, patient, "money.asked", input.patientId, {});
    return p ? `${p.first_name} ${p.last_name}` : "A patient";
  });
  const ids = await counselorIds(db, patient.clinicId);
  if (ids.length) await notify(db, { clinicId: patient.clinicId, kind: "billing_question", title: `${name} has a question about costs`, link: `/money/${input.patientId}`, to: { userIds: ids } });
  return { ok: true, counselors: ids.length };
}

export async function answerCostQuestion(db: Db, counselor: Staff, questionId: string, answer: string) {
  requireCounselor(counselor);
  const a = clean(answer);
  if (!a) throw new HandoffError("Write your answer.");
  if (a.length > 2000) throw new HandoffError("Keep it under 2,000 characters.");
  const patientId = await asActor(db, counselor, async (tx) => {
    const r = await tx.query<{ patient_id: string }>(`UPDATE finance_questions SET answer = $2, answered_by_name = $3, answered_at = now() WHERE id = $1 AND answer IS NULL RETURNING patient_id`, [questionId, a, counselor.name]);
    if (!r.rows[0]) throw new HandoffError("That question was already answered.");
    await audit(tx, counselor, "money.answered", r.rows[0].patient_id, { questionId });
    return r.rows[0].patient_id;
  });
  await alertPatient(db, patientId, "billing_update", `${counselor.name.split(" ")[0]} answered your question about costs.`);
}

export async function markCostAnswersRead(db: Db, patient: Actor, patientId: string) {
  await asActor(db, patient, (tx) => tx.query(`UPDATE finance_questions SET read_at = now() WHERE patient_id = $1 AND answer IS NOT NULL AND read_at IS NULL`, [patientId]));
}
