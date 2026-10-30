import Link from "next/link";
import { notFound } from "next/navigation";
import { aiDraftingStatus, handoffDetail } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { draft, handleRefill, markCalled, send } from "../../actions";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(["nurse", "physician"]);
  const d = await handoffDetail(await getDb(), s, id);
  if (!d) notFound();
  const h = d.handoff;
  const isUrgent = h.kind === "urgent_symptom" || h.kind === "crisis";
  const done = h.status === "sent" || h.status === "read" || h.status === "closed";
  const isRefill = h.kind === "refill_request";

  return (
    <>
      <p><Link href="/nurse">← Queue</Link></p>
      <h1>{d.patientName}</h1>
      <p className="muted">{d.stimDay ? `Stimulation day ${d.stimDay}` : ""} · prefers {d.lang === "es" ? "Spanish" : "English"}</p>
      <div className="grid">
        <div>
          <div className={`card ${isUrgent ? "urgent" : ""}`}>
            {isUrgent && <span className="pill p-red">{h.kind === "crisis" ? "Crisis: call now, share 988" : "Urgent: Pumpkin did not answer this"}</span>}
            <p style={{ fontSize: 17 }}>&ldquo;{h.patientMessage}&rdquo;</p>
            {isRefill && <span className="pill p-sage">Refill request</span>}
            {d.fromHerSpace && <p className="muted" style={{ fontSize: 13.5 }} data-testid="from-her-space">Sent from her own Pumpkin, which she connected to your clinic. She sees what you mark here, but can&apos;t read a written reply. Call her or use your portal if you need more.</p>}
            {h.triage.ruleIds.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Safety rules matched: {h.triage.ruleIds.join(", ")}</p>}
          </div>

          {done && <div className="card"><b>Done.</b> <span className="muted">{h.sentText}</span></div>}

          {!done && isUrgent && (
            <form className="card" action={markCalled}>
              <input type="hidden" name="handoffId" value={h.id} />
              <b>Call {d.firstName} now.</b>
              <p className="muted" style={{ fontSize: 13.5 }}>Urgent and crisis messages never get a drafted reply. Log the call when you&apos;re done.</p>
              <label htmlFor="note">Note to {d.firstName} (optional)</label>
              <textarea id="note" name="note" rows={2} placeholder="We talked through your symptoms. Come in at 10 am." />
              <div style={{ marginTop: 10 }}><button className="btn btn-red" type="submit">I called {d.firstName}</button></div>
            </form>
          )}

          {!done && isRefill && (
            <form className="card" action={handleRefill} data-testid="refill-handle">
              <input type="hidden" name="handoffId" value={h.id} />
              <b>What happened with this refill?</b>
              <fieldset style={{ border: 0, padding: 0, margin: "10px 0", display: "grid", gap: 6 }}>
                <label><input type="radio" name="outcome" value="sent" defaultChecked /> Sent to her pharmacy</label>
                <label><input type="radio" name="outcome" value="call" /> We&apos;ll call her about it</label>
                <label><input type="radio" name="outcome" value="visit" /> She needs a visit first</label>
              </fieldset>
              <label htmlFor="rnote">Note to {d.firstName} (optional)</label>
              <textarea id="rnote" name="note" rows={2} placeholder="Ready for pickup after 3 pm." />
              <p className="muted" style={{ fontSize: 13 }}>{d.firstName} sees your name, what happened and your note.</p>
              <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit" data-testid="refill-done">Mark handled</button></div>
            </form>
          )}

          {!done && !isUrgent && !d.fromHerSpace && h.status === "open" && (
            <form className="card" action={draft}>
              <input type="hidden" name="handoffId" value={h.id} />
              <p style={{ marginTop: 0 }}>Pumpkin can draft a reply from Bayside&apos;s approved protocol. Every draft is checked against that protocol, and you review and send it.</p>
              <p className="muted" style={{ fontSize: 13 }} data-testid="ai-status">{aiDraftingStatus().on ? "AI drafting is on: the AI rewrites the matching protocol text in plain language, then it's checked." : "AI drafting is off: drafts are the protocol text itself."}</p>
              <button className="btn btn-main" type="submit">Draft a reply</button>
            </form>
          )}

          {!done && !isUrgent && !d.fromHerSpace && h.status === "drafted" && (
            <form className="card" action={send}>
              <input type="hidden" name="handoffId" value={h.id} />
              <label htmlFor="text">Reply to {d.firstName} {d.lang === "es" && "(in Spanish)"}</label>
              <textarea id="text" name="text" rows={6} defaultValue={h.draft ?? ""} />
              <p className="muted" style={{ fontSize: 13 }}>
                {d.draftEngine === "ai" && <><span className="pill p-lav" data-testid="draft-engine">AI draft · passed every check</span>{" "}</>}
                {d.draftEngine === "ai_held_back" && <><span className="pill p-clay" data-testid="draft-engine">AI draft held back: {d.draftProblems.join("; ")}. {h.draftSource ? "Showing the approved protocol text instead." : "Write your own reply."}</span>{" "}</>}
                {d.draftEngine === "ai_error" && <><span className="pill p-clay" data-testid="draft-engine">AI draft unavailable: {d.draftProblems.join("; ")}. {h.draftSource ? "Showing the approved protocol text instead." : "Write your own reply."}</span>{" "}</>}
                {h.draftSource ? `Drafted from protocol: ${h.draftSource}.` : "No matching protocol section. Write your own reply."} {d.firstName} will see &ldquo;Drafted with Pumpkin, reviewed by {s.name}.&rdquo;
              </p>
              <button className="btn btn-main" type="submit">Approve and send</button>
            </form>
          )}
        </div>
        <div>
          <h2>Dose log (attached automatically)</h2>
          <div className="card">
            <table>
              <thead><tr><th>Medication</th><th>Scheduled</th><th>Status</th></tr></thead>
              <tbody>
                {d.doseLog.map((x, i) => (
                  <tr key={i}>
                    <td>{x.medication} <span className="muted">{x.dose}</span></td>
                    <td>{fmt(x.scheduledFor)}</td>
                    <td>{x.takenAt ? <span className="pill p-sage">Taken {fmt(x.takenAt)}</span> : x.reportedMissed ? <span className="pill p-clay">Reported missed</span> : <span className="pill p-lav">Not logged</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
