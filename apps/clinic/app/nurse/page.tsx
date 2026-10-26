import Link from "next/link";
import { nurseQueue, IDS } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { enterResult } from "../actions";

const KIND: Record<string, [string, string]> = {
  crisis: ["Crisis: call now", "p-red"],
  urgent_symptom: ["Urgent symptom", "p-red"],
  missed_dose: ["Missed dose", "p-clay"],
  result_review: ["Result to review", "p-clay"],
  question: ["Question", "p-lav"],
};

export default async function NurseHome() {
  const s = await requireSession(["nurse", "physician"]);
  const queue = await nurseQueue(await getDb(), s);
  return (
    <>
      <p style={{ display: "flex", justifyContent: "flex-end", margin: 0 }}><Link href="/settings">Clinic settings →</Link></p>
      <h1>Good morning, {s.name.split(" ")[0]}.</h1>
      <p className="muted">{queue.length === 0 ? "Nothing needs you right now." : `${queue.length} ${queue.length === 1 ? "item needs" : "items need"} you. Urgent items stay on top.`}</p>
      <div className="grid">
        <div>
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
          <h2>Enter a result (pilot)</h2>
          <form className="card" action={enterResult}>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Until the records-system connection is live, staff enter results here. Kinpath labels them against Bayside&apos;s ranges; anything out of range comes back to the queue.</p>
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
