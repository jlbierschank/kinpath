import { NextResponse } from "next/server";
import { jwksFor } from "@kinpath/db";
import { getDb } from "@/lib/db";

/** Pumpkin's public key for this clinic, for the EHR vendor to check Pumpkin's sign-in. Public by design. */
export async function GET(_req: Request, { params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  const jwks = /^[a-z0-9-]{1,40}$/.test(clinic) ? await jwksFor(await getDb(), clinic) : null;
  if (!jwks) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(jwks, { headers: { "Cache-Control": "public, max-age=300" } });
}
