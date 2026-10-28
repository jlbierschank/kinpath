import Link from "next/link";
import { notFound } from "next/navigation";
import { dollars, ESTIMATE_CATEGORIES, LEDGER_KINDS, moneyPatients, PAY_METHODS, patientMoney, type EstimateView } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { addEntryAction, answerAction, deleteDraftAction, saveCoverageAction, saveEstimateAction, shareEstimateAction, voidEntryAction } from "../actions";

const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not given");
const amt = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

function EstimateTable({ e }: { e: EstimateView }) {
  return (
    <table>
      <thead><tr><th>Item</th><th style={{ textAlign: "right" }}>Cost</th><th style={{ textAlign: "right" }}>Insurance (expected)</th><th style={{ textAlign: "right" }}>She pays</th></tr></thead>
      <tbody>
        {e.items.map((i) => <tr key={i.id}><td>{i.label}<div className="muted" style={{ fontSize: 12 }}>{ESTIMATE_CATEGORIES[i.category]}</div></td><td style={{ textAlign: "right" }}>{dollars(i.amountCents)}</td><td style={{ textAlign: "right" }}>{dollars(i.insuranceCents)}</td><td style={{ textAlign: "right" }}>{dollars(i.amountCents - i.insuranceCents)}</td></tr>)}
        <tr><td><b>Total</b></td><td style={{ textAlign: "right" }}><b>{dollars(e.totalCents)}</b></td><td style={{ textAlign: "right" }}><b>{dollars(e.insuranceCents)}</b></td><td style={{ textAlign: "right" }}><b data-testid="you-pay">{dollars(e.youPayCents)}</b></td></tr>
      </tbody>
    </table>
  );
}

export default async function PatientMoney({ params, searchParams }: { params: Promise<{ patientId: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { patientId } = await params;
  const sp = await searchParams;
  const s = await requireSession(["financial_counselor"]);
  const db = await getDb();
  const person = (await moneyPatients(db, s)).find((p) => p.id === patientId);
  if (!person) notFound();
  const m = await patientMoney(db, s, patientId);
  const shared = m.estimates.find((e) => e.status === "shared");
  const draft = m.estimates.find((e) => e.status === "draft");
  const start = draft ?? shared;
  const rows = Array.from({ length: 12 }, (_, i) => start?.items[i]);
  const cov = m.coverage.find((c) => c.active) ?? m.coverage[0];
  const first = person.name.split(" ")[0];
  return (
    <>
      <p><Link href="/money">← Costs</Link></p>
      <h1>{person.name}</h1>
      <p className="muted">{person.mrn ?? "No MRN"} · Balance <b data-testid="balance">{m.balanceCents > 0 ? dollars(m.balanceCents) : m.balanceCents < 0 ? `${dollars(-m.balanceCents)} credit` : "$0"}</b>{m.nextDue ? ` · ${dollars(m.nextDue.amountCents)} due ${day(m.nextDue.dueOn)}` : ""} · Paid so far {dollars(m.paidCents)}</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" data-testid="money-saved" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}

      {m.questions.length > 0 && (
        <>
          <h2 id="questions">Her questions</h2>
          <div className="card">
            {m.questions.map((q) => (
              <div className="row" key={q.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }} data-testid="cost-question">
                <div>&ldquo;{q.question}&rdquo; <span className="muted" style={{ fontSize: 12.5 }}>{new Date(q.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
                {q.answer ? <div className="muted" style={{ fontSize: 14 }}>{q.answeredBy}: {q.answer}</div> : (
                  <form action={answerAction} style={{ display: "flex", gap: 8 }}>
                    <input type="hidden" name="patientId" value={patientId} /><input type="hidden" name="questionId" value={q.id} />
                    <textarea name="answer" rows={2} required placeholder={`Answer ${first} in plain language`} aria-label="Your answer" />
                    <button className="btn btn-main" type="submit">Send</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="grid">
        <div>
          <h2 id="estimate">Estimate</h2>
          {shared && (
            <div className="card" data-testid="shared-estimate">
              <p style={{ marginTop: 0 }}><b>{shared.title}</b> <span className="pill p-sage">Shared {shared.sharedAt ? day(shared.sharedAt) : ""}</span>{shared.validUntil ? <span className="muted"> · good through {day(shared.validUntil)}</span> : null}</p>
              <EstimateTable e={shared} />
              {shared.note && <p className="muted" style={{ fontSize: 13.5 }}>{shared.note}</p>}
            </div>
          )}
          {draft && (
            <div className="card" style={{ borderColor: "var(--clay)" }}>
              <p style={{ marginTop: 0 }}><b>{draft.title}</b> <span className="pill p-clay">Draft{draft.source === "records" ? " from the billing system" : ""}</span> <span className="muted" style={{ fontSize: 13 }}>{first} can&apos;t see this yet.</span></p>
              <EstimateTable e={draft} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <form action={shareEstimateAction}><input type="hidden" name="patientId" value={patientId} /><input type="hidden" name="estimateId" value={draft.id} /><button className="btn btn-main" type="submit" data-testid="share-draft">Share with {first}</button></form>
                <form action={deleteDraftAction}><input type="hidden" name="patientId" value={patientId} /><input type="hidden" name="estimateId" value={draft.id} /><button className="linkbtn" type="submit">Delete draft</button></form>
              </div>
            </div>
          )}
          <details className="card" open={!shared && !draft}>
            <summary style={{ cursor: "pointer" }}><b>{draft ? "Edit the draft" : shared ? "Make a new estimate" : "Make an estimate"}</b> <span className="muted" style={{ fontSize: 13 }}>{shared && !draft ? "(starts from the shared one)" : ""}</span></summary>
            <form action={saveEstimateAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="patientId" value={patientId} />
              {draft && <input type="hidden" name="estimateId" value={draft.id} />}
              <label htmlFor="title">Title</label><input id="title" name="title" defaultValue={start?.title ?? "IVF cycle"} required />
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Item</th><th>Kind</th><th>Cost $</th><th>Insurance $</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><input name={`label${i}`} defaultValue={r?.label ?? ""} aria-label={`Line ${i + 1} item`} /></td>
                      <td><select name={`cat${i}`} defaultValue={r?.category ?? "clinic"} aria-label={`Line ${i + 1} kind`}>{Object.entries(ESTIMATE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                      <td><input name={`amt${i}`} defaultValue={r ? amt(r.amountCents) : ""} inputMode="decimal" style={{ width: 100 }} aria-label={`Line ${i + 1} cost`} /></td>
                      <td><input name={`ins${i}`} defaultValue={r ? amt(r.insuranceCents) : ""} inputMode="decimal" style={{ width: 100 }} aria-label={`Line ${i + 1} insurance`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label htmlFor="note">Note she&apos;ll read with it</label>
              <textarea id="note" name="note" rows={2} defaultValue={start?.note ?? "Insurance amounts are expected, not guaranteed."} />
              <label htmlFor="validUntil">Good through</label><input id="validUntil" name="validUntil" type="date" defaultValue={start?.validUntil ?? ""} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn btn-line" type="submit" name="share" value="no">Save draft</button>
                <button className="btn btn-main" type="submit" name="share" value="yes" data-testid="save-share">Save and share with {first}</button>
              </div>
            </form>
          </details>

          <h2 id="account">Charges and payments</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Date</th><th>What</th><th style={{ textAlign: "right" }}>Amount</th><th /></tr></thead>
              <tbody>
                {m.ledger.length === 0 && <tr><td colSpan={4} className="muted">Nothing yet.</td></tr>}
                {m.ledger.map((l) => (
                  <tr key={l.id} data-testid="ledger-row">
                    <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{day(l.occurredOn)}</td>
                    <td>{l.description}<div className="muted" style={{ fontSize: 12 }}>{LEDGER_KINDS[l.kind]}{l.dueOn ? ` · due ${day(l.dueOn)}` : ""}{l.receiptNumber ? ` · receipt ${l.receiptNumber}` : ""}{l.source === "records" ? " · from the billing system" : ""}</div></td>
                    <td style={{ textAlign: "right" }}>{l.kind === "charge" || l.kind === "refund" ? "" : "−"}{dollars(l.amountCents)}</td>
                    <td>{l.source === "staff" && <form action={voidEntryAction}><input type="hidden" name="patientId" value={patientId} /><input type="hidden" name="entryId" value={l.id} /><button className="linkbtn" type="submit">Remove</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="card" action={addEntryAction}>
            <input type="hidden" name="patientId" value={patientId} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div><label htmlFor="kind">Type</label><select id="kind" name="kind" defaultValue="payment">{Object.entries(LEDGER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div style={{ flex: 1, minWidth: 180 }}><label htmlFor="description">Description</label><input id="description" name="description" required placeholder="Balance payment" /></div>
              <div><label htmlFor="amount">Amount $</label><input id="amount" name="amount" inputMode="decimal" required style={{ width: 110 }} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div><label htmlFor="occurredOn">Date</label><input id="occurredOn" name="occurredOn" type="date" defaultValue={today()} required /></div>
              <div><label htmlFor="dueOn">Due (charges)</label><input id="dueOn" name="dueOn" type="date" /></div>
              <div><label htmlFor="method">Paid by (payments)</label><select id="method" name="method" defaultValue="card">{Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>Payments get a receipt number she can use for HSA, FSA or taxes. Pumpkin doesn&apos;t take payments; record ones made elsewhere.</p>
            <button className="btn btn-dark" type="submit" data-testid="add-entry">Add</button>
          </form>
        </div>

        <div>
          <h2 id="coverage">Coverage</h2>
          <form className="card" action={saveCoverageAction}>
            <input type="hidden" name="patientId" value={patientId} />
            {cov && <input type="hidden" name="coverageId" value={cov.id} />}
            {cov?.source === "records" && <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Plan details came from the billing system. Add the fertility benefit details below.</p>}
            <label htmlFor="ckind">Type</label>
            <select id="ckind" name="kind" defaultValue={cov?.kind ?? "insurance"}><option value="insurance">Insurance</option><option value="employer_benefit">Employer fertility benefit</option><option value="self_pay">Self-pay</option></select>
            <label htmlFor="payerName">Insurer or benefit</label><input id="payerName" name="payerName" defaultValue={cov?.payerName ?? ""} />
            <label htmlFor="planName">Plan</label><input id="planName" name="planName" defaultValue={cov?.planName ?? ""} />
            <label htmlFor="memberLast4">Member id (last 4 only)</label><input id="memberLast4" name="memberLast4" defaultValue={cov?.memberLast4 ?? ""} maxLength={4} />
            <label htmlFor="fertilityBenefit">What it covers, in plain words</label><textarea id="fertilityBenefit" name="fertilityBenefit" rows={3} defaultValue={cov?.fertilityBenefit ?? ""} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label htmlFor="lifetimeMax">Lifetime max $</label><input id="lifetimeMax" name="lifetimeMax" defaultValue={amt(cov?.lifetimeMaxCents ?? null)} inputMode="decimal" /></div>
              <div><label htmlFor="lifetimeUsed">Used $</label><input id="lifetimeUsed" name="lifetimeUsed" defaultValue={amt(cov?.lifetimeUsedCents ?? null)} inputMode="decimal" /></div>
              <div><label htmlFor="cyclesMax">Cycles covered</label><input id="cyclesMax" name="cyclesMax" defaultValue={cov?.cyclesMax ?? ""} inputMode="numeric" /></div>
              <div><label htmlFor="cyclesUsed">Cycles used</label><input id="cyclesUsed" name="cyclesUsed" defaultValue={cov?.cyclesUsed ?? ""} inputMode="numeric" /></div>
              <div><label htmlFor="deductible">Deductible $</label><input id="deductible" name="deductible" defaultValue={amt(cov?.deductibleCents ?? null)} inputMode="decimal" /></div>
              <div><label htmlFor="deductibleMet">Met $</label><input id="deductibleMet" name="deductibleMet" defaultValue={amt(cov?.deductibleMetCents ?? null)} inputMode="decimal" /></div>
              <div><label htmlFor="oopMax">Out-of-pocket max $</label><input id="oopMax" name="oopMax" defaultValue={amt(cov?.oopMaxCents ?? null)} inputMode="decimal" /></div>
              <div><label htmlFor="oopMet">Met $</label><input id="oopMet" name="oopMet" defaultValue={amt(cov?.oopMetCents ?? null)} inputMode="decimal" /></div>
            </div>
            <label htmlFor="priorAuth">Prior approval</label>
            <select id="priorAuth" name="priorAuth" defaultValue={cov?.priorAuth ?? "none"}><option value="none">Not needed</option><option value="needed">Needed</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="denied">Denied</option></select>
            <label htmlFor="endsOn">Coverage ends</label><input id="endsOn" name="endsOn" type="date" defaultValue={cov?.endsOn ?? ""} />
            <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit">Save coverage</button></div>
          </form>
        </div>
      </div>
    </>
  );
}
