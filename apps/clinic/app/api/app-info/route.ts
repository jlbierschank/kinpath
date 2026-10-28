import { NextResponse } from "next/server";
import { openSignup, testMode } from "@kinpath/db";
import { devLoginEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Public: what kind of build this is, so the app can show the test banner before sign-in. */
export async function GET() {
  return NextResponse.json({ testMode: testMode(), demo: devLoginEnabled(), openSignup: openSignup() });
}
