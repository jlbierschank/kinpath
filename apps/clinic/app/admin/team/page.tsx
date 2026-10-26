import { ROLE_LABEL, STAFF_ROLES, teamList } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { changeRoleAction, inviteStaffAction, resendSetupAction, setActiveAction } from "./actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Never");

export default async function Team({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession(["clinic_admin"]);
  const team = await teamList(await getDb(), s);
  return (
    <>
      <h1>Team</h1>
      <p className="muted">Everyone at Bayside who can sign in to The Pumpkin. Every change here is recorded in the audit log.</p>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}
      <div>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Sign-in</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} data-testid={`member-${m.email}`} style={m.active ? undefined : { opacity: 0.55 }}>
                  <td><b>{m.name}</b>{m.you && <span className="pill p-lav" style={{ marginLeft: 6 }}>You</span>}<br /><span className="muted" style={{ fontSize: 13 }}>{m.email}</span></td>
                  <td>
                    {m.you || !m.active ? ROLE_LABEL[m.role] : (
                      <form action={changeRoleAction} style={{ display: "flex", gap: 6 }}>
                        <input type="hidden" name="userId" value={m.id} />
                        <select name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`} style={{ minWidth: 150 }}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                        <button className="btn btn-line" type="submit" style={{ padding: "6px 10px" }}>Save</button>
                      </form>
                    )}
                  </td>
                  <td>
                    {!m.active ? <span className="pill p-clay">Deactivated</span>
                      : !m.setUp ? <span className="pill p-clay">Invited</span>
                      : m.twoStepOn ? <span className="pill p-sage">Two-step on</span>
                      : <span className="pill p-lav">Needs two-step</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{when(m.lastSeen)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!m.you && m.active && !m.setUp && (
                      <form action={resendSetupAction} style={{ display: "inline" }}><input type="hidden" name="userId" value={m.id} /><button className="linkbtn" type="submit">Resend link</button></form>
                    )}
                    {!m.you && (
                      <form action={setActiveAction} style={{ display: "inline", marginLeft: 8 }}>
                        <input type="hidden" name="userId" value={m.id} /><input type="hidden" name="active" value={m.active ? "no" : "yes"} />
                        <button className="linkbtn" type="submit" style={{ color: m.active ? "var(--clay-ink)" : undefined }}>{m.active ? "Deactivate" : "Reactivate"}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card" action={inviteStaffAction} style={{ maxWidth: 620 }}>
          <h2 style={{ marginTop: 0 }}>Invite someone</h2>
          <label htmlFor="name">Name</label><input id="name" name="name" required placeholder="Tess Nguyen, RN" />
          <label htmlFor="email">Work email</label><input id="email" name="email" type="email" required placeholder="tess@bayside.example" />
          <label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="nurse">{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <label htmlFor="title">Title (optional)</label><input id="title" name="title" placeholder="IVF nurse" />
          <div style={{ marginTop: 12 }}><button className="btn btn-dark" type="submit">Send invite</button></div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>They get an email to set a password, then set up two-step sign-in. Patients and their support people join from the phone app instead.</p>
        </form>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>What each role can see</h2>
        <table>
          <tbody>
            <tr><td><b>Nurse, Physician</b></td><td>The queue, patients&apos; schedules, medications, results and messages; can reply and edit clinic settings.</td></tr>
            <tr><td><b>Financial counselor</b></td><td>Billing and payment information. No clinical records.</td></tr>
            <tr><td><b>Scheduler</b></td><td>Schedules. No results or messages.</td></tr>
            <tr><td><b>Clinic admin</b></td><td>The team, the audit log and clinic settings (view only). No clinical records.</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
