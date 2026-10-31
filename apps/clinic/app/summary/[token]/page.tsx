import type { Metadata } from "next";
import { openAnySummary, type PersonalSummary } from "@kinpath/db";
import { CONCEPTION, weeksToday } from "@kinpath/core";
import { getDb } from "@/lib/db";
import { PrintButton } from "./print";

/**
 * A record a patient shares: from clinic mode, the IVF pregnancy summary for her OB-GYN; on her own,
 * the sections she chose, with a PDF and a FHIR data file. No sign-in: the link itself is the key.
 * It shows only what she chose, expires, and every view and download is written to the audit log.
 * Before launch: add a short code sent separately, so a forwarded link alone isn't enough.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Patient record summary", robots: { index: false, follow: false } };

const d = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Not given");
const OUT: Record<string, string> = { positive: "Positive", negative: "Negative", repeat: "Repeat test needed" };

export default async function Summary({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await openAnySummary(await getDb(), token);
  if (!s) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <h1 style={{ marginTop: 0 }}>This link isn&apos;t available</h1>
        <p className="muted">It may have expired, or the patient may have stopped sharing it. Ask her to send a new link from her app.</p>
      </div>
    );
  }
  if (s.kind === "personal") return <Personal s={s} token={token} />;
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
          {s.tests.map((t, i) => <div className="row" key={i}><span>{d(t.at)}</span><b>hCG {t.hcg ?? "Not given"} mIU/mL · {OUT[t.outcome] ?? t.outcome}</b></div>)}
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

const BY: Record<string, string> = { you: "Added by the patient", read: "Read from her document, checked by the patient", clinic: "From the clinic's records" };
const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const money = (c: number | null) => (c === null ? "Not given" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);

/** Her own record, the sections she chose. Every item says who entered it. A PDF and a FHIR file come with it. */
function Personal({ s, token }: { s: PersonalSummary; token: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const w = s.pregnancy.dueDate ? weeksToday(s.pregnancy.dueDate, today) : null;
  const how = CONCEPTION.find(([k]) => k === s.pregnancy.how)?.[1];
  const pregnancy = s.sections.includes("pregnancy") && (s.pregnancy.conceivedOn || s.pregnancy.dueDate);
  return (
    <div style={{ maxWidth: 760 }}>
      <p className="muted" style={{ margin: 0 }}>Shared by the patient with {s.recipient}{s.clinic ? ` · fertility clinic: ${s.clinic}` : ""}</p>
      <h1 style={{ marginBottom: 4 }}>{pregnancy ? "Pregnancy after fertility treatment: patient summary" : "Patient record summary"}</h1>
      <p style={{ marginTop: 0, fontSize: 18 }}><b data-testid="summary-patient">{s.patient}</b></p>
      <p className="muted" data-testid="summary-note">The patient keeps this record herself in Pumpkin. It is her copy, not the clinic&apos;s official record, and each item says who entered it.</p>
      <div className="card" data-testid="summary-downloads" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn btn-dark" href={`/summary/${token}/pdf`} data-testid="summary-pdf">Download PDF</a>
        <a className="btn btn-line" href={`/summary/${token}/fhir`} data-testid="summary-fhir">Download data file (FHIR)</a>
        <span className="muted" style={{ fontSize: 13 }}>The data file is FHIR R4, the format health record systems exchange. Your system decides what goes in its chart.</span>
      </div>
      {pregnancy && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pregnancy</h2>
          <div className="row"><span>{how ?? "Transfer or insemination"}</span><b>{d(s.pregnancy.conceivedOn)}</b></div>
          <div className="row"><span>Estimated due date</span><b data-testid="summary-due">{s.pregnancy.dueDate ? d(s.pregnancy.dueDate) : "Not given"}</b></div>
          {w && <div className="row"><span>Today</span><b>{w.weeks} weeks {w.days} days</b></div>}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Calculated by Pumpkin from the date the patient entered (ACOG Committee Opinion 700 for transfers). Please confirm with her fertility clinic.</p>
          {s.pregnancy.ob && <div className="row"><span>OB</span><b>{s.pregnancy.ob}</b></div>}
        </div>
      )}
      {s.results && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Test results</h2>
          {s.results.length === 0 && <span className="muted">None in her record.</span>}
          {s.results.map((r, i) => <div className="row" key={i}><span>{d(r.on)} · {r.test}<br /><span className="muted" style={{ fontSize: 12.5 }}>{BY[r.by]}</span></span><b>{r.value} {r.unit}</b></div>)}
        </div>
      )}
      {s.meds && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Medications</h2>
          {s.meds.length === 0 && <span className="muted">None in her record.</span>}
          {s.meds.map((m, i) => <div className="row" key={i}><span>{m.medication} · {m.dose} at {m.time}<br /><span className="muted" style={{ fontSize: 12.5 }}>{BY[m.by]}</span></span><span>{m.active ? `Until ${d(m.endsOn)}` : "Stopped"}</span></div>)}
        </div>
      )}
      {s.sections.includes("visits") && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Visits</h2>
          {s.appointments.length === 0 && <span className="muted">None in her record.</span>}
          {s.appointments.map((a, i) => <div className="row" key={i}><span>{a.title}{a.location ? ` · ${a.location}` : ""}<br /><span className="muted" style={{ fontSize: 12.5 }}>{BY[a.by]}</span></span><b>{time(a.at)}</b></div>)}
        </div>
      )}
      {s.coverage && (
        <div className="card" data-testid="summary-coverage">
          <h2 style={{ marginTop: 0 }}>Insurance coverage</h2>
          {s.coverage.length === 0 && <span className="muted">None in her record.</span>}
          {s.coverage.map((c, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <b>{c.payer ?? "Insurer not given"}{c.plan ? `, ${c.plan}` : ""}</b>{c.asOf && <span className="muted"> · statement of {d(c.asOf)}</span>}
              {(c.fertilityMaxCents !== null || !!c.fertilityUsedCents) && <div className="row"><span>Fertility benefit used</span><b>{money(c.fertilityUsedCents)} of {money(c.fertilityMaxCents)}</b></div>}
              {c.deductibleCents !== null && <div className="row"><span>Deductible met</span><b>{money(c.deductibleMetCents)} of {money(c.deductibleCents)}</b></div>}
              {c.oopMaxCents !== null && <div className="row"><span>Out-of-pocket met</span><b>{money(c.oopMetCents)} of {money(c.oopMaxCents)}</b></div>}
              <span className="muted" style={{ fontSize: 12.5 }}>{BY[c.by]}</span>
            </div>
          ))}
        </div>
      )}
      {s.costs && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Costs</h2>
          {s.costs.length === 0 && <span className="muted">None in her record.</span>}
          {s.costs.map((c, i) => <div className="row" key={i}><span>{d(c.on)} · {c.description}<br /><span className="muted" style={{ fontSize: 12.5 }}>{BY[c.by]}</span></span><b>{c.kind === "payment" ? "Paid " : ""}{money(c.amountCents)}</b></div>)}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>For the clinic&apos;s official records, the patient can request a copy from {s.clinic ?? "her fertility clinic"}&apos;s medical records team. This link expires {d(s.expiresAt)}. Each view and download is recorded, and the patient can stop it anytime.</p>
      <PrintButton />
    </div>
  );
}
