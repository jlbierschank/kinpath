import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@kinpath/db";
import type { Role } from "@kinpath/core";
import { getDb } from "./db";

/**
 * DEV SIGN-IN ONLY. Picks a synthetic person from the seed data with a cookie.
 * Before any real patient uses Kinpath this is replaced with real authentication
 * (staff SSO with MFA, patient passwordless login) as described in docs/ROADMAP.md.
 */
export interface Session extends Actor {
  name: string;
  /** For patients: their own record. For partners: the patient who shared with them. */
  patientId: string | null;
}

export async function getSession(): Promise<Session | null> {
  const id = (await cookies()).get("kp_dev_user")?.value;
  if (!id) return null;
  const db = await getDb();
  // Identity lookup runs as the owner, like an auth service would. All data access after this uses RLS.
  const u = await db.query<{ id: string; clinic_id: string; role: Role; display_name: string }>(
    `SELECT id, clinic_id, role, display_name FROM app_users WHERE id = $1`, [id]);
  const user = u.rows[0];
  if (!user) return null;
  let patientId: string | null = null;
  if (user.role === "patient") {
    patientId = (await db.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [user.id])).rows[0]?.id ?? null;
  } else if (user.role === "partner") {
    patientId = (await db.query<{ patient_id: string }>(`SELECT patient_id FROM partner_grants WHERE partner_user_id = $1 ORDER BY created_at LIMIT 1`, [user.id])).rows[0]?.patient_id ?? null;
  }
  return { userId: user.id, clinicId: user.clinic_id, role: user.role, name: user.display_name, patientId };
}

export async function requireSession(roles: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s || !roles.includes(s.role)) redirect("/");
  return s;
}

export function homeFor(role: Role): string {
  if (role === "patient") return "/patient";
  if (role === "partner") return "/partner";
  if (role === "clinic_admin") return "/admin";
  return "/nurse";
}
