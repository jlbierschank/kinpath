import Link from "next/link";
import { ROLE_LABEL, myProfile, mySessions, notificationSettings, twoStepStatus } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { changePasswordAction, saveNotificationsAction, saveProfileAction, signOutOthersAction } from "./actions";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CH = [["in_app", "In app"], ["push", "Push"], ["sms", "Text"], ["email", "Email"]] as const;
const ALL = ["nurse", "physician", "financial_counselor", "scheduler", "clinic_admin", "patient", "partner"] as const;

export default async function Account({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession([...ALL]);
  const db = await getDb();
  const tab = sp.tab === "security" || sp.tab === "notifications" ? sp.tab : "profile";
  const p = await myProfile(db, s);
  const staff = s.role !== "patient" && s.role !== "partner";

  return (
    <>
      <h1>Your account</h1>
      <p className="muted">{p.email} · {ROLE_LABEL[p.role] ?? (p.role === "partner" ? "Support person" : "Patient")}</p>
      <nav className="tabs" aria-label="Account sections">
        <Link href="/account" className={tab === "profile" ? "on" : ""}>Profile</Link>
        <Link href="/account?tab=security" className={tab === "security" ? "on" : ""}>Sign-in and security</Link>
        <Link href="/account?tab=notifications" className={tab === "notifications" ? "on" : ""}>Notifications</Link>
      </nav>
      {sp.error && <div className="card urgent" role="alert"><b>Not saved.</b> {sp.error}</div>}
      {sp.saved && <div className="note" role="status" style={{ marginBottom: 12, background: "var(--sage)", borderColor: "var(--sage)", color: "var(--sage-ink)" }}>{sp.saved}</div>}

      {tab === "profile" && (
        <form className="card" action={saveProfileAction} style={{ maxWidth: 620 }}>
          <label htmlFor="name">Name as patients see it</label>
          <input id="name" name="name" defaultValue={p.name} required maxLength={80} />
          {staff && <>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" defaultValue={p.title} maxLength={80} placeholder="IVF nurse" />
            <label htmlFor="signature">Reply signature</label>
            <input id="signature" name="signature" defaultValue={p.signature} maxLength={200} placeholder="— Maria, Bayside nursing team" />
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>Shown under replies you send. The Pumpkin still adds &ldquo;Drafted with The Pumpkin, reviewed by you&rdquo; when a draft helped.</p>
          </>}
          <label htmlFor="lang">Language</label>
          <select id="lang" name="lang" defaultValue={p.lang}><option value="en">English</option><option value="es">Español</option></select>
          <div style={{ marginTop: 14 }}><button className="btn btn-dark" type="submit">Save profile</button></div>
        </form>
      )}

      {tab === "security" && <Security token={s.token} userId={s.userId} staff={staff} />}
      {tab === "notifications" && <Notifications s={s} />}
    </>
  );

  async function Security({ token, userId, staff }: { token: string | null; userId: string; staff: boolean }) {
    const st = await twoStepStatus(db, userId);
    const sessions = token ? await mySessions(db, token) : [];
    return (
      <div className="grid">
        <div>
          {staff && (
            <form className="card" action={changePasswordAction}>
              <h2 style={{ marginTop: 0 }}>Password</h2>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>{st.passwordChangedAt ? `Last changed ${when(st.passwordChangedAt)}.` : "Not set yet."} Changing it signs out your other devices.</p>
              <label htmlFor="current">Current password</label><input id="current" name="current" type="password" autoComplete="current-password" required />
              <label htmlFor="next">New password</label><input id="next" name="next" type="password" autoComplete="new-password" minLength={12} required />
              <label htmlFor="confirm">Type the new one again</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
              <div style={{ marginTop: 12 }}><button className="btn btn-dark" type="submit">Change password</button></div>
            </form>
          )}
          {!staff && <div className="card"><h2 style={{ marginTop: 0 }}>How you sign in</h2><p style={{ margin: 0 }}>With a one-time code sent to your phone or email. There&apos;s no password to remember or lose.</p></div>}
          {staff && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Two-step sign-in</h2>
              <p style={{ margin: 0 }}>{st.twoStepOn ? <><span className="pill p-sage">On</span> You enter a code from your authenticator app each time you sign in. Required for clinic staff.</> : <><span className="pill p-clay">Not set up</span> You&apos;ll be asked to set it up the next time you sign in with your password.</>}</p>
              <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>New phone? Ask your clinic admin to reset it.</p>
            </div>
          )}
        </div>
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Where you&apos;re signed in</h2>
            {!token && <p className="muted" style={{ margin: 0 }}>You&apos;re using demo sign-in, so there are no real sessions to show. <Link href="/login">Sign in for real</Link> to see this.</p>}
            {sessions.map((x) => (
              <div className="row" key={x.id}><span><b>{x.device}</b>{x.current && <span className="pill p-lav" style={{ marginLeft: 8 }}>This device</span>}<br /><span className="muted" style={{ fontSize: 13 }}>Signed in {when(x.createdAt)} · active {when(x.lastSeenAt)}</span></span></div>
            ))}
            {sessions.length > 1 && <form action={signOutOthersAction} style={{ marginTop: 10 }}><button className="btn btn-line" type="submit">Sign out of other devices</button></form>}
            {staff && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>For patient privacy, you&apos;re signed out after 30 minutes without activity.</p>}
          </div>
        </div>
      </div>
    );
  }

  async function Notifications({ s }: { s: Awaited<ReturnType<typeof requireSession>> }) {
    const n = await notificationSettings(db, s);
    return (
      <form action={saveNotificationsAction} style={{ maxWidth: 820 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Which alerts, and how</h2>
          <div className="switchrow" aria-hidden="true"><span /> {CH.map(([, l]) => <span className="h" key={l}>{l}</span>)}</div>
          {n.kinds.map((k) => (
            <div className="switchrow" key={k.kind} data-testid={`pref-${k.kind}`}>
              <div>
                <b>{k.label.en}</b> {k.urgent && <span className="pill p-red" style={{ marginLeft: 4 }}>Always on</span>}
                <div className="muted" style={{ fontSize: 13 }}>{k.description.en}</div>
              </div>
              {CH.map(([ch, l]) => (
                <input key={ch} type="checkbox" name={`${k.kind}.${ch}`} aria-label={`${k.label.en}: ${l}`} defaultChecked={k.channels[ch]} disabled={k.urgent && ch === "in_app"} />
              ))}
              {k.urgent && <input type="hidden" name={`${k.kind}.in_app`} value="on" />}
            </div>
          ))}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Push, text and email never include health details, only &ldquo;You have a new update.&rdquo; Details stay in the app behind sign-in.</p>
        </div>
        <div className="grid">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Quiet hours</h2>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}><input type="checkbox" name="quiet_on" defaultChecked={n.quiet.on} style={{ width: "auto" }} /> Hold push, text and email during these hours</label>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label htmlFor="qs">From</label><input id="qs" name="quiet_start" type="time" defaultValue={n.quiet.start} /></div>
              <div style={{ flex: 1 }}><label htmlFor="qe">Until</label><input id="qe" name="quiet_end" type="time" defaultValue={n.quiet.end} /></div>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Held alerts arrive when quiet hours end.{n.audience === "staff" ? " Urgent safety alerts always come through." : ""}</p>
          </div>
          <div className="card">
            {n.audience === "staff" && <>
              <h2 style={{ marginTop: 0 }}>Summary instead of one by one</h2>
              <label htmlFor="digest">Text and email for non-urgent alerts</label>
              <select id="digest" name="digest" defaultValue={n.digest}><option value="off">Send each one</option><option value="morning">One summary at 8 am</option><option value="evening">One summary at 5 pm</option></select>
            </>}
            <h2 style={{ marginTop: n.audience === "staff" ? 18 : 0 }}>Mobile number for texts</h2>
            <input name="phone" defaultValue={n.phone ?? ""} placeholder="(813) 555-0142" aria-label="Mobile number for texts" />
          </div>
        </div>
        <button className="btn btn-dark" type="submit">Save notification settings</button>
      </form>
    );
  }
}
