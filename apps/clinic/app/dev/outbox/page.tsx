import { notFound } from "next/navigation";
import { devOutbox } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { devLoginEnabled } from "@/lib/session";

/** Demo builds only: what would have been sent by push, text or email. */
export default async function Outbox() {
  if (!devLoginEnabled()) notFound();
  const rows = await devOutbox(await getDb(), 60);
  const STATUS: Record<string, [string, string]> = { send: ["Would send now", "p-sage"], held: ["Held for quiet hours", "p-lav"], digest: ["In the next summary", "p-lav"], sent: ["Sent", "p-sage"] };
  return (
    <>
      <h1>Dev outbox</h1>
      <p className="muted">Nothing is really sent yet. This is what would go out by push, text and email once a texting and an email service are connected (each with a signed HIPAA agreement). Sign-in codes show up here.</p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>When</th><th>To</th><th>How</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Empty.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid="outbox-row">
                <td style={{ whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</td>
                <td>{r.name ?? "Not set"}<br /><span className="muted" style={{ fontSize: 12.5 }}>{r.to_address}</span></td>
                <td>{r.channel === "sms" ? "Text" : r.channel === "email" ? "Email" : "Push"}</td>
                <td><b>{r.subject}</b><br />{r.body}</td>
                <td><span className={`pill ${STATUS[r.status]?.[1] ?? "p-lav"}`}>{STATUS[r.status]?.[0] ?? r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
