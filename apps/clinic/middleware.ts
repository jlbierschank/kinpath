import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, passToken } from "./lib/demo-gate";

/** When KINPATH_DEMO_PASSCODE is set, every page and API call needs the demo passcode first. */
export async function middleware(req: NextRequest) {
  const passcode = process.env.KINPATH_DEMO_PASSCODE;
  if (!passcode) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname === "/demo-pass" || pathname === "/api/demo-pass" || pathname === "/api/health") return NextResponse.next();
  if (req.cookies.get(DEMO_COOKIE)?.value === (await passToken(passcode))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "This demo needs its passcode. Open the demo link first." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/demo-pass";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
