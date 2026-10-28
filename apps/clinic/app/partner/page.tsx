import { patientResults, patientToday } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default async function PartnerHome() {
  const s = await requireSession(["partner"]);
  if (!s.patientId) return <p>No one has shared anything with you yet.</p>;
  const db = await getDb();
  const [today, results] = await Promise.all([patientToday(db, s, s.patientId), patientResults(db, s, s.patientId)]);
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Supporting {today.firstName ?? "your partner"}</p>
      <h1>Hi {s.name.split(" ")[0]}.</h1>
      <p className="muted">You see what Maya chooses to share. Every view is recorded in Bayside&apos;s audit log.</p>
      <h2>Medications (shared)</h2>
      <div className="card">
        {today.doses.length === 0 && <div className="muted">Maya isn&apos;t sharing medications right now.</div>}
        {today.doses.map((d) => (
          <div className="row" key={d.id}><div><b>{d.medication}</b> <span className="muted">{fmt(d.scheduledFor)}</span></div>{d.takenAt ? <span className="pill p-sage">Done</span> : <span className="pill p-lav">Not logged</span>}</div>
        ))}
      </div>
      <h2>Results</h2>
      <div className="card">{results.length === 0 ? <span className="muted">Maya isn&apos;t sharing results right now.</span> : results.map((r) => <div key={r.id}>{r.analyte}</div>)}</div>
    </>
  );
}
