import Link from "next/link";
import { dollars, moneyPatients, recordsToReview } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { RecordRow } from "../record-row";

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export default async function Money({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["financial_counselor"]);
  const db = await getDb();
  const [people, review] = await Promise.all([moneyPatients(db, s), recordsToReview(db, s)]);
  const open = people.reduce((n, p) => n + p.openQuestions, 0);
  return (
    <>
      <p style={{ display: "flex", justifyContent: "flex-end", margin: 0 }}><Link href="/money/partners">Financing options →</Link></p>
      <h1>Costs</h1>
      <p className="muted">{open ? `${open} question${open === 1 ? "" : "s"} waiting for you.` : "No questions waiting."} Patients see what you share here in their app. Nurses don&apos;t see costs.</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}
      {review.length > 0 && (
        <>
          <h2 id="records">From the billing system</h2>
          <div className="card" data-testid="billing-review">{review.map((r) => <RecordRow key={r.id} r={r} patients={people} back="/money" />)}</div>
        </>
      )}
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Patient</th><th>Balance</th><th>Next due</th><th>Estimate</th><th>Coverage</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} data-testid="money-row">
                <td><b><Link href={`/money/${p.id}`}>{p.name}</Link></b>{p.openQuestions > 0 && <span className="pill p-clay" style={{ marginLeft: 6 }}>{p.openQuestions} question{p.openQuestions === 1 ? "" : "s"}</span>}<br /><span className="muted" style={{ fontSize: 12.5 }}>{p.mrn ?? "No MRN"}</span></td>
                <td>{p.balanceCents > 0 ? <b>{dollars(p.balanceCents)}</b> : p.balanceCents < 0 ? `${dollars(-p.balanceCents)} credit` : "$0"}</td>
                <td className="muted" style={{ fontSize: 13 }}>{day(p.nextDue)}</td>
                <td>{p.estimate === "shared" ? <span className="pill p-sage">Shared</span> : p.estimate === "draft" ? <span className="pill p-clay">Draft</span> : <span className="muted">None</span>}</td>
                <td className="muted" style={{ fontSize: 13 }}>{p.payer ?? "Not on file"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
