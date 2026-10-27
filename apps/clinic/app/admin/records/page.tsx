import { fhirSource, integrationKeys, recordImports } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { baseUrl, devLoginEnabled, requireSession } from "@/lib/session";
import { pullNowAction, revokeKeyAction, saveFhirAction, sendSampleAction, setUpFhirAction } from "./actions";
import { UploadForm } from "./upload-form";
import { KeyForm } from "./key-form";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");

export default async function RecordsConnection({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["clinic_admin"]);
  const db = await getDb();
  const [keys, log, fhir] = await Promise.all([integrationKeys(db, s), recordImports(db, s), fhirSource(db, s)]);
  const base = await baseUrl();
  const endpoint = `${base}/api/integrations/records`;
  const jwksUrl = `${base}/api/integrations/jwks/${s.clinicId}`;
  return (
    <>
      <h1>Records connection</h1>
      <p className="muted" style={{ maxWidth: 760 }}>
        Lab results and medication orders can come straight from Bayside&apos;s records system instead of being typed in. Results are checked against
        Bayside&apos;s approved ranges, and anything outside them goes to a nurse first. A pregnancy blood test only fills in the number; the nurse
        still decides the outcome. New medication orders wait for a nurse to confirm. Records that don&apos;t clearly match one patient are never guessed.
      </p>
      <p className="muted" style={{ maxWidth: 760, fontSize: 14 }}>Three ways in, all with the same checks: <b>the records system sends</b> to Pumpkin (keys, below), <b>Pumpkin reads</b> from the records system&apos;s FHIR API, or <b>someone uploads</b> an export.</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not done.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" data-testid="records-saved" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}
      <div className="grid">
        <div>
          <h2>Keys</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Name</th><th>Ends in</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {keys.length === 0 && <tr><td colSpan={4} className="muted">No keys yet.</td></tr>}
                {keys.map((k) => (
                  <tr key={k.id} style={k.active ? undefined : { opacity: 0.55 }}>
                    <td><b>{k.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>Created {when(k.createdAt)}</span></td>
                    <td><code>…{k.hint}</code></td>
                    <td className="muted" style={{ fontSize: 13 }}>{when(k.lastUsedAt)}</td>
                    <td>{k.active ? (
                      <form action={revokeKeyAction}><input type="hidden" name="keyId" value={k.id} /><button className="linkbtn" type="submit">Turn off</button></form>
                    ) : <span className="pill p-clay">Off</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <KeyForm />

          <h2>For the person setting up the feed</h2>
          <p style={{ margin: "0 0 8px" }}><a href="/admin/records/guide" data-testid="guide-link">Open the setup guide for your IT team →</a> <span className="muted" style={{ fontSize: 13 }}>(one page, ready to print or save as PDF)</span></p>
          <div className="card" style={{ fontSize: 14 }}>
            <p style={{ marginTop: 0 }}>Send records to <code data-testid="endpoint">{endpoint}</code> with the header <code>Authorization: Bearer &lt;key&gt;</code>.</p>
            <ul style={{ paddingLeft: 18 }}>
              <li><b>FHIR R4</b> (<code>Content-Type: application/fhir+json</code>): a Bundle with Patient (MRN identifier, name), Observation (LOINC 2243-4 estradiol, 2839-9 progesterone, 10501-5 LH, 15067-2 FSH, 21198-7 or 19080-1 hCG) and MedicationRequest resources.</li>
              <li><b>HL7 v2</b> (<code>Content-Type: x-application/hl7-v2+er7</code>): ORU^R01 lab results, RDE^O11 pharmacy orders, SIU^S12–S17 appointments. The reply is an HL7 acknowledgment.</li>
              <li><b>CSV</b> (<code>Content-Type: text/csv</code>): results with columns <code>result_id, mrn, last_name, test, value, unit, collected_at</code>; or billing with <code>entry_id, mrn, last_name, type, description, amount, date</code> (plus optional <code>due_date, method, insurance_amount, category, estimate_id, estimate_title</code>).</li>
              <li><b>Billing</b> also arrives as FHIR Coverage and Invoice, or HL7 DFT^P03 (FT1) with IN1 insurance.</li>
            </ul>
            <p style={{ marginBottom: 0 }} className="muted">The reply lists counts only. Sending the same record again (same id) changes nothing, so it&apos;s safe to retry.</p>
          </div>
        </div>

        <div>
          <UploadForm />
          <h2>What came in</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>When</th><th>From</th><th>What happened</th></tr></thead>
              <tbody>
                {log.length === 0 && <tr><td colSpan={3} className="muted">Nothing yet.</td></tr>}
                {log.map((l) => (
                  <tr key={l.id} data-testid="import-row">
                    <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{when(l.receivedAt)}</td>
                    <td style={{ fontSize: 13 }}>{l.source}</td>
                    <td style={{ fontSize: 13 }}>
                      {l.counts.resultsAdded} result{l.counts.resultsAdded === 1 ? "" : "s"} added{l.counts.resultsToNurse ? ` (${l.counts.resultsToNurse} to a nurse first)` : ""}
                      {l.counts.hcgAdded ? `, ${l.counts.hcgAdded} hCG` : ""}
                      {l.counts.corrected ? `, ${l.counts.corrected} corrected` : ""}
                      {l.counts.ordersWaiting ? `, ${l.counts.ordersWaiting} order${l.counts.ordersWaiting === 1 ? "" : "s"} waiting` : ""}
                      {l.counts.appointments ? `, ${l.counts.appointments} appointment${l.counts.appointments === 1 ? "" : "s"}` : ""}
                      {l.counts.billing ? `, ${l.counts.billing} billing line${l.counts.billing === 1 ? "" : "s"}` : ""}
                      {l.counts.estimatesWaiting ? `, ${l.counts.estimatesWaiting} estimate${l.counts.estimatesWaiting === 1 ? "" : "s"}` : ""}
                      {l.counts.toReview ? `, ${l.counts.toReview} to review` : ""}
                      {l.counts.duplicates ? `, ${l.counts.duplicates} already here` : ""}
                      {l.counts.skipped ? `, ${l.counts.skipped} skipped` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>This log shows counts only. Nurses see the records themselves.</p>
          <h2 id="fhir">Read from the records system (FHIR)</h2>
          {!fhir ? (
            <form className="card" action={setUpFhirAction}>
              <p style={{ marginTop: 0, fontSize: 14 }}>If the records system has a FHIR API, Pumpkin can sign in on its own and check for new lab results, medication orders and appointments every 15 minutes. It uses SMART Backend Services, the standard way EHR vendors allow this.</p>
              <button className="btn btn-line" type="submit" data-testid="fhir-setup">Set up</button>
            </form>
          ) : (
            <div className="card" data-testid="fhir-card" style={{ fontSize: 14 }}>
              <p style={{ marginTop: 0 }}><b>Step 1.</b> Ask the records system vendor to register Pumpkin as a backend service with this key address (JWK Set URL), signing with RS384:</p>
              <pre data-testid="jwks-url" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--paper)", padding: 10, borderRadius: 8 }}>{jwksUrl}</pre>
              <p><b>Step 2.</b> Enter what they give back.</p>
              <form action={saveFhirAction}>
                <label htmlFor="baseUrl">FHIR address (base URL)</label>
                <input id="baseUrl" name="baseUrl" defaultValue={fhir.baseUrl ?? ""} placeholder="https://fhir.example-ehr.com/api/FHIR/R4" required />
                <label htmlFor="clientId">Client id</label>
                <input id="clientId" name="clientId" defaultValue={fhir.clientId ?? ""} required />
                <label htmlFor="tokenUrl">Token URL <span className="muted">(leave blank to find it automatically)</span></label>
                <input id="tokenUrl" name="tokenUrl" defaultValue={fhir.tokenUrl ?? ""} />
                <label htmlFor="mrnSystem">MRN identifier system <span className="muted">(optional, from the vendor)</span></label>
                <input id="mrnSystem" name="mrnSystem" defaultValue={fhir.mrnSystem ?? ""} placeholder="urn:oid:1.2.840.114350…" />
                <label htmlFor="scope">Scopes</label>
                <input id="scope" name="scope" defaultValue={fhir.scope} />
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}><input type="checkbox" name="enabled" defaultChecked={fhir.enabled} style={{ width: "auto" }} /> Check for new records every 15 minutes</label>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}><button className="btn btn-main" type="submit">Save</button></div>
              </form>
              {fhir.baseUrl && fhir.clientId && (
                <form action={pullNowAction} style={{ marginTop: 10 }}><button className="btn btn-line" type="submit" data-testid="pull-now">Check now</button></form>
              )}
              <p className="muted" style={{ marginBottom: 0 }} data-testid="fhir-status">{fhir.lastStatus ?? "Not checked yet."}{fhir.lastPulledAt ? ` Last successful check ${when(fhir.lastPulledAt)}.` : ""}</p>
            </div>
          )}
          {devLoginEnabled() && (
            <form className="card" action={sendSampleAction}>
              <b>Demo: send sample records</b>
              <p className="muted" style={{ fontSize: 14 }}>As if Bayside&apos;s records system just sent this morning&apos;s labs: Maya&apos;s estradiol (in range) and progesterone (high), a trigger-shot order, tomorrow&apos;s monitoring visit, a result for an MRN Pumpkin doesn&apos;t know, and a test Pumpkin doesn&apos;t track. Send it twice to see that nothing is duplicated.</p>
              <button className="btn btn-line" type="submit" data-testid="send-sample">Send sample records</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
