import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionFromToken, type Actor } from "@kinpath/db";
import type { Role } from "@kinpath/core";
import { getDb } from "./db";

/**
 * Sign-in for the web app.
 *
 * Real sign-in: a "kp_session" cookie holding a random token (only its hash is in the database).
 * Staff need password + two-step; patients and support people use one-time codes.
 *
 * "Pick a person" demo sign-in still works when KINPATH_DEV_LOGIN=1 or in development
 * (pnpm dev). It is off in any production build unless that variable is set on purpose.
 */
export const SESSION_COOKIE = "kp_session";
export const devLoginEnabled = () => process.env.KINPATH_DEV_LOGIN === "1" || process.env.NODE_ENV !== "production";

export interface Session extends Actor {
  name: string;
  /** For patients: their own record. For partners: the patient who shared with them. */
  patientId: string | null;
  /** The raw session token for account actions (password, sign out others). Null for demo sign-in. */
  token: string | null;
  mfaPassed: boolean;
  demo: boolean;
}

async function patientFor(userId: string, role: Role): Promise<string | null> {
  const db = await getDb();
  if (role === "patient") return (await db.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [userId])).rows[0]?.id ?? null;
  if (role === "partner") return (await db.query<{ patient_id: string }>(`SELECT patient_id FROM partner_grants WHERE partner_user_id = $1 AND removed_at IS NULL ORDER BY created_at LIMIT 1`, [userId])).rows[0]?.patient_id ?? null;
  return null;
}

/** Any session, including a staff session still waiting for its two-step code. */
export async function getAnySession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const db = await getDb();
  if (token) {
    const s = await sessionFromToken(db, token);
    if (s) return { userId: s.userId, clinicId: s.clinicId, role: s.role, name: s.name, patientId: await patientFor(s.userId, s.role), token, mfaPassed: s.mfaPassed, demo: false };
  }
  const demo = devLoginEnabled() ? jar.get("kp_dev_user")?.value : undefined;
  if (demo) {
    // Identity lookup runs as the owner, like an auth service would. All data access after this uses RLS.
    const u = await db.query<{ id: string; clinic_id: string; role: Role; display_name: string; deactivated_at: Date | null }>(
      `SELECT id, clinic_id, role, display_name, deactivated_at FROM app_users WHERE id = $1`, [demo]);
    const user = u.rows[0];
    if (user && !user.deactivated_at) return { userId: user.id, clinicId: user.clinic_id, role: user.role, name: user.display_name, patientId: await patientFor(user.id, user.role), token: null, mfaPassed: true, demo: true };
  }
  return null;
}

/** A fully signed-in session (two-step done for staff), or null. */
export async function getSession(): Promise<Session | null> {
  const s = await getAnySession();
  return s && s.mfaPassed ? s : null;
}

export async function requireSession(roles: Role[]): Promise<Session> {
  const s = await getAnySession();
  if (!s) redirect("/login");
  if (!s.mfaPassed) redirect("/login/two-step");
  if (!roles.includes(s.role)) redirect(homeFor(s.role));
  return s;
}

export function homeFor(role: Role): string {
  if (role === "patient") return "/patient";
  if (role === "partner") return "/partner";
  if (role === "clinic_admin") return "/admin";
  if (role === "nurse" || role === "physician") return "/nurse";
  if (role === "scheduler") return "/patients";
  if (role === "financial_counselor") return "/money";
  return "/account";
}

export async function deviceLabel(): Promise<string> {
  const ua = (await headers()).get("user-agent") ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "";
  return os ? `${browser} on ${os}` : browser;
}

export async function baseUrl(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}

export async function setSessionCookie(token: string, staff: boolean) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" && process.env.KINPATH_INSECURE_COOKIES !== "1",
    maxAge: staff ? 12 * 3600 : 30 * 24 * 3600,
  });
}
