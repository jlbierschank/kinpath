import { setupPasswordAction } from "../actions";

export default async function Setup({ searchParams }: { searchParams: Promise<{ t?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="auth">
      <p className="muted" style={{ margin: 0 }}>Bayside Fertility · powered by The Pumpkin</p>
      <h1>Welcome. Set your password.</h1>
      {sp.error && <div className="card urgent" role="alert">{sp.error}</div>}
      <form className="card" action={setupPasswordAction}>
        <input type="hidden" name="t" value={sp.t ?? ""} />
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <label htmlFor="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        <p className="muted" style={{ fontSize: 12.5 }}>At least 12 characters. A few unrelated words works well, like &ldquo;violet harbor lantern.&rdquo;</p>
        <button className="btn btn-dark" type="submit" style={{ width: "100%" }}>Set password</button>
      </form>
    </div>
  );
}
