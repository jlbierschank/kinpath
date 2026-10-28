import Link from "next/link";
import { redirect } from "next/navigation";
import { devLoginEnabled, getSession, homeFor } from "@/lib/session";
import { requestCodeAction, staffSignInAction } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; tab?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (s) redirect(homeFor(s.role));
  const code = sp.tab === "code";
  return (
    <div className="auth">
      <p className="muted" style={{ margin: 0 }}>Bayside Fertility · powered by Pumpkin</p>
      <h1>Sign in</h1>
      <div className="seg" role="tablist">
        <Link href="/login" role="tab" aria-selected={!code} className={!code ? "on" : ""}>Clinic staff</Link>
        <Link href="/login?tab=code" role="tab" aria-selected={code} className={code ? "on" : ""}>Patients and family</Link>
      </div>
      {sp.error && <div className="card urgent" role="alert" style={{ marginTop: 12 }}>{sp.error}</div>}
      {!code ? (
        <form className="card" action={staffSignInAction} style={{ marginTop: 12 }}>
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <div style={{ marginTop: 14 }}><button className="btn btn-dark" type="submit" style={{ width: "100%" }}>Next: your code</button></div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Next you&apos;ll enter a code from your authenticator app. Forgot your password? Ask your clinic admin to send a new setup link.</p>
        </form>
      ) : (
        <form className="card" action={requestCodeAction} style={{ marginTop: 12 }}>
          <label htmlFor="identifier">Mobile number or email</label>
          <input id="identifier" name="identifier" autoComplete="username" required placeholder="(813) 555-0142 or you@email.com" />
          <div style={{ marginTop: 14 }}><button className="btn btn-dark" type="submit" style={{ width: "100%" }}>Send me a code</button></div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>No password needed. We&apos;ll send a 6-digit code. Most people use the Bayside Fertility phone app instead.</p>
        </form>
      )}
      {devLoginEnabled() && (
        <p className="muted" style={{ fontSize: 13 }}>Demo build: <Link href="/">pick a test person</Link> instead · staff demo password <code>bayside demo 2026</code> · codes appear in the <Link href="/dev/outbox">dev outbox</Link>.</p>
      )}
    </div>
  );
}
