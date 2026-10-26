import { IDS } from "@kinpath/db";
import { signIn } from "./actions";

const PEOPLE = [
  { id: IDS.mayaUser, name: "Maya Torres", what: "Patient at Bayside, stimulation day 6. Missed last night's Gonal-f." },
  { id: IDS.maria, name: "Maria Lopez, RN", what: "Bayside nurse. Works the queue and sends replies." },
  { id: IDS.jordan, name: "Jordan Torres", what: "Maya's partner. Sees only schedule and medications." },
  { id: IDS.priyaUser, name: "Priya Shah", what: "Bayside patient who prefers Spanish." },
  { id: IDS.kara, name: "Kara Diaz", what: "Bayside clinic admin. Reads the audit log, not clinical records." },
  { id: IDS.harborNurse, name: "Lee Grant, RN", what: "Nurse at a different clinic. Sees none of Bayside's patients." },
];

export default function Home() {
  return (
    <>
      <h1>Who are you testing as?</h1>
      <p className="muted">Pick a person to see the app through their eyes. Try the loop: Maya reports a missed dose, then Maria answers it.</p>
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
