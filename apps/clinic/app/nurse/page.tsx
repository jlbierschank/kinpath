import Link from "next/link";
import { clinicPatients, nurseQueue, nurseTasks, thankYouNotes, IDS } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { enterResult } from "../actions";
import { completeTaskAction } from "./patients/actions";

const KIND: Record<string, [string, string]> = {
  crisis: ["Crisis: call now", "p-red"],
  urgent_symptom: ["Urgent symptom", "p-red"],
  missed_dose: ["Missed dose", "p-clay"],
  result_review: ["Result to review", "p-clay"],
  question: ["Question", "p-lav"],
};

const TASK: Record<string, [string, string]> = {
  wellbeing_call: ["Check-in call", "p-clay"],
  negative_followup: ["Follow-up after negative", "p-clay"],
  result_call: ["Result call", "p-lav"],
  next_steps: ["Ready for next steps", "p-lav"],
};
const STAGE: Record<string, string> = { stimulation: "Stimulation", wait: "Two-week wait", result: "Result released", graduated: "Graduated" };

export default async function NurseHome({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["nurse", "physician"]);
  const db = await getDb();
  const [queue, tasks, patients, thanks] = await Promise.all([nurseQueue(db, s), nurseTasks(db, s), clinicPatients(db, s), thankYouNotes(db, s)]);
  return (
    <>
      <p style={{ display: "flex", justifyContent: "flex-end", margin: 0 }}><Link href="/settings">Clinic settings →</Link></p>
      <h1>Good morning, {s.name.split(" ")[0]}.</h1>
      <p className="muted">{queue.length === 0 ? "Nothing needs you right now." : `${queue.length} ${queue.length === 1 ? "item needs" : "items need"} you. Urgent items stay on top.`}</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}
      <div className="grid">
        <div>
          {tasks.length > 0 && (
            <>
              <h2>Calls to make</h2>
              <div className="card">
                {tasks.map((t) => (
                  <form className="row" key={t.id} action={completeTaskAction} style={{ flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 240px" }}>
                      <b><Link href={`/nurse/patients/${t.patientId}`}>{t.patientName}</Link></b> <span className={`pill ${TASK[t.kind]![1]}`}>{TASK[t.kind]![0]}</span>
                      <div className="muted" style={{ fontSize: 13.5 }}>{t.reason}</div>
                    </div>
                    <input type="hidden" name="taskId" value={t.id} />
                    <div style={{ display: "flex", gap: 8, flex: "1 1 260px" }}>
                      <input name="note" placeholder="Note about the call" aria-label="Note about the call" required />
                      <button className="btn btn-line" type="submit">Done</button>
                    </div>
                  </form>
                ))}
              </div>
            </>
          )}
          <h2>Queue</h2>
          <div className="card">
            {queue.length === 0 && <div className="muted">All caught up.</div>}
            {queue.map((q) => (
              <div className="row" key={q.id}>
                <div>
                  <b>{q.patientName}</b> {q.preferredLang === "es" && <span className="pill p-lav">Español</span>}
                  <div className="muted" style={{ fontSize: 13.5 }}>{q.patientMessage}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={`pill ${KIND[q.kind]![1]}`}>{KIND[q.kind]![0]}</span>
                  <Link className="btn btn-line" href={`/nurse/${q.id}`}>Open</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          {thanks.length > 0 && (
            <>
              <h2>Thank-you notes</h2>
              {thanks.map((n) => (
                <div className="card" key={n.id} style={{ background: "var(--lav)", borderColor: "var(--lav)" }}>
                  <p style={{ margin: 0, fontStyle: "italic" }}>&ldquo;{n.body}&rdquo;</p>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{n.from} · {new Date(n.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                </div>
              ))}
            </>
          )}
          <h2>Patients</h2>
          <div className="card">
            {patients.map((p) => (
              <div className="row" key={p.id}><Link href={`/nurse/patients/${p.id}`}>{p.name}</Link><span className="muted" style={{ fontSize: 13 }}>{p.stage ? STAGE[p.stage] ?? p.stage : ""}</span></div>
            ))}
          </div>
          <h2>Enter a result (pilot)</h2>
          <form className="card" action={enterResult}>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Until the records-system connection is live, staff enter results here. Pumpkin labels them against Bayside&apos;s ranges; anything out of range comes back to the queue.</p>
            <input type="hidden" name="patientId" value={IDS.maya} />
            <label>Patient</label><input value="Maya Torres" disabled />
            <label htmlFor="analyte">Test</label>
            <select id="analyte" name="analyte" defaultValue="estradiol"><option value="estradiol">Estradiol</option><option value="progesterone">Progesterone</option></select>
            <label htmlFor="unit">Unit</label>
            <select id="unit" name="unit" defaultValue="pg/mL"><option>pg/mL</option><option>ng/mL</option><option>pmol/L</option></select>
            <label htmlFor="value">Value</label><input id="value" name="value" type="number" step="0.01" defaultValue="612" required />
            <label htmlFor="stimDay">Stimulation day</label><input id="stimDay" name="stimDay" type="number" defaultValue="6" required />
            <div style={{ marginTop: 12 }}><button className="btn btn-dark" type="submit">Save result</button></div>
          </form>
        </div>
      </div>
    </>
  );
}
