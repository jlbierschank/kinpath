import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { myNotifications, aiDraftingStatus } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { devLoginEnabled, getSession } from "@/lib/session";
import { resetDemo, signOut } from "./actions";
import { signOutAction } from "./login/actions";
import { AccountMenu } from "./account-menu";
import { Suspense } from "react";

export const metadata = { title: "Pumpkin" };
export const dynamic = "force-dynamic";

const initials = (n: string) => n.replace(/^Dr\.?\s+/, "").split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export default async function RootLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  const unread = s ? (await myNotifications(await getDb(), s, 1)).unread : 0;
  const staff = s && s.role !== "patient" && s.role !== "partner";
  const clinician = s && (s.role === "nurse" || s.role === "physician");
  return (
    <html lang="en">
      <body>
        {devLoginEnabled() && (
          <div className="devbar">
            <strong>Pumpkin dev build</strong>
            <span>Synthetic data only. No real patient information.</span>
            <span data-testid="ai-chip">{aiDraftingStatus().on ? "AI drafting: on" : "AI drafting: off"}</span>
            {s?.demo && <form action={signOut}><button type="submit">Switch person</button></form>}
            <a href="/phone" style={{ color: "#f6f1e8" }} data-testid="phone-link">Phone app</a>
            <Link href="/dev/outbox" style={{ color: "#f6f1e8" }}>Dev outbox</Link>
            {!process.env.DATABASE_URL && <form action={resetDemo}><button type="submit">Reset demo data</button></form>}
          </div>
        )}
        {s && (
          <nav className="topnav" aria-label="Main">
            <Link className="brand" href="/">Bayside Fertility</Link>
            {clinician && <Link href="/nurse">Queue</Link>}
            {s.role === "clinic_admin" && <Link href="/admin">Audit log</Link>}
            {s.role === "clinic_admin" && <Link href="/admin/team">Team</Link>}
            {s.role === "clinic_admin" && <Link href="/admin/records">Records connection</Link>}
            {staff && <Link href="/settings">Clinic settings</Link>}
            <Link className="bell" href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} data-testid="bell">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" fill="none" stroke="#2e211c" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              {unread > 0 && <span className="dot" data-testid="bell-count">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Suspense>
              <AccountMenu summary={<><span className="avatar">{initials(s.name)}</span><span>{s.name}</span></>}>
                <Link href="/account">Your account</Link>
                <Link href="/account?tab=notifications">Notification settings</Link>
                {s.role === "clinic_admin" && <Link href="/admin/team">Team</Link>}
                <form action={signOutAction}><button type="submit">Sign out</button></form>
              </AccountMenu>
            </Suspense>
          </nav>
        )}
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
