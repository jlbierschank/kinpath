import Link from "next/link";
import { financePartners, PARTNER_KINDS } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { savePartnerAction } from "../actions";

export default async function Partners({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["financial_counselor", "clinic_admin"]);
  const list = await financePartners(await getDb(), s, { includeInactive: true });
  const form = (p?: (typeof list)[number]) => (
    <form className="card" action={savePartnerAction} key={p?.id ?? "new"} data-testid={p ? "partner" : "new-partner"} style={p && !p.active ? { opacity: 0.6 } : undefined}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}><label>Name</label><input name="name" defaultValue={p?.name ?? ""} required aria-label="Name" /></div>
        <div><label>Kind</label><select name="kind" defaultValue={p?.kind ?? "loan"} aria-label="Kind">{Object.entries(PARTNER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label>Order</label><input name="sortOrder" defaultValue={p?.sort_order ?? 0} inputMode="numeric" style={{ width: 70 }} aria-label="Order" /></div>
      </div>
      <label>What patients should know</label><textarea name="description" rows={2} defaultValue={p?.description ?? ""} required aria-label="Description" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}><label>Link (https)</label><input name="url" defaultValue={p?.url ?? ""} aria-label="Link" /></div>
        <div><label>Phone</label><input name="phone" defaultValue={p?.phone ?? ""} aria-label="Phone" /></div>
        {p && <div><label>Show to patients</label><select name="active" defaultValue={p.active ? "yes" : "no"} aria-label="Show to patients"><option value="yes">Yes</option><option value="no">No</option></select></div>}
      </div>
      <div style={{ marginTop: 10 }}><button className="btn btn-line" type="submit">{p ? "Save" : "Add option"}</button></div>
    </form>
  );
  return (
    <>
      {s.role === "financial_counselor" && <p><Link href="/money">← Costs</Link></p>}
      <h1>Financing options</h1>
      <p className="muted" style={{ maxWidth: 720 }}>Loans, grants and discount programs Bayside wants patients to know about. Patients see active ones on their costs page. Check each partner&apos;s current terms on their own site before listing them.</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}
      {list.map((p) => form(p))}
      <h2>Add one</h2>
      {form()}
    </>
  );
}
