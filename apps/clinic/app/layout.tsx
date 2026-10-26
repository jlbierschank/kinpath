import "./globals.css";
import type { ReactNode } from "react";
import { getSession } from "@/lib/session";
import { resetDemo, signOut } from "./actions";

export const metadata = { title: "Kinpath (dev)" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  return (
    <html lang="en">
      <body>
        <div className="devbar">
          <strong>Kinpath dev build</strong>
          <span>Synthetic data only. No real patient information.</span>
          {s && <span>Signed in as {s.name} ({s.role.replace("_", " ")})</span>}
          {s && <form action={signOut}><button type="submit">Switch person</button></form>}
          <form action={resetDemo}><button type="submit">Reset demo data</button></form>
        </div>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
