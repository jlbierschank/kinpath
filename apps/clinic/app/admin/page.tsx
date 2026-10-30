import Link from "next/link";
import { auditLog } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

export default async function AdminHome() {
  const s = await requireSession(["clinic_admin"]);
  const rows = await auditLog(await getDb(), s, 100);
  return (
    <>
      <p style={{ display: "flex", justifyContent: "flex-end", margin: 0 }}><Link href="/pilot" style={{ marginRight: 16 }}>Pilot numbers →</Link><Link href="/settings">Clinic settings (view only) →</Link></p>
      <h1>Audit log</h1>
      <p className="muted">Every view and change at Bayside. It can be read here but never edited or deleted. Admins see this log, not clinical records.</p>
      <div className="card">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="muted">Nothing yet. Sign in as Maya or Maria and try the loop.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleString("en-US")}</td><td>{r.actor}</td><td>{r.action.replace(/[._]/g, " ")}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
