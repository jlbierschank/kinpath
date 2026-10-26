import { NextResponse } from "next/server";
import { isHandoffError } from "@kinpath/core";
import { acceptInvite } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { CORS, preflight } from "@/lib/api";

/**
 * The invited person enters their code. No sign-in yet: this is the sign-up step.
 * Before launch: rate-limit by IP and device, and confirm their phone or email with a one-time link.
 */
export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { code?: string; name?: string };
  try {
    return NextResponse.json(await acceptInvite(await getDb(), String(b.code ?? ""), String(b.name ?? "")), { headers: CORS });
  } catch (e) {
    if (!isHandoffError(e)) console.error(e);
    return NextResponse.json({ error: isHandoffError(e) ? e.message : "Something went wrong." }, { status: isHandoffError(e) ? 400 : 500, headers: CORS });
  }
}
