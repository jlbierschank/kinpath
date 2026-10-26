import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { startTwoStepSetup, twoStepStatus } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { getAnySession, homeFor } from "@/lib/session";
import { confirmSetupAction, signOutAction, twoStepAction } from "../actions";

export default async function TwoStep({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const s = await getAnySession();
  if (!s || !s.token) redirect("/login");
  if (s.mfaPassed) redirect(homeFor(s.role));
  const db = await getDb();
  const { twoStepOn } = await twoStepStatus(db, s.userId);
  const setup = twoStepOn ? null : await startTwoStepSetup(db, s.token);
  const qr = setup ? await QRCode.toString(setup.uri, { type: "svg", margin: 1, width: 200, color: { dark: "#2e211c", light: "#fffcf7" } }) : null;
  return (
    <div className="auth">
      <h1>{twoStepOn ? "Two-step sign-in" : "Set up two-step sign-in"}</h1>
      {sp.error && <div className="card urgent" role="alert">{sp.error}</div>}
      {twoStepOn ? (
        <form className="card" action={twoStepAction}>
          <p className="muted" style={{ marginTop: 0 }}>Open your authenticator app and enter the 6-digit code for The Pumpkin.</p>
          <label htmlFor="code">Code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required style={{ fontSize: 22, letterSpacing: 6 }} />
          <div style={{ marginTop: 14 }}><button className="btn btn-dark" type="submit" style={{ width: "100%" }}>Sign in</button></div>
        </form>
      ) : (
        <form className="card" action={confirmSetupAction}>
          <p style={{ marginTop: 0 }}>Clinic staff use a second step to protect patient information. You&apos;ll do this once.</p>
          <ol style={{ paddingLeft: 18, margin: "0 0 10px" }}>
            <li>Open an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or 1Password.</li>
            <li>Scan this code, or type the key below.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: qr! }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>Key</span>
              <code data-testid="totp-secret" style={{ display: "block", wordBreak: "break-all", fontSize: 14 }}>{setup!.secret.match(/.{1,4}/g)!.join(" ")}</code>
            </div>
          </div>
          <label htmlFor="code">6-digit code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required style={{ fontSize: 22, letterSpacing: 6 }} />
          <div style={{ marginTop: 14 }}><button className="btn btn-dark" type="submit" style={{ width: "100%" }}>Turn on two-step sign-in</button></div>
        </form>
      )}
      <form action={signOutAction}><button className="linkbtn" type="submit">Cancel and sign out</button></form>
    </div>
  );
}
