"use client";

import { useActionState } from "react";
import { uploadRecordsAction } from "./actions";

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadRecordsAction, null);
  return (
    <form className="card" action={action}>
      <b>Upload a file</b>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        Until a live feed is set up, export results from the records system and upload them here: a CSV, a FHIR Bundle (.json), or HL7 v2 messages (.hl7 or .txt).
        Everything goes through the same checks as a live feed.
      </p>
      <input type="file" name="file" accept=".csv,.json,.hl7,.txt,text/csv,application/json,application/fhir+json" required aria-label="Records file" />
      <div style={{ marginTop: 10 }}><button className="btn btn-line" type="submit" disabled={pending} data-testid="upload">{pending ? "Uploading…" : "Upload"}</button></div>
      {state?.summary && <p role="status" data-testid="upload-result" style={{ color: "var(--sage-ink)", marginBottom: 0 }}>{state.summary} Nurses see anything that needs them.</p>}
      {state?.error && <p role="alert" style={{ color: "var(--red)", marginBottom: 0 }}>{state.error}</p>}
    </form>
  );
}
