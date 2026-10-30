import type { LinkedSpace } from "@kinpath/db";
import { CONDITIONS } from "@kinpath/core";

// In the care team's words (her app shows these in the first person).
const PATH: Record<string, string> = {
  solo_by_choice: "On her own (single parent by choice)", with_partner: "With a partner", donor_eggs: "Donor eggs", donor_sperm: "Donor sperm",
  donor_embryos: "Donor embryos", gestational_carrier: "Gestational carrier", preserving: "Freezing eggs or embryos for later",
  growing_again: "Growing her family again", prefer_not: "Rather not say"
};
const clock = (hm: string) => { const [h, m] = hm.split(":").map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`; };
const COND: Record<string, string> = CONDITIONS;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * What she shares from her own Pumpkin. Everything here is entered by her, and the panel says so.
 * How to address her and how she wants news come first, because that changes how the team talks to her.
 */
export function LinkedPanel({ s }: { s: LinkedSpace }) {
  const a = s.about;
  return (
    <div className="card" data-testid="linked-space" style={{ borderColor: "var(--lav)" }}>
      <h2 style={{ marginTop: 0 }}>From her Pumpkin</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>She keeps her own Pumpkin and shares these parts with you{s.since ? ` (since ${day(s.since)})` : ""}. Entered by her, not by the clinic. She can stop sharing anytime.</p>
      {a && (
        <div style={{ background: "var(--oat)", borderRadius: 12, padding: 12, marginBottom: 10 }} data-testid="linked-about">
          {a.preferredName && <div className="row" style={{ borderTop: 0 }}><span>Goes by</span><b>{a.preferredName}{a.pronunciation ? ` (says it “${a.pronunciation}”)` : ""}</b></div>}
          {a.pronouns && <div className="row"><span>Pronouns</span><b>{a.pronouns}</b></div>}
          {a.familyPath && a.familyPath.length > 0 && <div className="row"><span>Building her family</span><b>{a.familyPath.map((p) => PATH[p] ?? p).join(", ")}</b></div>}
          {a.partnerName && <div className="row"><span>Her {a.partnerTitle ?? "person"}</span><b>{a.partnerName}{a.partnerPronouns ? ` (${a.partnerPronouns})` : ""}</b></div>}
          <div className="row"><span>How she likes news</span><b>{a.tone === "reassure" ? "With some reassurance" : "Just the facts"}{a.revealResults ? "; new numbers wait until she taps" : ""}</b></div>
        </div>
      )}
      {s.background && (
        <div style={{ marginBottom: 10 }}>
          <b style={{ fontSize: 13.5 }}>Health background</b>
          {s.background.conditions.length > 0 && <div className="row"><span>Conditions</span><span>{s.background.conditions.map((c) => COND[c] ?? c).join(", ")}{s.background.conditionsOther ? `, ${s.background.conditionsOther}` : ""}</span></div>}
          {s.background.pastCycles !== null && <div className="row"><span>Past treatment cycles</span><span>{s.background.pastCycles}</span></div>}
          {s.background.pastLoss === "yes" && <div className="row"><span>Pregnancy loss</span><span>Yes</span></div>}
          {s.background.allergies && <div className="row"><span>Allergies</span><b>{s.background.allergies}</b></div>}
        </div>
      )}
      {s.meds && <Section title="Her medications" empty="None in her Pumpkin.">{s.meds.map((m, i) => <div className="row" key={i}><span>{m.medication} · {m.dose}</span><span className="muted">{clock(m.time)}{m.endsOn ? ` · until ${day(m.endsOn)}` : ""}</span></div>)}</Section>}
      {s.results && <Section title="Results she added" empty="None in her Pumpkin.">{s.results.slice(0, 10).map((r, i) => <div className="row" key={i}><span>{r.test} · {day(r.on)}{r.refText ? <span className="muted"> · lab range {r.refText}</span> : null}</span><b>{r.value} {r.unit}</b></div>)}</Section>}
      {s.visits && <Section title="Visits in her calendar" empty="None coming up.">{s.visits.map((v, i) => <div className="row" key={i}><span>{v.title}</span><span className="muted">{fmt(v.at)}</span></div>)}</Section>}
      {s.questions && <Section title="Questions she wants to ask" empty="None right now.">{s.questions.map((q, i) => <div className="row" key={i}><span>{q}</span></div>)}</Section>}
    </div>
  );
}
function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return <div style={{ marginTop: 10 }}><b style={{ fontSize: 13.5 }}>{title}</b>{children.length ? children : <div className="muted" style={{ fontSize: 13 }}>{empty}</div>}</div>;
}
