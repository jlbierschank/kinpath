import Link from "next/link";
import { APPOINTMENT_KINDS, clinicAppointments, CYCLE_KINDS, patientDirectory } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { addPatientAction, bookAction, cancelAppointmentAction, startCycleAction, updatePatientAction } from "./actions";

const STAGE: Record<string, string> = { stimulation: "Stimulation", wait: "Two-week wait", result: "Result released", graduated: "Graduated" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const showContact = (c: string) => (c.includes("@") ? c : c.replace(/^(\+?1)?(\d{3})(\d{3})(\d{4})$/, "($2) $3-$4"));

export default async function Patients({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["nurse", "physician", "scheduler"]);
  const clinician = s.role === "nurse" || s.role === "physician";
  const db = await getDb();
  const [people, visits] = await Promise.all([patientDirectory(db, s), clinicAppointments(db, s)]);
  return (
    <>
      <h1>Patients</h1>
      <p className="muted">Everyone at Bayside using Pumpkin. Adding someone sends her a welcome with how to sign in, with no health details.</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" data-testid="patients-saved" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}
      <div className="grid">
        <div>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Patient</th><th>MRN</th><th>Stage</th><th>Next visit</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} data-testid="patient-row">
                    <td>
                      <b>{clinician ? <Link href={`/nurse/patients/${p.id}`}>{p.name}</Link> : p.name}</b>{p.lang === "es" && <span className="pill p-lav" style={{ marginLeft: 6 }}>Español</span>}
                      <details style={{ marginTop: 4 }}>
                        <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>Edit details</summary>
                        <form action={updatePatientAction} style={{ marginTop: 6 }}>
                          <input type="hidden" name="patientId" value={p.id} />
                          <label htmlFor={`mrn-${p.id}`}>Medical record number</label><input id={`mrn-${p.id}`} name="mrn" defaultValue={p.mrn ?? ""} />
                          <label htmlFor={`c-${p.id}`}>Signs in with</label><input id={`c-${p.id}`} name="contact" defaultValue={showContact(p.contact)} />
                          <label htmlFor={`l-${p.id}`}>Language</label>
                          <select id={`l-${p.id}`} name="lang" defaultValue={p.lang}><option value="en">English</option><option value="es">Spanish</option></select>
                          <div style={{ marginTop: 8 }}><button className="btn btn-line" type="submit">Save</button></div>
                        </form>
                        {clinician && (
                          <form action={startCycleAction} style={{ marginTop: 10 }}>
                            <input type="hidden" name="patientId" value={p.id} />
                            <label htmlFor={`k-${p.id}`}>Start a new cycle</label>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <select id={`k-${p.id}`} name="cycleKind" defaultValue="ivf" style={{ minWidth: 140 }}>{Object.entries(CYCLE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                              <input name="startedOn" type="date" defaultValue={today()} aria-label="Start date" style={{ width: "auto" }} />
                              <button className="btn btn-line" type="submit">Start</button>
                            </div>
                          </form>
                        )}
                      </details>
                    </td>
                    <td><code>{p.mrn ?? "—"}</code></td>
                    <td className="muted" style={{ fontSize: 13 }}>{p.stage ? `${STAGE[p.stage] ?? p.stage}${p.cycleKind ? ` · ${CYCLE_KINDS[p.cycleKind as keyof typeof CYCLE_KINDS] ?? p.cycleKind}` : ""}` : "No cycle yet"}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{p.nextVisit ? when(p.nextVisit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 id="appointments">Next two weeks</h2>
          <div className="card">
            {visits.length === 0 && <div className="muted">No visits booked.</div>}
            {visits.map((v) => (
              <div className="row" key={v.id} data-testid="visit-row">
                <div><b>{when(v.startsAt)}</b> · {v.patientName}<div className="muted" style={{ fontSize: 13 }}>{v.title}{v.location ? ` · ${v.location}` : ""}{v.source === "records" ? " · from the records system" : ""}</div></div>
                <form action={cancelAppointmentAction}><input type="hidden" name="appointmentId" value={v.id} /><button className="linkbtn" type="submit">Cancel</button></form>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>Add a patient</h2>
          <form className="card" action={addPatientAction}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" required /></div>
              <div style={{ flex: 1 }}><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" required /></div>
            </div>
            <label htmlFor="mrn">Medical record number</label>
            <input id="mrn" name="mrn" placeholder="BF-100300" />
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>Needed for results and appointments to arrive from the records system.</p>
            <label htmlFor="contact">Mobile number or email</label>
            <input id="contact" name="contact" required placeholder="(813) 555-0199" />
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>She signs in with this. No password.</p>
            <label htmlFor="lang">Language</label>
            <select id="lang" name="lang" defaultValue="en"><option value="en">English</option><option value="es">Spanish</option></select>
            {clinician && (
              <>
                <label htmlFor="cycleKind">Cycle <span className="muted">(optional)</span></label>
                <div style={{ display: "flex", gap: 6 }}>
                  <select id="cycleKind" name="cycleKind" defaultValue=""><option value="">Not yet</option>{Object.entries(CYCLE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <input name="startedOn" type="date" defaultValue={today()} aria-label="Cycle start date" style={{ width: "auto" }} />
                </div>
              </>
            )}
            <div style={{ marginTop: 12 }}><button className="btn btn-main" type="submit" data-testid="add-patient">Add patient</button></div>
          </form>

          <h2>Book a visit</h2>
          <form className="card" action={bookAction}>
            <label htmlFor="bp">Patient</label>
            <select id="bp" name="patientId" required defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</select>
            <label htmlFor="bk">Kind of visit</label>
            <select id="bk" name="kind" defaultValue="monitoring">{Object.entries(APPOINTMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <label htmlFor="bt">Date and time</label>
            <input id="bt" name="startsAt" type="datetime-local" required />
            <label htmlFor="bl">Where <span className="muted">(optional)</span></label>
            <input id="bl" name="location" placeholder="Bayside Tampa, 2nd floor" />
            <label htmlFor="bti">What she&apos;ll see <span className="muted">(optional)</span></label>
            <input id="bti" name="title" placeholder="Monitoring visit: ultrasound and blood work" maxLength={120} />
            <div style={{ marginTop: 12 }}><button className="btn btn-dark" type="submit" data-testid="book">Book</button></div>
          </form>
        </div>
      </div>
    </>
  );
}
