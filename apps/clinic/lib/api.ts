import "server-only";
import { NextResponse } from "next/server";
import { isHandoffError } from "@kinpath/core";
import type { Role } from "@kinpath/core";
import { sessionFromToken } from "@kinpath/db";
import { getDb } from "./db";
import { devLoginEnabled, type Session } from "./session";

/**
 * API auth for the phone app: "Authorization: Bearer <session token>" from real sign-in.
 * The "Dev <user id>" shortcut only works in demo builds (KINPATH_DEV_LOGIN=1 or pnpm dev).
 *
 * CORS: the phone app doesn't need it (native requests). It's only for the app's web preview,
 * so it's open in demo builds and limited to KINPATH_ALLOWED_ORIGINS otherwise.
 */
function corsFor(req?: Request): Record<string, string> {
  const allowed = (process.env.KINPATH_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req?.headers.get("origin") ?? "";
  const allow = devLoginEnabled() ? "*" : allowed.includes(origin) ? origin : "";
  return {
    ...(allow ? { "Access-Control-Allow-Origin": allow, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}
export const CORS = corsFor();

export function preflight(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsFor(req) });
}

export function bearer(req: Request): string | null {
  return /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
}

export async function apiSession(req: Request, roles: Role[]): Promise<Session | null> {
  const db = await getDb();
  const token = bearer(req);
  let base: { userId: string; clinicId: string; role: Role; name: string } | null = null;
  if (token) {
    const s = await sessionFromToken(db, token);
    if (s && s.mfaPassed) base = s;
  } else if (devLoginEnabled()) {
    const m = /^Dev ([0-9a-f-]{36})$/i.exec(req.headers.get("authorization") ?? "");
    if (m) {
      const u = await db.query<{ id: string; clinic_id: string; role: Role; display_name: string; deactivated_at: Date | null }>(
        `SELECT id, clinic_id, role, display_name, deactivated_at FROM app_users WHERE id = $1`, [m[1]]);
      const user = u.rows[0];
      if (user && !user.deactivated_at) base = { userId: user.id, clinicId: user.clinic_id, role: user.role, name: user.display_name };
    }
  }
  if (!base || !roles.includes(base.role)) return null;
  const p = await db.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [base.userId]);
  return { ...base, patientId: p.rows[0]?.id ?? null, token, mfaPassed: true, demo: !token };
}

export function json(req: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsFor(req) });
}

export async function handle(req: Request, roles: Role[], fn: (s: Session) => Promise<unknown>) {
  const s = await apiSession(req, roles);
  if (!s) return json(req, { error: "Please sign in again." }, 401);
  try {
    return json(req, await fn(s));
  } catch (e) {
    if (!isHandoffError(e)) console.error(e);
    return json(req, { error: isHandoffError(e) ? e.message : "Something went wrong." }, isHandoffError(e) ? 400 : 500);
  }
}

/** For sign-in endpoints, which run before there's a session. */
export async function open(req: Request, fn: () => Promise<unknown>) {
  try {
    return json(req, await fn());
  } catch (e) {
    if (!isHandoffError(e)) console.error(e);
    return json(req, { error: isHandoffError(e) ? e.message : "Something went wrong." }, isHandoffError(e) ? 400 : 500);
  }
}
