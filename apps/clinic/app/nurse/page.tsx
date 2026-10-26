import Link from "next/link";
import { clinicPatients, nurseQueue, nurseTasks, recordsToReview, thankYouNotes, IDS, type RecordToReview } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { enterResult } from "../actions";
import { completeTaskAction } from "./patients/actions";
import { confirmRecordAction, dismissRecordAction } from "./records-actions";

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
  const [queue, tasks, patients, thanks, records] = await Promise.all([nurseQueue(db, s), nurseTasks(db, s), clinicPatients(db, s), thankYouNotes(db, s), recordsToReview(db, s)]);
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
          {records.length > 0 && (
            <>
              <h2 id="records">From the records system</h2>
              <div className="card" data-testid="records-review">
                {records.map((r) => <RecordRow key={r.id} r={r} patients={patients} />)}
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
          <h2>Enter a result by hand</h2>
          <form className="card" action={enterResult}>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Once the records connection is set up, results arrive on their own. Until then, or for an outside lab, enter one here. Pumpkin labels it against Bayside&apos;s ranges; anything out of range comes back to the queue.</p>
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

const RKIND: Record<RecordToReview["kind"], [string, string]> = {
  result: ["Lab result", "p-lav"],
  hcg: ["Pregnancy test (hCG)", "p-clay"],
  med_order: ["New medication order", "p-clay"],
  med_stop: ["Order stopped", "p-clay"],
};

function describe(r: RecordToReview): string {
  const d = r.data as Record<string, string | number | null>;
  const test: Record<string, string> = { estradiol: "Estradiol", progesterone: "Progesterone", lh: "LH", fsh: "FSH", hcg: "hCG" };
  if (r.kind === "result" || r.kind === "hcg") return `${test[String(d.analyte)] ?? d.analyte} ${d.value} ${d.unit} · collected ${new Date(String(d.collectedAt)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = (hm: string) => { const [h, m] = hm.split(":").map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`; };
  const when = d.startsOn ? (d.endsOn && d.endsOn !== d.startsOn ? `${day(String(d.startsOn))} to ${day(String(d.endsOn))}` : day(String(d.startsOn))) : "no dates";
  return `${d.medication ?? "Unnamed medication"} · ${d.dose ?? "no dose"} at ${d.timeOfDay ? time(String(d.timeOfDay)) : "no time"} · ${when}`;
}

function RecordRow({ r, patients }: { r: RecordToReview; patients: { id: string; name: string }[] }) {
  const first = r.patientName?.split(" ")[0] ?? "";
  const confirmLabel = r.kind === "med_order" ? `Add to ${first}'s schedule` : r.kind === "med_stop" ? "Cancel remaining doses"
    : r.kind === "hcg" ? `Add to ${first}'s test` : `Add to ${first}'s results`;
  const ok = r.kind === "med_order" ? `Added to ${first}'s schedule. She was told her schedule changed.` : r.kind === "med_stop" ? "Remaining doses canceled. She was told her schedule changed."
    : r.kind === "hcg" ? `hCG added to ${first}'s test. You decide the outcome on her page.` : "Result added.";
  const handledOnly = r.kind === "result" && /withdrew|different value/.test(r.reason);
  return (
    <div className="row" data-testid="record-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <b>{r.patientName ? <Link href={`/nurse/patients/${r.patientId}`}>{r.patientName}</Link> : `No match · MRN ${r.mrn ?? "missing"}`}</b>{" "}
          <span className={`pill ${RKIND[r.kind][1]}`}>{RKIND[r.kind][0]}</span>
          <div style={{ fontSize: 14 }}>{describe(r)}</div>
          <div className="muted" style={{ fontSize: 13 }}>{r.reason}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {handledOnly ? (
          <form action={dismissRecordAction}><input type="hidden" name="itemId" value={r.id} /><button className="btn btn-line" type="submit">Mark handled</button></form>
        ) : r.patientId && r.canConfirm && !/doesn.t match/.test(r.reason) ? (
          <form action={confirmRecordAction}>
            <input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="ok" value={ok} />
            <button className="btn btn-main" type="submit" data-testid="record-confirm">{confirmLabel}</button>
          </form>
        ) : r.canConfirm ? (
          <form action={confirmRecordAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="ok" value="Added to the patient you chose." />
            <select name="patientId" aria-label="Which patient is this?" required defaultValue={r.patientId ?? ""} style={{ minWidth: 180 }}>
              <option value="" disabled>Which patient is this?</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn btn-line" type="submit" data-testid="record-place">Add to this patient</button>
          </form>
        ) : null}
        {!handledOnly && <form action={dismissRecordAction}><input type="hidden" name="itemId" value={r.id} /><button className="linkbtn" type="submit">Dismiss</button></form>}
      </div>
    </div>
  );
}
