import Link from "next/link";
import { clinicSettings } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { addTermAction, moveGuideAction, removeRangeAction, removeTermAction, saveGuideAction, saveProtocolAction, saveRangeAction } from "./actions";

const TABS = [
  ["ranges", "Results ranges"],
  ["protocols", "Protocol answers"],
  ["walkthroughs", "Injection walkthroughs"],
  ["urgent", "Urgent words"],
  ["history", "Change history"],
] as const;
type TabKey = (typeof TABS)[number][0];

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string; edit?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["nurse", "physician", "clinic_admin"]);
  const data = await clinicSettings(await getDb(), s);
  const tab: TabKey = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "ranges") as TabKey;
  const ro = !data.canEdit;

  return (
    <>
      <p style={{ display: "flex", gap: 16 }}>{s.role !== "clinic_admin" && <Link href="/nurse">← Queue</Link>}{s.role === "clinic_admin" && <Link href="/admin">← Audit log</Link>}</p>
      <h1>Clinic settings</h1>
      <p className="muted">Everything Bayside patients see comes from here. Every change is signed with your name and kept in the change history.{ro && " You can view these settings; only nurses and physicians can change them."}</p>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/settings?tab=${k}`} className={k === tab ? "on" : undefined} aria-current={k === tab ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}

      {tab === "ranges" && (
        <>
          <p className="muted">When a result is inside a range, the patient sees your explanation. When it&apos;s outside, or no range applies, she sees &ldquo;your nurse will review this with you&rdquo; and it lands in the queue. AI never explains results.</p>
          {data.ranges.map((r) => (
            <details key={r.id} className="card" open={sp.edit === r.id}>
              <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span><b style={{ textTransform: "capitalize" }}>{r.analyte}</b> · stimulation days {r.dayFrom}–{r.dayTo} · <b>{r.low}–{r.high} {r.unit}</b></span>
                <span className="muted" style={{ fontSize: 13 }}>Approved by {r.approvedBy}, {when(r.updatedAt)}</span>
              </summary>
              <RangeForm r={r} ro={ro} />
              {!ro && <form action={removeRangeAction} style={{ marginTop: 8 }}><input type="hidden" name="id" value={r.id} /><button className="btn btn-line" type="submit">Remove this range</button></form>}
            </details>
          ))}
          {!ro && <details className="card"><summary style={{ cursor: "pointer" }}><b>+ Add a range</b></summary><RangeForm ro={false} /></details>}
        </>
      )}

      {tab === "protocols" && (
        <>
          <p className="muted">Drafted replies quote these answers and nothing else. A nurse still reviews every draft before it&apos;s sent. Missed-dose answers use the key <code>meds.missed_dose.&lt;medication&gt;</code>, for example <code>meds.missed_dose.menopur</code>.</p>
          {data.protocols.map((p) => (
            <details key={p.id} className="card">
              <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}><span><b>{p.title}</b> <span className="muted">· {p.id}</span></span><span className="muted" style={{ fontSize: 13 }}>Approved by {p.approvedBy}, {when(p.updatedAt)}</span></summary>
              <ProtocolForm p={p} ro={ro} />
            </details>
          ))}
          {!ro && <details className="card"><summary style={{ cursor: "pointer" }}><b>+ Add a protocol answer</b></summary><ProtocolForm ro={false} /></details>}
        </>
      )}

      {tab === "walkthroughs" && (
        <>
          <p className="muted">Patients see these steps, in this order, when they tap &ldquo;Walk me through tonight.&rdquo; Write one step per line, with the same number of lines in English and Spanish.</p>
          {data.guides.map((g, i) => (
            <details key={g.medication} className="card">
              <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <span><b>{i + 1}. {g.medication}</b> <span className="muted">· {g.steps.length} steps{g.videoUrl ? " · video" : " · no video yet"}</span></span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: 13 }}>Approved by {g.approvedBy}</span>
                  {!ro && i > 0 && <form action={moveGuideAction}><input type="hidden" name="medication" value={g.medication} /><input type="hidden" name="direction" value="up" /><button className="btn btn-line" style={{ padding: "4px 10px" }} type="submit" aria-label={`Move ${g.medication} earlier`}>↑</button></form>}
                  {!ro && i < data.guides.length - 1 && <form action={moveGuideAction}><input type="hidden" name="medication" value={g.medication} /><input type="hidden" name="direction" value="down" /><button className="btn btn-line" style={{ padding: "4px 10px" }} type="submit" aria-label={`Move ${g.medication} later`}>↓</button></form>}
                </span>
              </summary>
              <form action={saveGuideAction}>
                <input type="hidden" name="medication" value={g.medication} />
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div><label htmlFor={`en-${g.medication}`}>Steps in English</label><textarea id={`en-${g.medication}`} name="stepsEn" rows={8} defaultValue={g.steps.map((s) => s.en).join("\n")} disabled={ro} /></div>
                  <div><label htmlFor={`es-${g.medication}`}>Steps in Spanish</label><textarea id={`es-${g.medication}`} name="stepsEs" rows={8} defaultValue={g.steps.map((s) => s.es).join("\n")} disabled={ro} /></div>
                </div>
                <label htmlFor={`v-${g.medication}`}>Video link (https)</label><input id={`v-${g.medication}`} name="videoUrl" defaultValue={g.videoUrl ?? ""} placeholder="https://" disabled={ro} />
                {!ro && <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit">Save {g.medication} walkthrough</button></div>}
              </form>
            </details>
          ))}
        </>
      )}

      {tab === "urgent" && (
        <>
          <p className="muted">Messages with any of these words skip the AI, go to the top of the queue, and show the patient &ldquo;This needs a nurse now.&rdquo; Bayside can add words. The built-in list can&apos;t be removed.</p>
          <h2>Bayside&apos;s added words</h2>
          <div className="card">
            {data.terms.length === 0 && <div className="muted">None yet.</div>}
            {data.terms.map((t) => (
              <div className="row" key={t.id}>
                <span><b>{t.term}</b> <span className={`pill ${t.level === "crisis" ? "p-red" : "p-clay"}`}>{t.level === "crisis" ? "Crisis (988)" : "Urgent"}</span> <span className="muted" style={{ fontSize: 13 }}>added by {t.addedBy}, {when(t.addedAt)}</span></span>
                {!ro && <form action={removeTermAction}><input type="hidden" name="id" value={t.id} /><button className="btn btn-line" style={{ padding: "4px 10px" }} type="submit">Remove</button></form>}
              </div>
            ))}
            {!ro && (
              <form action={addTermAction} style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 2, minWidth: 180 }}><label htmlFor="term">Word or phrase (English or Spanish)</label><input id="term" name="term" placeholder="e.g. dizzy, mareada" required /></div>
                <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="level">Send to</label><select id="level" name="level" defaultValue="urgent"><option value="urgent">On-call nurse</option><option value="crisis">Crisis resources (988)</option></select></div>
                <button className="btn btn-dark" type="submit">Add word</button>
              </form>
            )}
          </div>
          <h2>Built in (always on)</h2>
          <div className="card">
            {data.builtInRules.map((r) => (
              <div className="row" key={r.id}>
                <span style={{ fontSize: 13.5 }}>{r.allOf.map((g) => g.slice(0, 4).join(", ") + (g.length > 4 ? "…" : "")).join("  +  ")}</span>
                <span className={`pill ${r.level === "crisis" ? "p-red" : "p-clay"}`}>{r.level === "crisis" ? "Crisis (988)" : "Urgent"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "history" && (
        <div className="card">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
            <tbody>
              {data.changes.length === 0 && <tr><td colSpan={4} className="muted">No changes yet.</td></tr>}
              {data.changes.map((c, i) => (
                <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{when(c.at)}</td><td>{c.by}</td><td>{c.area.replace("_", " ")}: {c.item}</td><td>{c.action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RangeForm({ r, ro }: { r?: { id: string; analyte: string; unit: string; dayFrom: number; dayTo: number; low: number; high: number; inRangeEn: string; inRangeEs: string }; ro: boolean }) {
  const k = r?.id ?? "new";
  return (
    <form action={saveRangeAction} style={{ marginTop: 10 }}>
      {r && <input type="hidden" name="id" value={r.id} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        <div><label htmlFor={`a-${k}`}>Test</label><input id={`a-${k}`} name="analyte" defaultValue={r?.analyte} placeholder="estradiol" disabled={ro} required /></div>
        <div><label htmlFor={`u-${k}`}>Unit</label><input id={`u-${k}`} name="unit" defaultValue={r?.unit} placeholder="pg/mL" disabled={ro} required /></div>
        <div><label htmlFor={`df-${k}`}>From stim day</label><input id={`df-${k}`} name="dayFrom" type="number" defaultValue={r?.dayFrom} disabled={ro} required /></div>
        <div><label htmlFor={`dt-${k}`}>To stim day</label><input id={`dt-${k}`} name="dayTo" type="number" defaultValue={r?.dayTo} disabled={ro} required /></div>
        <div><label htmlFor={`lo-${k}`}>Low</label><input id={`lo-${k}`} name="low" type="number" step="any" defaultValue={r?.low} disabled={ro} required /></div>
        <div><label htmlFor={`hi-${k}`}>High</label><input id={`hi-${k}`} name="high" type="number" step="any" defaultValue={r?.high} disabled={ro} required /></div>
      </div>
      <label htmlFor={`en-${k}`}>What the patient sees when it&apos;s in range (English)</label>
      <textarea id={`en-${k}`} name="inRangeEn" rows={2} defaultValue={r?.inRangeEn} disabled={ro} required />
      <label htmlFor={`es-${k}`}>Spanish</label>
      <textarea id={`es-${k}`} name="inRangeEs" rows={2} defaultValue={r?.inRangeEs} disabled={ro} required />
      {!ro && <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit">{r ? "Save and approve" : "Add range"}</button></div>}
    </form>
  );
}

function ProtocolForm({ p, ro }: { p?: { id: string; title: string; bodyEn: string; bodyEs: string }; ro: boolean }) {
  const k = p?.id ?? "new";
  return (
    <form action={saveProtocolAction} style={{ marginTop: 10 }}>
      {p ? <input type="hidden" name="id" value={p.id} /> : <><label htmlFor="pid-new">Key</label><input id="pid-new" name="id" placeholder="meds.missed_dose.menopur" required /></>}
      <label htmlFor={`t-${k}`}>Title</label><input id={`t-${k}`} name="title" defaultValue={p?.title} disabled={ro} required />
      <label htmlFor={`pen-${k}`}>Answer (English)</label><textarea id={`pen-${k}`} name="bodyEn" rows={4} defaultValue={p?.bodyEn} disabled={ro} required />
      <label htmlFor={`pes-${k}`}>Answer (Spanish)</label><textarea id={`pes-${k}`} name="bodyEs" rows={4} defaultValue={p?.bodyEs} disabled={ro} required />
      {!ro && <div style={{ marginTop: 10 }}><button className="btn btn-main" type="submit">{p ? "Save and approve" : "Add answer"}</button></div>}
    </form>
  );
}
