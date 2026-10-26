import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { DEMO_COOKIE, passToken } from "@/lib/demo-gate";

const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") ? n : "/");

export async function POST(req: Request) {
  const passcode = process.env.KINPATH_DEMO_PASSCODE;
  const form = await req.formData();
  const next = safeNext(String(form.get("next") ?? "/"));
  const given = String(form.get("passcode") ?? "").trim();
  const ok = !!passcode && given.length === passcode.length && timingSafeEqual(Buffer.from(given), Buffer.from(passcode));
  const base = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? base.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? base.host;
  const origin = `${proto}://${host}`;
  if (!ok) return NextResponse.redirect(`${origin}/demo-pass?wrong=1&next=${encodeURIComponent(next)}`, 303);
  const res = NextResponse.redirect(`${origin}${next}`, 303);
  res.cookies.set(DEMO_COOKIE, await passToken(passcode!), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600,
    secure: process.env.NODE_ENV === "production" && process.env.KINPATH_INSECURE_COOKIES !== "1",
  });
  return res;
}
