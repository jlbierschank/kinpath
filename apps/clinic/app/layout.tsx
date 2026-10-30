import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { myClinicName, myNotifications, aiDraftingStatus } from "@kinpath/db";
import { cookies } from "next/headers";
import { ThemePicker, type ThemeChoice } from "./theme";
import { getDb } from "@/lib/db";
import { devLoginEnabled, getSession } from "@/lib/session";
import { resetDemo, signOut } from "./actions";
import { signOutAction } from "./login/actions";
import { AccountMenu } from "./account-menu";
import { NavLink } from "./navlink";
import { Suspense } from "react";

export const metadata = { title: "Pumpkin" };
export const dynamic = "force-dynamic";

const initials = (n: string) => n.replace(/^Dr\.?\s+/, "").split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export default async function RootLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  const unread = s ? (await myNotifications(await getDb(), s, 1)).unread : 0;
  const clinicName = s && s.role !== "patient" && s.role !== "partner" ? await myClinicName(await getDb(), s).catch(() => null) : null;
  const saved = (await cookies()).get("kp_theme")?.value;
  const theme: ThemeChoice = saved === "light" || saved === "dark" ? saved : "system";
  const staff = s && s.role !== "patient" && s.role !== "partner";
  const clinician = s && (s.role === "nurse" || s.role === "physician");
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body>
        {devLoginEnabled() && (
          <div className="devbar">
            <strong>Pumpkin dev build</strong>
            <span>Synthetic data only. No real patient information.</span>
            <span data-testid="ai-chip">{aiDraftingStatus().on ? "AI drafting: on" : "AI drafting: off"}</span>
            {s?.demo && <form action={signOut}><button type="submit">Switch person</button></form>}
            <a href="/phone" data-testid="phone-link">Phone app</a>
            <Link href="/dev/outbox">Dev outbox</Link>
            {!process.env.DATABASE_URL && <form action={resetDemo}><button type="submit">Reset demo data</button></form>}
          </div>
        )}
        {s && (
          <nav className="topnav" aria-label="Main">
            <Link className="brand" href="/" aria-label={clinicName ? `Pumpkin for ${clinicName}` : "Pumpkin"}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="logo-light" src="/brand/logo.png" alt="" width={96} height={30} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="logo-dark" src="/brand/logo-on-dark.png" alt="" width={96} height={30} />
              {clinicName && <span className="clinic">{clinicName}</span>}
            </Link>
            {clinician && <NavLink href="/nurse">Queue</NavLink>}
            {(clinician || s.role === "scheduler") && <NavLink href="/patients">Patients</NavLink>}
            {s.role === "financial_counselor" && <NavLink href="/money">Costs</NavLink>}
            {s.role === "clinic_admin" && <NavLink href="/money/partners">Financing options</NavLink>}
            {s.role === "clinic_admin" && <NavLink href="/admin">Audit log</NavLink>}
            {s.role === "clinic_admin" && <NavLink href="/admin/team">Team</NavLink>}
            {s.role === "clinic_admin" && <NavLink href="/admin/records">Records connection</NavLink>}
            {staff && <NavLink href="/settings">Clinic settings</NavLink>}
            <Link className="bell" href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} data-testid="bell">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              {unread > 0 && <span className="dot" data-testid="bell-count">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Suspense>
              <AccountMenu summary={<><span className="avatar">{initials(s.name)}</span><span>{s.name}</span></>}>
                <Link href="/account">Your account</Link>
                <Link href="/account?tab=notifications">Notification settings</Link>
                {s.role === "clinic_admin" && <Link href="/admin/team">Team</Link>}
                <form action={signOutAction}><button type="submit">Sign out</button></form>
                <ThemePicker initial={theme} />
              </AccountMenu>
            </Suspense>
          </nav>
        )}
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
