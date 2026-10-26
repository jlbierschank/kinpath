import { fhirSource } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { baseUrl, requireSession } from "@/lib/session";

export const metadata = { title: "Pumpkin records connection: setup guide" };

/** A one-page guide for the clinic's IT team or interface analyst, with this clinic's addresses filled in. */
export default async function Guide() {
  const s = await requireSession(["clinic_admin"]);
  const base = await baseUrl();
  const fhir = await fhirSource(await getDb(), s);
  const code = (t: string) => <code style={{ wordBreak: "break-all" }}>{t}</code>;
  return (
    <div style={{ maxWidth: 820 }} className="guide">
      <p className="muted" style={{ margin: 0 }}>Bayside Fertility · Pumpkin</p>
      <h1>Connecting your records system to Pumpkin</h1>
      <p>Pumpkin is the patient app Bayside uses for treatment support. It needs lab results, medication orders and appointments for Bayside&apos;s fertility patients. There are three ways to send them. Pick whichever your records system supports; all three go through the same checks.</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What Pumpkin needs, and what it does with it</h2>
        <ul>
          <li><b>Patients are matched by medical record number (MRN)</b> and, when present, last name. Records that don&apos;t match one patient go to a nurse; nothing is guessed.</li>
          <li><b>Lab results:</b> estradiol (LOINC 2243-4), progesterone (2839-9), LH (10501-5), FSH (15067-2), hCG (21198-7 or 19080-1). Final and corrected results only. Units aren&apos;t converted.</li>
          <li><b>Medication orders</b> wait for a nurse to confirm before the patient sees them.</li>
          <li><b>Appointments</b> appear in the patient&apos;s app (booked, rescheduled, canceled).</li>
          <li>Each record needs a stable id. <b>Re-sending the same record is safe</b>; it won&apos;t be duplicated.</li>
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Option 1: Your system sends to Pumpkin (push)</h2>
        <p>Address: {code(`${base}/api/integrations/records`)} · Method: <b>POST</b> over HTTPS · Header: {code("Authorization: Bearer <key>")}</p>
        <p>Bayside&apos;s Pumpkin admin creates the key on the Records connection page and gives it to you securely. It&apos;s shown once.</p>
        <table>
          <thead><tr><th>Format</th><th>Content-Type</th><th>What to send</th></tr></thead>
          <tbody>
            <tr><td>HL7 v2 (2.3 to 2.5.1)</td><td>{code("x-application/hl7-v2+er7")}</td><td>ORU^R01 results (PID-3 with MR type, OBX-3 LOINC with LN, OBX-11 F or C); RDE^O11 orders (ORC-1 NW/DC/CA, RXE, TQ1); SIU^S12–S17 appointments (SCH, AIS-4). Reply: HL7 ACK (MSA AA/AE). One or many messages per request.</td></tr>
            <tr><td>FHIR R4</td><td>{code("application/fhir+json")}</td><td>A Bundle with Patient (MRN identifier, name), Observation, MedicationRequest and Appointment resources.</td></tr>
            <tr><td>CSV (results only)</td><td>{code("text/csv")}</td><td>Columns: result_id, mrn, last_name, test, value, unit, collected_at</td></tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>Most interface engines can deliver HL7 v2 over HTTPS this way. If yours only speaks MLLP, put a small HTTPS forwarder in front of it. Limit: 2,000 records or 5 MB per request.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Option 2: Pumpkin reads from your FHIR API (pull)</h2>
        <p>Pumpkin signs in with <b>SMART Backend Services</b> (client credentials with a signed JWT, RS384) and checks every 15 minutes for:</p>
        <ul>
          <li>{code("Patient?identifier=<MRN>")} (once per patient)</li>
          <li>{code("Observation?patient=…&category=laboratory&_lastUpdated=gt…")}</li>
          <li>{code("MedicationRequest?patient=…&_lastUpdated=gt…")} and {code("Appointment?patient=…&date=ge<today>")}</li>
        </ul>
        <p>To register Pumpkin as a backend service, use:</p>
        <ul>
          <li><b>JWK Set URL:</b> {fhir ? code(`${base}/api/integrations/jwks/${s.clinicId}`) : <i>available after the admin clicks &ldquo;Set up&rdquo; on the Records connection page</i>}</li>
          <li><b>Scopes:</b> {code(fhir?.scope ?? "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Appointment.rs")} (or the read equivalents your server uses)</li>
        </ul>
        <p style={{ marginBottom: 0 }}>Send back: the FHIR base URL, the client id, and, if needed, the token URL and the identifier system your Patient resources use for MRNs.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Option 3: Upload an export</h2>
        <p style={{ marginBottom: 0 }}>Until a live connection is ready, Bayside staff can upload a results export (CSV, FHIR Bundle .json, or HL7 .hl7/.txt) on the Records connection page.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Security</h2>
        <ul style={{ marginBottom: 0 }}>
          <li>HTTPS only. Keys are stored hashed; Pumpkin&apos;s private signing key is stored encrypted.</li>
          <li>Replies contain counts only, never patient details. Every import is logged.</li>
          <li>Each key and each FHIR connection belongs to one clinic and can only reach that clinic&apos;s patients.</li>
          <li>A signed business associate agreement between Bayside and Pumpkin must be in place before real patient data is sent.</li>
        </ul>
      </div>
      <p className="muted">Questions: contact Bayside&apos;s Pumpkin admin.</p>
    </div>
  );
}
