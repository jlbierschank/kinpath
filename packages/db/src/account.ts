/**
 * Account settings (your own profile) and team management (clinic admins).
 * Profile and team changes run under row-level security plus the users_guard trigger.
 */
import { HandoffError, type Role } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";
import { createStaffSetupLink, revokeAllSessions } from "./auth";

export const STAFF_ROLES: Role[] = ["nurse", "physician", "financial_counselor", "scheduler", "clinic_admin"];
export const ROLE_LABEL: Record<string, string> = {
  nurse: "Nurse", physician: "Physician", financial_counselor: "Financial counselor", scheduler: "Scheduler", clinic_admin: "Clinic admin",
};

export async function myProfile(db: Db, actor: Actor) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ display_name: string; title: string | null; signature: string | null; preferred_lang: "en" | "es"; email: string; role: Role }>(
      `SELECT display_name, title, signature, preferred_lang, email, role FROM app_users WHERE id = $1`, [actor.userId]);
    const u = r.rows[0]!;
    return { name: u.display_name, title: u.title ?? "", signature: u.signature ?? "", lang: u.preferred_lang, email: u.email, role: u.role };
  });
}

export async function updateMyProfile(db: Db, actor: Actor, input: { name: string; title: string; signature: string; lang: string }) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new HandoffError("Add your name.");
  if (input.title.length > 80) throw new HandoffError("Keep your title under 80 characters.");
  if (input.signature.length > 200) throw new HandoffError("Keep your signature under 200 characters.");
  if (!["en", "es"].includes(input.lang)) throw new HandoffError("Choose a language.");
  return asActor(db, actor, async (tx) => {
    await tx.query(`UPDATE app_users SET display_name = $2, title = $3, signature = $4, preferred_lang = $5 WHERE id = $1`,
      [actor.userId, name, input.title.trim() || null, input.signature.trim() || null, input.lang]);
    await audit(tx, actor, "account.updated_profile", null, {});
    return true;
  });
}

function requireAdmin(a: Actor) {
  if (a.role !== "clinic_admin") throw new HandoffError("Only clinic admins can manage the team.");
}

export async function teamList(db: Db, admin: Actor) {
  requireAdmin(admin);
  const rows = await asActor(db, admin, async (tx) => (await tx.query<{ id: string; display_name: string; email: string; role: Role; title: string | null; deactivated_at: Date | null }>(
    `SELECT id, display_name, email, role, title, deactivated_at FROM app_users WHERE role NOT IN ('patient','partner') ORDER BY deactivated_at NULLS FIRST, display_name`)).rows);
  // Sign-in status comes from the auth service (credentials are never readable by the app role).
  const ids = rows.map((r) => r.id);
  const cred = await db.query<{ user_id: string; password_hash: string | null; totp_enabled_at: Date | null }>(`SELECT user_id, password_hash, totp_enabled_at FROM user_credentials WHERE user_id = ANY($1::uuid[])`, [ids]);
  const last = await db.query<{ user_id: string; at: Date }>(`SELECT user_id, max(last_seen_at) AS at FROM sessions WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`, [ids]);
  return rows.map((r) => {
    const c = cred.rows.find((x) => x.user_id === r.id);
    const l = last.rows.find((x) => x.user_id === r.id);
    return {
      id: r.id, name: r.display_name, email: r.email, role: r.role, title: r.title, active: !r.deactivated_at, you: r.id === admin.userId,
      setUp: !!c?.password_hash, twoStepOn: !!c?.totp_enabled_at, lastSeen: l ? new Date(l.at).toISOString() : null,
    };
  });
}

export async function inviteStaff(db: Db, admin: Actor, input: { name: string; email: string; role: string; title?: string }, baseUrl: string) {
  requireAdmin(admin);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new HandoffError("Add their name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HandoffError("Enter their work email.");
  if (!STAFF_ROLES.includes(input.role as Role)) throw new HandoffError("Choose a role.");
  const exists = await db.query(`SELECT 1 FROM app_users WHERE lower(email) = $1`, [email]);
  if (exists.rows.length) throw new HandoffError("Someone with that email already has an account.");
  const id = await asActor(db, admin, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app_users (clinic_id, role, display_name, email, title) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [admin.clinicId, input.role, name, email, input.title?.trim() || null]);
    await audit(tx, admin, "team.invited", null, { userId: r.rows[0]!.id, role: input.role });
    return r.rows[0]!.id;
  });
  const link = await createStaffSetupLink(db, id, baseUrl);
  return { id, link };
}

export async function resendSetup(db: Db, admin: Actor, userId: string, baseUrl: string) {
  requireAdmin(admin);
  const ok = await asActor(db, admin, async (tx) => (await tx.query(`SELECT 1 FROM app_users WHERE id = $1 AND role NOT IN ('patient','partner') AND deactivated_at IS NULL`, [userId])).rows.length > 0);
  if (!ok) throw new HandoffError("That person isn't on your team.");
  return createStaffSetupLink(db, userId, baseUrl);
}

async function activeAdmins(db: Db, admin: Actor) {
  return asActor(db, admin, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM app_users WHERE role = 'clinic_admin' AND deactivated_at IS NULL`)).rows[0]!.n);
}

export async function changeRole(db: Db, admin: Actor, userId: string, role: string) {
  requireAdmin(admin);
  if (!STAFF_ROLES.includes(role as Role)) throw new HandoffError("Choose a role.");
  if (userId === admin.userId) throw new HandoffError("You can't change your own role. Ask another admin.");
  return asActor(db, admin, async (tx) => {
    const r = await tx.query<{ role: Role }>(`SELECT role FROM app_users WHERE id = $1`, [userId]);
    if (!r.rows[0]) throw new HandoffError("That person isn't on your team.");
    await tx.query(`UPDATE app_users SET role = $2 WHERE id = $1`, [userId, role]);
    await audit(tx, admin, "team.changed_role", null, { userId, from: r.rows[0].role, to: role });
    return true;
  });
}

export async function setStaffActive(db: Db, admin: Actor, userId: string, active: boolean) {
  requireAdmin(admin);
  if (userId === admin.userId) throw new HandoffError("You can't deactivate yourself. Ask another admin.");
  const target = await asActor(db, admin, async (tx) => (await tx.query<{ role: Role }>(`SELECT role FROM app_users WHERE id = $1 AND role NOT IN ('patient','partner')`, [userId])).rows[0]);
  if (!target) throw new HandoffError("That person isn't on your team.");
  if (!active && target.role === "clinic_admin" && (await activeAdmins(db, admin)) <= 1) throw new HandoffError("Your clinic needs at least one admin.");
  await asActor(db, admin, async (tx) => {
    await tx.query(`UPDATE app_users SET deactivated_at = ${active ? "NULL" : "now()"} WHERE id = $1`, [userId]);
    await audit(tx, admin, active ? "team.reactivated" : "team.deactivated", null, { userId });
  });
  if (!active) await revokeAllSessions(db, userId);
  return true;
}
