import Link from "next/link";
import { myNotifications } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { markAllReadAction, openNotificationAction } from "./actions";

const ALL = ["nurse", "physician", "financial_counselor", "scheduler", "clinic_admin", "patient", "partner"] as const;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default async function Notifications() {
  const s = await requireSession([...ALL]);
  const n = await myNotifications(await getDb(), s, 50);
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div><h1>Notifications</h1><p className="muted" style={{ margin: 0 }}>{n.unread ? `${n.unread} unread` : "You're all caught up."}</p></div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/account?tab=notifications">Settings</Link>
          {n.unread > 0 && <form action={markAllReadAction}><button className="btn btn-line" type="submit">Mark all read</button></form>}
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        {n.items.length === 0 && <span className="muted">Nothing yet.</span>}
        {n.items.map((x) => (
          <form key={x.id} action={openNotificationAction} className="row" style={{ alignItems: "center" }}>
            <input type="hidden" name="id" value={x.id} /><input type="hidden" name="link" value={x.link ?? ""} />
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: x.read ? "transparent" : x.urgent ? "var(--red)" : "var(--lav-ink)" }} />
              <span>
                {x.urgent && <span className="pill p-red" style={{ marginRight: 6 }}>Urgent</span>}
                <span style={{ fontWeight: x.read ? 400 : 700 }}>{x.title}</span><br /><span className="muted" style={{ fontSize: 12.5 }}>{ago(x.at)}</span>
              </span>
            </span>
            <button className="linkbtn" type="submit">{x.link ? "Open" : x.read ? "" : "Mark read"}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
