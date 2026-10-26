import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** For the hosting platform's health check. Says only whether the app and database are up. */
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await (await getDb()).query("SELECT 1");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
