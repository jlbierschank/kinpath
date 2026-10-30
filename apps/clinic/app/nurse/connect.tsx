import type { LinkRequest, LinkShare } from "@kinpath/db";
import { decideLinkAction, matchLinkAction } from "./patients/actions";

const SHARE_LABEL: Record<keyof LinkShare, string> = { about: "Name and how to talk with her", background: "Health background", meds: "Medications", results: "Results", visits: "Visits", questions: "Her questions" };
const shared = (s: LinkShare) => (Object.keys(SHARE_LABEL) as (keyof LinkShare)[]).filter((k) => s[k]);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Patients who use Pumpkin on their own and asked to connect it to this clinic. A nurse confirms who
 * she is by matching her to a chart (or "not in our records yet"), or declines. Nothing of hers is
 * visible until then.
 */
export function ConnectRequests({ requests, patients }: { requests: LinkRequest[]; patients: { id: string; name: string }[] }) {
  const waiting = requests.filter((r) => r.status === "requested");
  const unmatched = requests.filter((r) => r.status === "active" && !r.chartId);
  if (!waiting.length && !unmatched.length) return null;
  const chartPicker = (name: string, required = false) => (
    <select name={name} aria-label="Her chart" defaultValue="" required={required} style={{ flex: "1 1 200px" }}>
      {!required && <option value="">Not in our records yet</option>}
      {required && <option value="" disabled>Choose her chart</option>}
      {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  return (
    <>
      <h2>Asking to connect</h2>
      <div className="card" data-testid="connect-requests">
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Patients who keep their own Pumpkin and want to share it with Bayside. Check it&apos;s her (name and contact), then match her chart. You&apos;ll see only what she chose, and she can stop anytime.</p>
        {waiting.map((r) => (
          <form className="row" key={r.id} action={decideLinkAction} data-testid={`connect-${r.id}`} style={{ flexWrap: "wrap", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: "1 1 260px" }}>
              <b>{r.legalName}</b> <span className="muted" style={{ fontSize: 13 }}>{r.contact ?? ""} · asked {day(r.requestedAt)}</span>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>{shared(r.share).map((k) => <span key={k} className="pill p-lav">{SHARE_LABEL[k]}</span>)}</div>
            </div>
            <input type="hidden" name="linkId" value={r.id} />
            <div style={{ display: "flex", gap: 8, flex: "1 1 320px", flexWrap: "wrap" }}>
              {chartPicker("chartId")}
              <button className="btn btn-dark" type="submit" name="decision" value="accept" data-testid="connect-accept">Confirm</button>
              <button className="btn btn-line" type="submit" name="decision" value="decline" formNoValidate data-testid="connect-decline">Decline</button>
            </div>
          </form>
        ))}
        {unmatched.map((r) => (
          <form className="row" key={r.id} action={matchLinkAction} style={{ flexWrap: "wrap", gap: 10 }}>
            <div style={{ flex: "1 1 260px" }}><b>{r.legalName}</b> <span className="muted" style={{ fontSize: 13 }}>Connected · not matched to a chart yet</span></div>
            <input type="hidden" name="linkId" value={r.id} />
            <div style={{ display: "flex", gap: 8, flex: "1 1 320px" }}>{chartPicker("chartId", true)}<button className="btn btn-line" type="submit">Match</button></div>
          </form>
        ))}
      </div>
    </>
  );
}
