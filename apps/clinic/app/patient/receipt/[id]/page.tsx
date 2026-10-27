import { notFound } from "next/navigation";
import { dollars, paymentReceipt } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PrintButton } from "../../../summary/[token]/print";

export const metadata = { title: "Payment receipt" };

/** A payment receipt she can print or save as a PDF for an HSA, FSA or taxes. */
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(["patient"]);
  const r = await paymentReceipt(await getDb(), s, id);
  if (!r) notFound();
  return (
    <div style={{ maxWidth: 560 }}>
      <p className="muted" style={{ margin: 0 }}>{r.clinicName}</p>
      <h1>Payment receipt</h1>
      <div className="card" data-testid="receipt">
        <table>
          <tbody>
            <tr><td>Receipt number</td><td><b>{r.receiptNumber}</b></td></tr>
            <tr><td>Patient</td><td>{r.patientName}</td></tr>
            <tr><td>Date paid</td><td>{new Date(`${r.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</td></tr>
            <tr><td>For</td><td>{r.description}</td></tr>
            <tr><td>Amount</td><td><b>{dollars(r.amountCents)}</b></td></tr>
            {r.method && <tr><td>Paid by</td><td>{r.method}</td></tr>}
            <tr><td>Paid to</td><td>{r.clinicName}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>For your HSA, FSA or tax records. Ask Bayside&apos;s billing office if your plan needs an itemized statement.</p>
      <PrintButton />
    </div>
  );
}
