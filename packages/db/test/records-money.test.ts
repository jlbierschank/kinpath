import { beforeEach, describe, expect, it } from "vitest";
import { parseFinanceCsv, parseHl7 } from "@kinpath/core";
import { confirmRecord, IDS, importRecords, migrate, openDb, patientMoney, recordsToReview, seed, shareEstimate, type Db } from "../src";

const sam = { userId: IDS.sam, clinicId: IDS.bayside, role: "financial_counselor" as const, name: "Sam Kim" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };
const src = (format: "csv" | "hl7" = "csv") => ({ clinicId: IDS.bayside, keyId: null, format });

let db: Db;
beforeEach(async () => { db = await openDb(); await migrate(db); await seed(db, new Date()); });

const HEAD = "entry_id,mrn,last_name,type,description,amount,date,due_date,method,insurance_amount,category,estimate_id,estimate_title";

describe("billing from the clinic's billing system", () => {
  it("charges and payments update Maya's balance, and resending changes nothing", async () => {
    const csv = [HEAD, "c9,BF-100231,Torres,charge,Embryo storage,600,2026-10-20,2026-11-20,,,,,", "p9,BF-100231,Torres,payment,Card payment,600,2026-10-25,,card,,,,"].join("\n");
    const before = (await patientMoney(db, maya, IDS.maya)).balanceCents;
    expect(await importRecords(db, src(), parseFinanceCsv(csv))).toMatchObject({ billing: 2 });
    const m = await patientMoney(db, maya, IDS.maya);
    expect(m.balanceCents).toBe(before);
    expect(m.ledger.find((l) => l.description === "Card payment")).toMatchObject({ source: "records", receiptNumber: "p9", method: "card" });
    expect(await importRecords(db, src(), parseFinanceCsv(csv))).toMatchObject({ billing: 0, duplicates: 2 });
    const n = await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'billing_update'`, [IDS.mayaUser]);
    expect(n.rows.length).toBe(1);
  });

  it("an estimate arrives as a draft for Sam; Maya sees it only after he shares it", async () => {
    const csv = [HEAD, "e1,BF-100231,Torres,estimate,Transfer,3000,2026-10-26,,,2400,clinic,EST-FET,Frozen embryo transfer"].join("\n");
    expect(await importRecords(db, src(), parseFinanceCsv(csv))).toMatchObject({ estimatesWaiting: 1 });
    expect((await patientMoney(db, maya, IDS.maya)).estimates.map((e) => e.title)).toEqual(["IVF cycle with ICSI"]);
    const draft = (await patientMoney(db, sam, IDS.maya)).estimates.find((e) => e.status === "draft")!;
    expect(draft).toMatchObject({ title: "Frozen embryo transfer", source: "records", youPayCents: 60000 });
    const alerts = await db.query<{ user_id: string }>(`SELECT user_id FROM notifications WHERE kind = 'records_to_review'`);
    expect(alerts.rows.map((r) => r.user_id)).toEqual([IDS.sam]);
    await shareEstimate(db, sam, draft.id);
    expect((await patientMoney(db, maya, IDS.maya)).estimates.map((e) => e.title)).toEqual(["Frozen embryo transfer"]);
  });

  it("HL7 DFT and IN1 bring in charges and insurance", async () => {
    const in1 = (f: Record<number, string>) => ["IN1", ...Array.from({ length: 36 }, (_, i) => f[i + 1] ?? "")].join("|");
    const msg = ["MSH|^~\\&|PM|BAYSIDE|PUMPKIN|BAYSIDE|202610261000||DFT^P03|D1|P|2.5.1", "PID|1||BF-100231^^^BAYSIDE^MR||Torres^Maya",
      "FT1|1|TX-1||20261020||CG|LAB^Genetic testing||||900.00", in1({ 1: "1", 3: "NEWPLAN", 4: "New Example Insurer", 15: "HMO", 36: "AB12345678" })].join("\r");
    expect(await importRecords(db, src("hl7"), parseHl7(msg))).toMatchObject({ billing: 2 });
    const m = await patientMoney(db, maya, IDS.maya);
    expect(m.ledger.some((l) => l.description === "Genetic testing" && l.amountCents === 90000)).toBe(true);
    expect(m.coverage.find((c) => c.payerName === "New Example Insurer")).toMatchObject({ planName: "HMO", memberLast4: "5678", source: "records" });
  });

  it("an unmatched bill waits for Sam, not the nurses", async () => {
    const csv = [HEAD, "c10,BF-999999,Torres,charge,Monitoring,250,2026-10-20,,,,,,"].join("\n");
    expect(await importRecords(db, src(), parseFinanceCsv(csv))).toMatchObject({ toReview: 1 });
    expect(await recordsToReview(db, maria)).toHaveLength(0);
    const [item] = await recordsToReview(db, sam);
    expect(item).toMatchObject({ kind: "ledger", canConfirm: true });
    await confirmRecord(db, sam, item!.id, { patientId: IDS.maya });
    expect((await patientMoney(db, maya, IDS.maya)).ledger.some((l) => l.description === "Monitoring" && l.amountCents === 25000)).toBe(true);
    const clinicianAlerts = await db.query(`SELECT 1 FROM notifications n JOIN app_users u ON u.id = n.user_id WHERE n.kind = 'records_to_review' AND u.role IN ('nurse','physician')`);
    expect(clinicianAlerts.rows).toHaveLength(0);
  });
});
