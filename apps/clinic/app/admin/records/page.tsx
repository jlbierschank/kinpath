import { integrationKeys, recordImports } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { baseUrl, devLoginEnabled, requireSession } from "@/lib/session";
import { revokeKeyAction, sendSampleAction } from "./actions";
import { KeyForm } from "./key-form";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");

export default async function RecordsConnection({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["clinic_admin"]);
  const db = await getDb();
  const [keys, log] = await Promise.all([integrationKeys(db, s), recordImports(db, s)]);
  const endpoint = `${await baseUrl()}/api/integrations/records`;
  return (
    <>
      <h1>Records connection</h1>
      <p className="muted" style={{ maxWidth: 760 }}>
        Lab results and medication orders can come straight from Bayside&apos;s records system instead of being typed in. Results are checked against
        Bayside&apos;s approved ranges, and anything outside them goes to a nurse first. A pregnancy blood test only fills in the number; the nurse
        still decides the outcome. New medication orders wait for a nurse to confirm. Records that don&apos;t clearly match one patient are never guessed.
      </p>
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
          <div className="card" style={{ fontSize: 14 }}>
            <p style={{ marginTop: 0 }}>Send records to <code data-testid="endpoint">{endpoint}</code> with the header <code>Authorization: Bearer &lt;key&gt;</code>.</p>
            <ul style={{ paddingLeft: 18 }}>
              <li><b>FHIR R4</b> (<code>Content-Type: application/fhir+json</code>): a Bundle with Patient (MRN identifier, name), Observation (LOINC 2243-4 estradiol, 2839-9 progesterone, 10501-5 LH, 15067-2 FSH, 21198-7 or 19080-1 hCG) and MedicationRequest resources.</li>
              <li><b>CSV</b> (<code>Content-Type: text/csv</code>): columns <code>result_id, mrn, last_name, test, value, unit, collected_at</code>.</li>
            </ul>
            <p style={{ marginBottom: 0 }} className="muted">The reply lists counts only. Sending the same record again (same id) changes nothing, so it&apos;s safe to retry.</p>
          </div>
        </div>

        <div>
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
          {devLoginEnabled() && (
            <form className="card" action={sendSampleAction}>
              <b>Demo: send sample records</b>
              <p className="muted" style={{ fontSize: 14 }}>As if Bayside&apos;s records system just sent this morning&apos;s labs: Maya&apos;s estradiol (in range) and progesterone (high), a trigger-shot order, a result for an MRN Pumpkin doesn&apos;t know, and a test Pumpkin doesn&apos;t track. Send it twice to see that nothing is duplicated.</p>
              <button className="btn btn-line" type="submit" data-testid="send-sample">Send sample records</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
