import Link from "next/link";
import { verifyCodeAction } from "../actions";
import { devLoginEnabled } from "@/lib/session";

export default async function Code({ searchParams }: { searchParams: Promise<{ to?: string; sent?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="auth">
      <h1>Enter your code</h1>
      <p className="muted">{sp.sent ? `If ${sp.sent} has an account, we sent a 6-digit code. It expires in 10 minutes.` : "Enter the 6-digit code we sent you."}</p>
      {sp.error && <div className="card urgent" role="alert">{sp.error}</div>}
      <form className="card" action={verifyCodeAction}>
        <input type="hidden" name="identifier" value={sp.to ?? ""} />
        <label htmlFor="code">Code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required style={{ fontSize: 22, letterSpacing: 6 }} />
        <div style={{ marginTop: 14 }}><button className="btn btn-dark" type="submit" style={{ width: "100%" }}>Sign in</button></div>
      </form>
      <p className="muted" style={{ fontSize: 13 }}><Link href="/login?tab=code">Send a new code</Link>{devLoginEnabled() && <> · Demo: see the code in the <Link href="/dev/outbox">dev outbox</Link></>}</p>
    </div>
  );
}
