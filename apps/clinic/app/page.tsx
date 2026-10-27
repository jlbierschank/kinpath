import Link from "next/link";
import { redirect } from "next/navigation";
import { IDS } from "@kinpath/db";
import { devLoginEnabled, getSession, homeFor } from "@/lib/session";
import { signIn } from "./actions";

const PEOPLE = [
  { id: IDS.mayaUser, name: "Maya Torres", what: "Patient at Bayside, stimulation day 6. Missed last night's Gonal-f." },
  { id: IDS.maria, name: "Maria Lopez, RN", what: "Bayside nurse. Works the queue and sends replies." },
  { id: IDS.jordan, name: "Jordan Torres", what: "Maya's partner. Sees only schedule and medications." },
  { id: IDS.priyaUser, name: "Priya Shah", what: "Bayside patient who prefers Spanish." },
  { id: IDS.kara, name: "Kara Diaz", what: "Bayside clinic admin. Reads the audit log, not clinical records." },
  { id: IDS.sam, name: "Sam Kim", what: "Bayside financial counselor. Estimates, coverage and payments. No clinical records." },
  { id: IDS.harborNurse, name: "Lee Grant, RN", what: "Nurse at a different clinic. Sees none of Bayside's patients." },
];

export default async function Home() {
  if (!devLoginEnabled()) {
    const s = await getSession();
    redirect(s ? homeFor(s.role) : "/login");
  }
  return (
    <>
      <h1>Who are you testing as?</h1>
      <p className="muted">Pick a person to see the app through their eyes. Try the loop: Maya reports a missed dose, then Maria answers it. Or <Link href="/login">sign in for real</Link> (staff password <code>bayside demo 2026</code>).</p>
      <div className="chooser">
        {PEOPLE.map((p) => (
          <form key={p.id} action={signIn}>
            <input type="hidden" name="userId" value={p.id} />
            <button type="submit"><b>{p.name}</b><span className="muted">{p.what}</span></button>
          </form>
        ))}
      </div>
    </>
  );
}
