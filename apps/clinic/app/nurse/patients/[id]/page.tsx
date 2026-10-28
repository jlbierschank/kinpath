import Link from "next/link";
import { notFound } from "next/navigation";
import { nursePatientCycle, waitDay } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { enterResultAction, graduateAction, recordTransferAction, releaseResultAction } from "../actions";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const local = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const HOW: Record<string, string> = {
  call: "A call from her nurse first",
  together: "A call with her partner, together",
  app: "In the app, as soon as it's released",
};
const OUTCOME: Record<string, string> = { positive: "Positive", negative: "Negative", repeat: "Needs a repeat test" };
const FEEL: Record<string, [string, string]> = { okay: ["Okay", "p-sage"], anxious: ["Anxious", "p-lav"], struggling: ["Struggling", "p-clay"] };

export default async function PatientCycle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await requireSession(["nurse", "physician"]);
  const c = await nursePatientCycle(await getDb(), s, id);
  if (!c) notFound();
  const now = new Date();
  const testDefault = new Date(now); testDefault.setDate(testDefault.getDate() + 9); testDefault.setHours(8, 0, 0, 0);
  const t = c.test;
  const phoneFirst = c.resultHow !== "app";

  return (
    <>
      <p><Link href="/nurse">← Queue</Link></p>
      <h1>{c.name}</h1>
      <p className="muted">
        {c.stage === "stimulation" ? `Stimulation day ${c.stimDay ?? ""}` : c.stage === "wait" ? `Two-week wait${c.transferOn ? `, day ${waitDay(c.transferOn, now)}` : ""}` : c.stage === "result" ? "Result released" : c.stage === "graduated" ? "Graduated to her OB-GYN" : c.stage ?? "No cycle"}
        {" · "}prefers {c.lang === "es" ? "Spanish" : "English"}
      </p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}

      <div className="grid">
        <div>
          {c.stage === "stimulation" && (
            <form className="card" action={recordTransferAction}>
              <h2 style={{ marginTop: 0 }}>Record the transfer</h2>
              <p className="muted" style={{ fontSize: 13.5 }}>Moves {c.firstName}&apos;s app into the two-week wait, shows her the blood test date, and cancels her remaining stimulation doses. Pilot: until the records-system connection is live.</p>
              <input type="hidden" name="patientId" value={id} />
              <label htmlFor="transferOn">Transfer date</label>
              <input id="transferOn" name="transferOn" type="date" defaultValue={ymd(now)} required />
              <label htmlFor="testAt">Pregnancy blood test</label>
              <input id="testAt" name="testAt" type="datetime-local" defaultValue={local(testDefault)} required />
              <label htmlFor="embryosFrozen">Embryos frozen (optional)</label>
              <input id="embryosFrozen" name="embryosFrozen" type="number" min="0" max="50" step="1" placeholder="0" />
              <div style={{ marginTop: 12 }}><button className="btn btn-dark" type="submit">Record transfer</button></div>
            </form>
          )}

          {t && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Pregnancy blood test</h2>
              <p style={{ margin: "4px 0" }}><b>{fmt(t.scheduledAt)}</b></p>
              <p style={{ margin: "4px 0" }}>She wants to hear: <b data-testid="result-how">{c.resultHow ? HOW[c.resultHow] : "Not chosen yet (Pumpkin will ask you to call first)"}</b></p>
            </div>
          )}

          {t && !t.releasedAt && !t.outcome && (
            <form className="card" action={enterResultAction}>
              <h2 style={{ marginTop: 0 }}>Enter the result</h2>
              <p className="muted" style={{ fontSize: 13.5 }}>You decide the outcome. Pumpkin never reads it from the number, and {c.firstName} sees nothing until you release it.</p>
              <input type="hidden" name="patientId" value={id} />
              <label htmlFor="hcg">hCG (mIU/mL)</label>
              <input id="hcg" name="hcg" type="number" step="0.1" min="0" required />
              <label>Outcome</label>
              {Object.entries(OUTCOME).map(([k, v]) => (
                <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}><input type="radio" name="outcome" value={k} required style={{ width: "auto" }} /> {v}</label>
              ))}
              <label htmlFor="note">Your note to {c.firstName}</label>
              <textarea id="note" name="note" rows={5} required placeholder={c.lang === "es" ? "Escribe en español: lo que significa y qué sigue." : "What this means and what happens next, in your words."} />
              <p className="muted" style={{ fontSize: 12.5 }}>She reads this with her result{c.lang === "es" ? ", in Spanish" : ""}. For a negative result, say when you&apos;ll call.</p>
              <div style={{ marginTop: 8 }}><button className="btn btn-dark" type="submit">Save result (not released)</button></div>
            </form>
          )}

          {t && t.outcome && !t.releasedAt && (
            <form className="card" action={releaseResultAction}>
              <h2 style={{ marginTop: 0 }}>Release to {c.firstName}</h2>
              <p style={{ margin: "4px 0" }}>{OUTCOME[t.outcome]} · hCG {t.hcg} · entered by {t.enteredBy}</p>
              <p className="muted" style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>&ldquo;{t.note}&rdquo;</p>
              <input type="hidden" name="patientId" value={id} />
              {phoneFirst ? (
                <>
                  <div className="note" style={{ margin: "8px 0", background: "var(--lav)", borderColor: "var(--lav)" }}>
                    {c.resultHow === "together" ? `${c.firstName} asked to hear this on a call with her partner.` : `${c.firstName} asked to hear this from you by phone.`} Call first, then release so it&apos;s in her app.
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}><input type="checkbox" name="toldByPhone" value="yes" style={{ width: "auto" }} /> {c.resultHow === "together" ? "I've told them by phone" : `I've told ${c.firstName} by phone`}</label>
                </>
              ) : (
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}><input type="checkbox" name="toldByPhone" value="yes" style={{ width: "auto" }} /> I also called her (optional)</label>
              )}
              <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit">Release to her app</button></div>
            </form>
          )}

          {t?.releasedAt && (
            <div className="card">
              <span className={`pill ${t.outcome === "negative" ? "p-clay" : t.outcome === "positive" ? "p-sage" : "p-lav"}`}>{OUTCOME[t.outcome!]}</span>
              <p style={{ margin: "8px 0 4px" }}>Released {fmt(t.releasedAt)} by {t.releasedBy} · {t.toldBy === "phone" ? "told by phone first" : "in the app"}</p>
              {t.outcome === "negative" && <p className="muted" style={{ fontSize: 13.5 }}>Her app is quiet for 14 days: no cheerful messages or follow-up nudges. A follow-up call is on your list.</p>}
            </div>
          )}

          {t?.releasedAt && t.outcome === "positive" && c.stage !== "graduated" && (
            <form className="card" action={graduateAction}>
              <h2 style={{ marginTop: 0 }}>Graduate to her OB-GYN</h2>
              <p className="muted" style={{ fontSize: 13.5 }}>When she&apos;s ready to leave Bayside&apos;s care. Her app shows her graduation, a keepsake of her treatment, and a secure way to share her IVF pregnancy summary with her OB-GYN.</p>
              <input type="hidden" name="patientId" value={id} />
              <label htmlFor="obName">Her OB-GYN</label>
              <input id="obName" name="obName" placeholder="Dr. Ana Reyes, Tampa Women's Health" required />
              <div style={{ marginTop: 12 }}><button className="btn btn-main" type="submit">Graduate {c.firstName}</button></div>
            </form>
          )}
        </div>
        <div>
          {c.embryosFrozen !== null && <div className="card"><b>{c.embryosFrozen}</b> embryo{c.embryosFrozen === 1 ? "" : "s"} in storage</div>}
          {c.nextCycle && (
            <>
              <h2>Next cycle</h2>
              <div className="card" data-testid="next-cycle">
                {c.nextCycle.readyAt
                  ? <span className="pill p-lav">Ready to talk since {fmt(c.nextCycle.readyAt)}</span>
                  : <span className="pill p-clay">Not ready yet. Don&apos;t push.</span>}
                {c.nextCycle.questions
                  ? <><p style={{ margin: "10px 0 4px", fontWeight: 600 }}>Her questions</p><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.nextCycle.questions}</p></>
                  : <p className="muted" style={{ margin: "8px 0 0" }}>No questions written yet.</p>}
              </div>
            </>
          )}
          <h2>Daily check-ins</h2>
          <div className="card">
            {c.checkins.length === 0 && <span className="muted">None yet.</span>}
            {c.checkins.map((k, i) => (
              <div className="row" key={i}><span>{fmt(k.at)}</span><span className={`pill ${FEEL[k.feeling]![1]}`}>{FEEL[k.feeling]![0]}</span></div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>&ldquo;Struggling&rdquo; puts a call on your list automatically. Rough-day details stay private unless she asks to talk.</p>
        </div>
      </div>
    </>
  );
}
