import { beforeEach, describe, expect, it } from "vitest";
import {
  addLedgerEntry, answerCostQuestion, askAboutCosts, financePartners, IDS, markCostAnswersRead, migrate, moneyPatients, openDb, patientMoney,
  paymentReceipt, saveCoverage, saveEstimate, savePartner, seed, setPartnerSharing, shareEstimate, toCents, voidLedgerEntry, type Db,
} from "../src";

const sam = { userId: IDS.sam, clinicId: IDS.bayside, role: "financial_counselor" as const, name: "Sam Kim" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const, name: "Kara Diaz" };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const jordan = { userId: IDS.jordan, clinicId: IDS.bayside, role: "partner" as const };
const lee = { userId: IDS.harborNurse, clinicId: IDS.harbor, role: "nurse" as const, name: "Lee" };

let db: Db;
beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });
// The demo data's dates follow the seed's anchor (it moves a day ahead in the evening), so read the due date back.
const dueOf = async () => (await db.query<{ d: string }>(`SELECT due_on::text AS d FROM finance_ledger WHERE description LIKE 'Cycle balance%'`)).rows[0]!.d;
const ymd = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); };

describe("what Maya sees", () => {
  it("her estimate with insurance and her share, her coverage, what's paid and what's due", async () => {
    const m = await patientMoney(db, maya, IDS.maya);
    expect(m.estimates).toHaveLength(1);
    expect(m.estimates[0]).toMatchObject({ title: "IVF cycle with ICSI", status: "shared", totalCents: 2070000, insuranceCents: 1608000, youPayCents: 462000 });
    expect(m.coverage[0]).toMatchObject({ payerName: "Example Health Plan", memberLast4: "4417", lifetimeMaxCents: 2500000, lifetimeUsedCents: 840000, cyclesMax: 2, priorAuth: "approved" });
    expect(m.balanceCents).toBe(179000);
    expect(m.paidCents).toBe(179000);
    expect(m.nextDue).toEqual({ dueOn: await dueOf(), amountCents: 179000 });
    expect(m.partners.map((p) => p.kind)).toEqual(["discount", "loan", "grant"]);
  });
});

describe("who sees money", () => {
  it("nurses, admins and other clinics see none of it", async () => {
    for (const who of [maria, kara]) {
      const m = await patientMoney(db, who, IDS.maya);
      expect(m.estimates.length + m.coverage.length + m.ledger.length + m.questions.length).toBe(0);
    }
    const h = await patientMoney(db, lee, IDS.maya);
    expect(h.estimates.length + h.ledger.length + h.partners.length).toBe(0);
  });

  it("Jordan sees it only if Maya shares money, and never her questions", async () => {
    let j = await patientMoney(db, jordan, IDS.maya);
    expect(j.estimates.length + j.coverage.length + j.ledger.length).toBe(0);
    await askAboutCosts(db, maya, { patientId: IDS.maya, question: "Is the storage fee yearly?" });
    await setPartnerSharing(db, maya, IDS.maya, IDS.jordan, ["schedule", "meds", "money"]);
    j = await patientMoney(db, jordan, IDS.maya);
    expect(j.balanceCents).toBe(179000);
    expect(j.estimates).toHaveLength(1);
    expect(j.questions).toHaveLength(0);
  });
});

describe("Sam, the financial counselor", () => {
  it("sees every patient's balance and open questions", async () => {
    await askAboutCosts(db, maya, { patientId: IDS.maya, question: "Can I split the balance?" });
    const list = await moneyPatients(db, sam);
    expect(list[0]).toMatchObject({ name: "Maya Torres", balanceCents: 179000, estimate: "shared", payer: "Example Health Plan", openQuestions: 1, nextDue: await dueOf() });
    await expect(moneyPatients(db, maria)).rejects.toThrow(/financial counselors/);
  });

  it("drafts stay hidden until shared; sharing replaces the old estimate and tells her", async () => {
    const { id } = await saveEstimate(db, sam, { patientId: IDS.maya, title: "Frozen embryo transfer", items: [
      { label: "Transfer", category: "clinic", amount: "3,000", insurance: "2400" }, { label: "Medications", category: "medications", amount: 450.5 }] });
    expect((await patientMoney(db, maya, IDS.maya)).estimates.map((e) => e.title)).toEqual(["IVF cycle with ICSI"]);
    expect((await patientMoney(db, sam, IDS.maya)).estimates.map((e) => e.status)).toEqual(["draft", "shared"]);
    await shareEstimate(db, sam, id);
    const m = await patientMoney(db, maya, IDS.maya);
    expect(m.estimates).toHaveLength(1);
    expect(m.estimates[0]).toMatchObject({ title: "Frozen embryo transfer", totalCents: 345050, insuranceCents: 240000, youPayCents: 105050 });
    const n = await db.query<{ title: string }>(`SELECT title FROM notifications WHERE user_id = $1 AND kind = 'billing_update'`, [IDS.mayaUser]);
    expect(n.rows.map((r) => r.title)).toContain("Your cost estimate is ready.");
  });

  it("refuses estimate lines where insurance pays more than the line, and non-counselors", async () => {
    await expect(saveEstimate(db, sam, { patientId: IDS.maya, title: "X", items: [{ label: "A", category: "clinic", amount: 100, insurance: 200 }] })).rejects.toThrow(/can't cover more/);
    await expect(saveEstimate(db, maria, { patientId: IDS.maya, title: "X", items: [{ label: "A", category: "clinic", amount: 100 }] })).rejects.toThrow(/financial counselors/);
  });

  it("records a payment with a receipt for HSA, FSA or taxes", async () => {
    const r = await addLedgerEntry(db, sam, { patientId: IDS.maya, kind: "payment", description: "Balance payment", amount: "1,790.00", occurredOn: ymd(), method: "card" });
    expect(r.receipt).toMatch(new RegExp(`^R-${ymd().replace(/-/g, "")}-001$`));
    const m = await patientMoney(db, maya, IDS.maya);
    expect(m.balanceCents).toBe(0);
    expect(m.nextDue).toBeNull();
    const receipt = await paymentReceipt(db, maya, r.id);
    expect(receipt).toMatchObject({ clinicName: "Bayside Fertility", patientName: "Maya Torres", amountCents: 179000, method: "Card", description: "Balance payment" });
    expect(await paymentReceipt(db, jordan, r.id)).toBeNull(); // not shared with him
    await voidLedgerEntry(db, sam, r.id);
    expect((await patientMoney(db, maya, IDS.maya)).balanceCents).toBe(179000);
  });

  it("updates coverage, keeping only the last 4 of the member id", async () => {
    const cov = (await patientMoney(db, sam, IDS.maya)).coverage[0]!;
    await saveCoverage(db, sam, { patientId: IDS.maya, coverageId: cov.id, kind: "insurance", payerName: "Example Health Plan", memberLast4: "XJ9928417", lifetimeMax: "25,000", lifetimeUsed: "12,000", cyclesMax: "2", cyclesUsed: "1", priorAuth: "approved" });
    expect((await patientMoney(db, maya, IDS.maya)).coverage[0]).toMatchObject({ memberLast4: "8417", lifetimeUsedCents: 1200000, cyclesUsed: 1 });
  });
});

describe("questions about costs go to Sam, not the nurses", () => {
  it("Maya asks, Sam is alerted, Sam answers, Maya reads it", async () => {
    const est = (await patientMoney(db, maya, IDS.maya)).estimates[0]!;
    await askAboutCosts(db, maya, { patientId: IDS.maya, question: "Is the storage fee yearly?", estimateId: est.id });
    const alerts = await db.query<{ user_id: string }>(`SELECT user_id FROM notifications WHERE kind = 'billing_question'`);
    expect(alerts.rows.map((r) => r.user_id)).toEqual([IDS.sam]);
    const q = (await patientMoney(db, sam, IDS.maya)).questions[0]!;
    await answerCostQuestion(db, sam, q.id, "Yes, it renews each year. We'll remind you a month before.");
    let mine = (await patientMoney(db, maya, IDS.maya)).questions[0]!;
    expect(mine).toMatchObject({ answer: "Yes, it renews each year. We'll remind you a month before.", answeredBy: "Sam Kim", read: false });
    await markCostAnswersRead(db, maya, IDS.maya);
    mine = (await patientMoney(db, maya, IDS.maya)).questions[0]!;
    expect(mine.read).toBe(true);
    await expect(answerCostQuestion(db, sam, q.id, "again")).rejects.toThrow(/already answered/);
  });
});

describe("financing options", () => {
  it("counselors and admins manage them; links must be https", async () => {
    await savePartner(db, kara, { kind: "grant", name: "Local grant (demo)", description: "Help for local families." });
    await expect(savePartner(db, sam, { kind: "loan", name: "X", description: "Y", url: "http://insecure.example" })).rejects.toThrow(/https/);
    await expect(savePartner(db, maria, { kind: "loan", name: "X", description: "Y" })).rejects.toThrow(/financial counselors and admins/);
    expect((await financePartners(db, maya)).map((p) => p.name)).toContain("Local grant (demo)");
  });
});

it("reads amounts the way people type them", () => {
  expect(toCents("$1,234.50")).toBe(123450);
  expect(toCents(19.999)).toBe(2000);
  expect(() => toCents("abc")).toThrow();
});
