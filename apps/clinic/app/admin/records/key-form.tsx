"use client";

import { useActionState } from "react";
import { createKeyAction } from "./actions";

/** Creates a key and shows it once. Reloading the page hides it for good. */
export function KeyForm() {
  const [state, action, pending] = useActionState(createKeyAction, null);
  return (
    <>
      {state?.key && (
        <div className="card" data-testid="new-key" style={{ borderColor: "var(--lav-ink)" }}>
          <b>Copy this key now.</b> It won&apos;t be shown again. Give it to whoever sets up the feed from the records system, through a secure channel.
          <pre data-testid="new-key-value" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--paper)", padding: 10, borderRadius: 8 }}>{state.key}</pre>
          <button className="btn btn-line" type="button" onClick={() => navigator.clipboard?.writeText(state.key!)}>Copy key</button>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Reload the page to see it in the list below.</p>
        </div>
      )}
      {state?.error && <div className="card urgent" role="alert"><b>Not done.</b> {state.error}</div>}
      <form className="card" action={action}>
        <label htmlFor="name">New key</label>
        <input id="name" name="name" placeholder="Epic results feed" maxLength={80} required />
        <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit" disabled={pending}>{pending ? "Creating…" : "Create key"}</button></div>
      </form>
    </>
  );
}
