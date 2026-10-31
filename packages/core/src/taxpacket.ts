/**
 * The year-end packet: what she paid toward care in a year, grouped so it's easy to hand to a tax
 * preparer or an HSA/FSA administrator. Pumpkin groups and totals; it never says what qualifies.
 */
export type CostCategory = "medication" | "tests_monitoring" | "procedure" | "consult_visit" | "storage" | "donor" | "travel" | "other";

export const CATEGORY_LABEL: Record<CostCategory, string> = {
  medication: "Medications and pharmacy",
  tests_monitoring: "Tests and monitoring",
  procedure: "Procedures",
  consult_visit: "Visits and consults",
  storage: "Storage",
  donor: "Donor and agency",
  travel: "Travel",
  other: "Other",
};
export const CATEGORY_ORDER: CostCategory[] = ["procedure", "medication", "tests_monitoring", "consult_visit", "storage", "donor", "travel", "other"];

const RULES: [CostCategory, RegExp][] = [
  ["storage", /\b(storage|cryo ?storage|annual (embryo|egg|sperm) fee|long[- ]term storage)\b/i],
  ["donor", /\b(donor|surrogac|gestational carrier|agency|matching fee)\b/i],
  ["travel", /\b(flight|airfare|hotel|lodging|mileage|parking|uber|lyft|taxi|train)\b/i],
  ["medication", /\b(pharmacy|specialty pharmacy|medication|meds?|rx|prescription|gonal|follistim|menopur|ganirelix|cetrotide|leuprolide|lupron|progesterone|estradiol|ovidrel|novarel|pregnyl|letrozole|clomi|copay card)\b/i],
  ["tests_monitoring", /\b(ultrasound|monitoring|blood ?work|bloodwork|lab|labs|test|testing|panel|screen(ing)?|semen analysis|hsg|sonohysterogram|amh|beta|hcg|pgt|genetic)\b/i],
  ["procedure", /\b(retrieval|transfer|fet|ivf|iui|icsi|insemination|cycle fee|embryology|anesthesia|freeze|freezing|vitrification|biopsy|hysteroscopy|surgery|procedure)\b/i],
  ["consult_visit", /\b(consult|consultation|visit|appointment|office|new patient|follow[- ]up|telehealth|counsel(l)?ing)\b/i],
];

/** A best guess from the description. She can see the line it came from in the packet. */
export function costCategory(description: string): CostCategory {
  for (const [cat, re] of RULES) if (re.test(description)) return cat;
  return "other";
}

export interface PacketPayment { id: string; description: string; amountCents: number; paidOn: string; method: string | null; captureId: string | null; category: CostCategory }
export interface PacketGroup { category: CostCategory; label: string; totalCents: number; payments: PacketPayment[] }
export function groupPayments(payments: PacketPayment[]): { groups: PacketGroup[]; totalCents: number } {
  const groups = CATEGORY_ORDER.map((category) => {
    const ps = payments.filter((p) => p.category === category).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
    return { category, label: CATEGORY_LABEL[category], totalCents: ps.reduce((s, p) => s + p.amountCents, 0), payments: ps };
  }).filter((g) => g.payments.length);
  return { groups, totalCents: groups.reduce((s, g) => s + g.totalCents, 0) };
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  // Quote everything; neutralize spreadsheet formulas.
  return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};
export function packetCsv(payments: PacketPayment[]): string {
  const rows = [["Date paid", "Description", "Group", "Amount (USD)", "Paid by", "Receipt attached"]];
  for (const p of [...payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn)))
    rows.push([p.paidOn, p.description, CATEGORY_LABEL[p.category], (p.amountCents / 100).toFixed(2), p.method ?? "", p.captureId ? "yes" : "no"]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const PACKET_NOTE = "This lists payments you recorded in Pumpkin. It isn't tax advice. Your tax preparer or HSA/FSA administrator decides what qualifies. IRS Publication 502 describes medical and dental expenses.";
