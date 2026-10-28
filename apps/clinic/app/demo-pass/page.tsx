import { testMode } from "@kinpath/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pumpkin" };

export default async function DemoPass({ searchParams }: { searchParams: Promise<{ next?: string; wrong?: string }> }) {
  const { next = "/", wrong } = await searchParams;
  const test = testMode();
  return (
    <div style={{ maxWidth: 440, margin: "60px auto", padding: "0 16px" }}>
      <p className="muted" style={{ margin: 0 }}>{test ? "Pumpkin · test version" : "Pumpkin · demo"}</p>
      <h1>Welcome</h1>
      <p className="muted">{test
        ? "Thanks for testing Pumpkin. Enter the passcode you were given. Please use made-up information only, not your real health details."
        : "This is a working demo of Pumpkin with made-up patients. No real patient information is used. Enter the passcode you were given."}</p>
      {wrong && <div className="card urgent" data-testid="wrong-pass">That passcode didn&apos;t match.</div>}
      <form className="card" method="post" action="/api/demo-pass">
        <input type="hidden" name="next" value={test && next === "/" ? "/phone" : next} />
        <label htmlFor="passcode">Passcode</label>
        <input id="passcode" name="passcode" type="password" autoComplete="off" autoFocus required />
        <div style={{ marginTop: 12 }}><button className="btn btn-main" type="submit">{test ? "Open Pumpkin" : "Open the demo"}</button></div>
      </form>
      {test ? null : <p className="muted" style={{ fontSize: 13 }}>After this you&apos;ll pick a test person: a patient, her partner, or a nurse. The patient&apos;s phone app is at <code>/phone</code>.</p>}
    </div>
  );
}
