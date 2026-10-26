import "server-only";
import { NextResponse } from "next/server";
import { HandoffError } from "@kinpath/core";
import type { Role } from "@kinpath/core";
import { getDb } from "./db";
import type { Session } from "./session";

/**
 * DEV-ONLY API AUTH: the phone app sends "Authorization: Dev <user id>" for a synthetic seed user.
 * Replace with real tokens (passwordless sign-in, short-lived JWTs) before any real patient.
 */
const CORS = {
  "Access-Control-Allow-Origin": process.env.KINPATH_DEV_CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function apiSession(req: Request, roles: Role[]): Promise<Session | null> {
  const m = /^Dev ([0-9a-f-]{36})$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const db = await getDb();
  const u = await db.query<{ id: string; clinic_id: string; role: Role; display_name: string }>(
    `SELECT id, clinic_id, role, display_name FROM app_users WHERE id = $1`, [m[1]]);
  const user = u.rows[0];
  if (!user || !roles.includes(user.role)) return null;
  const p = await db.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [user.id]);
  return { userId: user.id, clinicId: user.clinic_id, role: user.role, name: user.display_name, patientId: p.rows[0]?.id ?? null };
}

export async function handle(req: Request, roles: Role[], fn: (s: Session) => Promise<unknown>) {
  const s = await apiSession(req, roles);
  if (!s) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: CORS });
  try {
    return NextResponse.json(await fn(s), { headers: CORS });
  } catch (e) {
    const msg = e instanceof HandoffError ? e.message : "Something went wrong.";
    if (!(e instanceof HandoffError)) console.error(e);
    return NextResponse.json({ error: msg }, { status: e instanceof HandoffError ? 400 : 500, headers: CORS });
  }
}
