import Link from "next/link";
import { pilotMetrics } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const WINDOWS = [7, 30, 90] as const;
const KIND_LABEL: Record<string, string> = {
  question: "Questions", missed_dose: "Missed doses", refill_request: "Refill requests", urgent_symptom: "Urgent symptoms", crisis: "Crisis messages",
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "None yet");
const per = (a: number, b: number) => (b ? (a / b).toFixed(1) : "None yet");
const hrs = (h: number | null) => (h === null ? "None yet" : h < 1 ? `${Math.round(h * 60)} min` : `${h} hr`);

/**
 * Pilot numbers, measured from what happens in Pumpkin. Counts only: no names, no messages.
 * Each number says how it's counted, so nothing reads as a claim it isn't.
 */
export default async function PilotPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["nurse", "physician", "clinic_admin"]);
  const days = WINDOWS.find((d) => String(d) === sp.days) ?? 30;
  const m = await pilotMetrics(await getDb(), s, days);
  const messages = Object.values(m.messages).reduce((a, b) => a + b, 0);
  const rows: [string, string, string][] = [
    ["Active cycles", String(m.activeCycles), "Cycles that started in this window or haven't finished."],
    ["Patients using Pumpkin", String(m.patientsUsing), "Sent a message, asked for a refill, or logged a dose."],
    ["Patients connected from their own Pumpkin", String(m.connectedPatients), "Confirmed connections that are on right now."],
    ["Calls logged per active cycle", per(m.callsLogged, m.activeCycles), `${m.callsLogged} calls logged in Pumpkin: urgent callbacks and finished call tasks. Calls taken outside Pumpkin aren't counted.`],
    ["Messages per active cycle", per(messages, m.activeCycles), `${messages} messages from patients. Results Pumpkin routes to you aren't counted.`],
    ["Typical reply time", hrs(m.medianReplyHours), "Median, for questions and missed doses that got a reply."],
    ["Typical urgent callback", m.medianUrgentMinutes === null ? "None yet" : `${m.medianUrgentMinutes} min`, "Median, from the message to the call being logged."],
    ["Refill requests", String(m.refills), `${m.refillsFromOwnPumpkin} from patients' own Pumpkin. Typical time to handle: ${hrs(m.medianRefillHours)}.`],
    ["Doses logged", pct(m.dosesLogged, m.dosesDue), `${m.dosesLogged} of ${m.dosesDue} scheduled doses marked taken.`],
    ["Consults that became cycles", pct(m.consultsToCycles, m.consults), `${m.consultsToCycles} of ${m.consults} patients with a consult in this window have started a cycle since.`],
  ];
  return (
    <>
      <p style={{ display: "flex", justifyContent: "space-between", margin: 0 }}>
        <Link href={s.role === "clinic_admin" ? "/admin" : "/nurse"}>← Back</Link>
        <span>{WINDOWS.map((d) => <Link key={d} href={`/pilot?days=${d}`} style={{ marginLeft: 12, fontWeight: d === days ? 700 : 400 }} aria-current={d === days ? "page" : undefined}>{d} days</Link>)}</span>
      </p>
      <h1>Pilot numbers</h1>
      <p className="muted">The last {m.days} days, measured from what happens in Pumpkin. Counts only, no names. To report a change, like fewer calls per cycle, compare these with the same numbers from before the pilot, counted the same way.</p>
      <div className="card" data-testid="pilot">
        <table>
          <thead><tr><th>Measure</th><th>Value</th><th>How it&apos;s counted</th></tr></thead>
          <tbody>
            {rows.map(([k, v, how]) => <tr key={k}><td><b>{k}</b></td><td style={{ whiteSpace: "nowrap" }} data-testid={`pilot-${k}`}>{v}</td><td className="muted" style={{ fontSize: 13.5 }}>{how}</td></tr>)}
          </tbody>
        </table>
      </div>
      <h2>Messages by kind</h2>
      <div className="card">
        {messages === 0 ? <p className="muted">No patient messages in this window.</p> : (
          <table><tbody>{Object.entries(m.messages).sort((a, b) => b[1] - a[1]).map(([k, n]) => <tr key={k}><td>{KIND_LABEL[k] ?? k}</td><td>{n}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
