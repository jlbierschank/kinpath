/**
 * The beta test build (KINPATH_TEST_MODE=1): open sign-up, a "made-up information only" banner,
 * and feedback from inside the app. Feedback is emailed to the team (KINPATH_TEAM_EMAIL) and kept.
 */
import { HandoffError } from "@kinpath/core";
import type { Actor, Db } from "./client";
import { sendDirect } from "./notify";

export const testMode = () => process.env.KINPATH_TEST_MODE === "1";
export const teamEmail = () => process.env.KINPATH_TEAM_EMAIL?.trim() || null;

/** Saves a tester's feedback and emails it to the team. Who sent it is shown by first name only. */
export async function sendFeedback(db: Db, actor: Actor, input: { body: string; screen?: string; appVersion?: string }) {
  const body = String(input.body ?? "").trim().slice(0, 2000);
  if (!body) throw new HandoffError("Write a few words first.");
  const screen = input.screen ? String(input.screen).slice(0, 60) : null;
  await db.query(`INSERT INTO feedback (user_id, screen, body, app_version) VALUES ($1,$2,$3,$4)`,
    [actor.userId, screen, body, input.appVersion ? String(input.appVersion).slice(0, 40) : null]);
  const to = teamEmail();
  if (to) {
    const who = (await db.query<{ display_name: string; email: string }>(`SELECT display_name, email FROM app_users WHERE id = $1`, [actor.userId])).rows[0];
    await sendDirect(db, {
      clinicId: "pumpkin", userId: null, channel: "email", to,
      subject: `Pumpkin feedback${screen ? ` (${screen})` : ""}`,
      body: `From: ${who?.display_name?.split(" ")[0] ?? "a tester"}${who?.email?.includes("@") ? ` <${who.email}>` : ""}\nScreen: ${screen ?? "not given"}\nVersion: ${input.appVersion ?? "not given"}\n\n${body}`,
    });
  }
  return { ok: true };
}

/** Recent feedback, newest first, for the team. */
export async function recentFeedback(db: Db, limit = 100) {
  return (await db.query<{ id: string; screen: string | null; body: string; app_version: string | null; created_at: Date; name: string | null; email: string | null }>(
    `SELECT f.id, f.screen, f.body, f.app_version, f.created_at, u.display_name AS name, u.email
       FROM feedback f LEFT JOIN app_users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT $1`, [limit])).rows;
}

/** Tells the team a patient asked her clinic to join. Only the clinic's name and the count; nothing about her. */
export async function tellTeamClinicAsked(db: Db, clinicName: string) {
  const to = teamEmail();
  if (!to) return;
  const n = Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM clinic_requests WHERE lower(clinic_name) = lower($1)`, [clinicName])).rows[0]?.n ?? 1);
  await sendDirect(db, {
    clinicId: "pumpkin", userId: null, channel: "email", to,
    subject: `A patient asked ${clinicName} to join Pumpkin`,
    body: `Someone using Pumpkin on their own asked their clinic to join: ${clinicName}.\n\nPatients who have asked for this clinic so far: ${n}.\n\nNo patient details are included. Reply to the clinic directly.`,
  });
}
