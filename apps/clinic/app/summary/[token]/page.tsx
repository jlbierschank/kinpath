import type { Metadata } from "next";
import { openSummary } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { PrintButton } from "./print";

/**
 * The IVF pregnancy summary a patient shares with her OB-GYN. No sign-in: the link itself is the
 * key. It expires in 7 days, shows only what she chose, and every view is written to the audit log.
 * Before launch: add a short code sent separately, so a forwarded link alone isn't enough.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "IVF pregnancy summary", robots: { index: false, follow: false } };

const d = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—");
const OUT: Record<string, string> = { positive: "Positive", negative: "Negative", repeat: "Repeat test needed" };

export default async function Summary({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await openSummary(await getDb(), token);
  if (!s) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <h1 style={{ marginTop: 0 }}>This link isn&apos;t available</h1>
        <p className="muted">It may have expired, or the patient may have stopped sharing it. Ask her to send a new link from her app.</p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 760 }}>
      <p className="muted" style={{ margin: 0 }}>{s.clinic} · shared by the patient with {s.recipient}</p>
      <h1 style={{ marginBottom: 4 }}>IVF pregnancy summary</h1>
      <p style={{ marginTop: 0, fontSize: 18 }}><b data-testid="summary-patient">{s.patient}</b></p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cycle</h2>
        <div className="row"><span>Treatment</span><b>{s.cycle.kind.toUpperCase()}</b></div>
        <div className="row"><span>Cycle started</span><b>{d(s.cycle.startedOn)}</b></div>
        <div className="row"><span>Embryo transfer</span><b>{d(s.cycle.transferOn)}</b></div>
        <div className="row"><span>Graduated from {s.clinic}</span><b>{d(s.cycle.graduatedOn)}</b></div>
        {s.cycle.ob && <div className="row"><span>Receiving OB-GYN</span><b>{s.cycle.ob}</b></div>}
      </div>
      {s.tests && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pregnancy blood tests</h2>
          {s.tests.length === 0 && <span className="muted">None released.</span>}
          {s.tests.map((t, i) => <div className="row" key={i}><span>{d(t.at)}</span><b>hCG {t.hcg ?? "—"} mIU/mL · {OUT[t.outcome] ?? t.outcome}</b></div>)}
        </div>
      )}
      {s.labs && s.labs.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Monitoring labs</h2>
          {s.labs.map((l, i) => <div className="row" key={i}><span>{l.analyte[0]!.toUpperCase() + l.analyte.slice(1)} · stimulation day {l.stimDay}</span><b>{l.value} {l.unit}</b></div>)}
        </div>
      )}
      {s.meds && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Fertility medications</h2>
          {s.meds.map((m, i) => <div className="row" key={i}><span>{m.medication} · {m.dose}</span><span className="muted">{m.taken} doses logged</span></div>)}
        </div>
      )}
      {!s.tests && !s.meds && <p className="muted">The patient chose to share her cycle dates only.</p>}
      <p className="muted" style={{ fontSize: 13 }}>Shared by the patient through Pumpkin. This link expires {d(s.expiresAt)}. Each view is recorded. This summary does not replace the clinic&apos;s full records; contact {s.clinic} for them.</p>
      <PrintButton />
    </div>
  );
}
