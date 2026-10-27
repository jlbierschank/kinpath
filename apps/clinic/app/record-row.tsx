import Link from "next/link";
import type { RecordToReview } from "@kinpath/db";
import { confirmRecordAction, dismissRecordAction } from "./nurse/records-actions";

const RKIND: Record<RecordToReview["kind"], [string, string]> = {
  result: ["Lab result", "p-lav"],
  hcg: ["Pregnancy test (hCG)", "p-clay"],
  med_order: ["New medication order", "p-clay"],
  med_stop: ["Order stopped", "p-clay"],
  appointment: ["Appointment", "p-lav"],
  coverage: ["Insurance", "p-lav"],
  ledger: ["Charge or payment", "p-lav"],
  estimate: ["Cost estimate", "p-clay"],
};
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function describe(r: RecordToReview): string {
  const d = r.data as Record<string, string | number | null>;
  const test: Record<string, string> = { estradiol: "Estradiol", progesterone: "Progesterone", lh: "LH", fsh: "FSH", hcg: "hCG" };
  if (r.kind === "coverage") return `${d.payerName ?? "Insurance"}${d.planName ? ` · ${d.planName}` : ""}${d.memberLast4 ? ` · member …${d.memberLast4}` : ""}`;
  if (r.kind === "ledger") return `${String(d.entryKind)[0]!.toUpperCase()}${String(d.entryKind).slice(1)} · ${d.description} · ${usd(Number(d.amountCents))} · ${d.occurredOn}`;
  if (r.kind === "estimate") { const lines = (r.data as { lines?: { amountCents: number }[] }).lines ?? []; return `${d.title} · ${lines.length} lines · ${usd(lines.reduce((a, l) => a + l.amountCents, 0))}`; }
  if (r.kind === "appointment") return `${d.title} · ${new Date(String(d.startsAt)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${d.location ? ` · ${d.location}` : ""}`;
  if (r.kind === "result" || r.kind === "hcg") return `${test[String(d.analyte)] ?? d.analyte} ${d.value} ${d.unit} · collected ${new Date(String(d.collectedAt)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = (hm: string) => { const [h, m] = hm.split(":").map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`; };
  const when = d.startsOn ? (d.endsOn && d.endsOn !== d.startsOn ? `${day(String(d.startsOn))} to ${day(String(d.endsOn))}` : day(String(d.startsOn))) : "no dates";
  return `${d.medication ?? "Unnamed medication"} · ${d.dose ?? "no dose"} at ${d.timeOfDay ? time(String(d.timeOfDay)) : "no time"} · ${when}`;
}

export function RecordRow({ r, patients, back }: { r: RecordToReview; patients: { id: string; name: string }[]; back: string }) {
  const link = back.startsWith("/money") ? `/money/${r.patientId}` : `/nurse/patients/${r.patientId}`;
  const first = r.patientName?.split(" ")[0] ?? "";
  const confirmLabel = r.kind === "coverage" ? `Add to ${first}'s coverage` : r.kind === "ledger" ? `Add to ${first}'s account` : r.kind === "estimate" ? `Add as a draft for ${first}` : r.kind === "appointment" ? `Add to ${first}'s appointments` : r.kind === "med_order" ? `Add to ${first}'s schedule` : r.kind === "med_stop" ? "Cancel remaining doses"
    : r.kind === "hcg" ? `Add to ${first}'s test` : `Add to ${first}'s results`;
  const ok = ["coverage", "ledger"].includes(r.kind) ? `Added to ${first}'s account.` : r.kind === "estimate" ? "Added as a draft. Review it and share it from her costs page." : r.kind === "med_order" ? `Added to ${first}'s schedule. She was told her schedule changed.` : r.kind === "med_stop" ? "Remaining doses canceled. She was told her schedule changed."
    : r.kind === "hcg" ? `hCG added to ${first}'s test. You decide the outcome on her page.` : "Result added.";
  const handledOnly = r.kind === "result" && /withdrew|different value/.test(r.reason);
  return (
    <div className="row" data-testid="record-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <b>{r.patientName ? <Link href={link}>{r.patientName}</Link> : `No match · MRN ${r.mrn ?? "missing"}`}</b>{" "}
          <span className={`pill ${RKIND[r.kind][1]}`}>{RKIND[r.kind][0]}</span>
          <div style={{ fontSize: 14 }}>{describe(r)}</div>
          <div className="muted" style={{ fontSize: 13 }}>{r.reason}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {handledOnly ? (
          <form action={dismissRecordAction}><input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="back" value={back} /><button className="btn btn-line" type="submit">Mark handled</button></form>
        ) : r.patientId && r.canConfirm && !/doesn.t match/.test(r.reason) ? (
          <form action={confirmRecordAction}>
            <input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="ok" value={ok} />
            <button className="btn btn-main" type="submit" data-testid="record-confirm">{confirmLabel}</button>
          </form>
        ) : r.canConfirm ? (
          <form action={confirmRecordAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="ok" value="Added to the patient you chose." />
            <select name="patientId" aria-label="Which patient is this?" required defaultValue={r.patientId ?? ""} style={{ minWidth: 180 }}>
              <option value="" disabled>Which patient is this?</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn btn-line" type="submit" data-testid="record-place">Add to this patient</button>
          </form>
        ) : null}
        {!handledOnly && <form action={dismissRecordAction}><input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="back" value={back} /><button className="linkbtn" type="submit">Dismiss</button></form>}
      </div>
    </div>
  );
}
