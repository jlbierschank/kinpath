/**
 * Notifications: the in-app inbox, each person's choices, and the outbox for push, text and email.
 *
 * notify() runs as the system (like a background job), after the action that caused it has
 * committed. It decides delivery with @kinpath/core's planDelivery, so the rules are tested on
 * their own. A failed notification never undoes the action that caused it.
 */
import {
  audienceOf, channelsFor, checkChannelChange, DEFAULT_DELIVERY, KINDS, kindsFor, outsideText, planDelivery,
  HandoffError, type Channel, type DeliveryPrefs, type NotificationKind,
} from "@kinpath/core";
import { asActor, type Actor, type Db, type Tx } from "./client";

type Q = Pick<Db, "query"> | Tx;

export interface NotifyEvent {
  clinicId: string;
  kind: NotificationKind;
  /** Shown in the app only (behind sign-in). Never sent by push, text or email. */
  title: string;
  link?: string;
  /** Specific people, or every active nurse and physician at the clinic. */
  to: { userIds: string[] } | { clinicians: true };
  /** Don't notify the person who caused it. */
  except?: string;
}

async function loadPrefs(q: Q, userId: string): Promise<DeliveryPrefs> {
  const p = await q.query<{ kind: string; in_app: boolean | null; push: boolean | null; sms: boolean | null; email: boolean | null }>(
    `SELECT kind, in_app, push, sms, email FROM notification_prefs WHERE user_id = $1`, [userId]);
  const s = await q.query<{ quiet_on: boolean; quiet_start: string; quiet_end: string; digest: DeliveryPrefs["digest"] }>(
    `SELECT quiet_on, quiet_start::text, quiet_end::text, digest FROM user_settings WHERE user_id = $1`, [userId]);
  const channels: DeliveryPrefs["channels"] = {};
  for (const r of p.rows) {
    const c: Partial<Record<Channel, boolean>> = {};
    for (const ch of ["in_app", "push", "sms", "email"] as const) if (r[ch] !== null) c[ch] = r[ch]!;
    channels[r.kind as NotificationKind] = c;
  }
  const row = s.rows[0];
  return {
    channels,
    quiet: row ? { on: row.quiet_on, start: row.quiet_start.slice(0, 5), end: row.quiet_end.slice(0, 5) } : DEFAULT_DELIVERY.quiet,
    digest: row?.digest ?? "off",
  };
}

export async function notify(db: Db, ev: NotifyEvent, now = new Date()): Promise<number> {
  try {
    const clinic = (await db.query<{ name: string }>(`SELECT name FROM clinics WHERE id = $1`, [ev.clinicId])).rows[0]?.name ?? "your clinic";
    const people = "clinicians" in ev.to
      ? await db.query<{ id: string; email: string; preferred_lang: "en" | "es" }>(
          `SELECT id, email, preferred_lang FROM app_users WHERE clinic_id = $1 AND role IN ('nurse','physician') AND deactivated_at IS NULL`, [ev.clinicId])
      : await db.query<{ id: string; email: string; preferred_lang: "en" | "es" }>(
          `SELECT id, email, preferred_lang FROM app_users WHERE id = ANY($1::uuid[]) AND clinic_id = $2 AND deactivated_at IS NULL`, [ev.to.userIds, ev.clinicId]);
    let n = 0;
    for (const u of people.rows) {
      if (u.id === ev.except) continue;
      const prefs = await loadPrefs(db, u.id);
      const plan = planDelivery(ev.kind, prefs, now);
      if (plan.inApp) {
        await db.query(`INSERT INTO notifications (clinic_id, user_id, kind, title, link, urgent) VALUES ($1,$2,$3,$4,$5,$6)`,
          [ev.clinicId, u.id, ev.kind, ev.title, ev.link ?? null, KINDS[ev.kind].urgent === true]);
      }
      const phone = (await db.query<{ phone: string | null }>(`SELECT phone FROM user_settings WHERE user_id = $1`, [u.id])).rows[0]?.phone
        ?? (/^\+?\d{10,15}$/.test(u.email) ? u.email : null);
      const text = outsideText(ev.kind, clinic, u.preferred_lang);
      for (const o of plan.outside) {
        const to = o.channel === "email" ? (u.email.includes("@") ? u.email : null) : o.channel === "sms" ? phone : "this person's phone";
        if (!to) continue;
        await db.query(`INSERT INTO outbox (clinic_id, user_id, channel, to_address, subject, body, status, send_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ev.clinicId, u.id, o.channel, to, text.subject, text.body, o.status, o.sendAfter.toISOString()]);
      }
      n++;
    }
    return n;
  } catch (e) {
    console.error("notify failed", e);
    return 0;
  }
}

/** Sign-in codes, setup links and security notices also go through the outbox. */
export async function sendDirect(db: Db, input: { clinicId: string; userId: string | null; channel: "sms" | "email"; to: string; subject: string; body: string }) {
  await db.query(`INSERT INTO outbox (clinic_id, user_id, channel, to_address, subject, body, status) VALUES ($1,$2,$3,$4,$5,$6,'send')`,
    [input.clinicId, input.userId, input.channel, input.to, input.subject, input.body]);
}

// ---------- the person's own inbox and settings ----------

export async function myNotifications(db: Db, actor: Actor, limit = 30) {
  return asActor(db, actor, async (tx) => {
    const r = await tx.query<{ id: string; kind: string; title: string; link: string | null; urgent: boolean; created_at: Date; read_at: Date | null }>(
      `SELECT id, kind, title, link, urgent, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [actor.userId, limit]);
    const u = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [actor.userId]);
    return {
      unread: u.rows[0]!.n,
      items: r.rows.map((x) => ({ id: x.id, kind: x.kind, title: x.title, link: x.link, urgent: x.urgent, at: new Date(x.created_at).toISOString(), read: x.read_at !== null })),
    };
  });
}

export async function markNotificationsRead(db: Db, actor: Actor, ids: string[] | "all") {
  return asActor(db, actor, async (tx) => {
    if (ids === "all") await tx.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [actor.userId]);
    else await tx.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`, [actor.userId, ids]);
    return true;
  });
}

export async function notificationSettings(db: Db, actor: Actor) {
  return asActor(db, actor, async (tx) => {
    const prefs = await loadPrefs(tx, actor.userId);
    const audience = audienceOf(actor.role);
    const phone = (await tx.query<{ phone: string | null }>(`SELECT phone FROM user_settings WHERE user_id = $1`, [actor.userId])).rows[0]?.phone ?? null;
    return {
      audience,
      kinds: kindsFor(audience).map((k) => ({ kind: k, label: KINDS[k].label, description: KINDS[k].description, urgent: KINDS[k].urgent === true, channels: channelsFor(k, prefs) })),
      quiet: prefs.quiet,
      digest: prefs.digest,
      phone,
    };
  });
}

export async function setNotificationChannels(db: Db, actor: Actor, kind: string, change: Partial<Record<Channel, boolean>>) {
  const k = kind as NotificationKind;
  if (!KINDS[k] || KINDS[k].audience !== audienceOf(actor.role)) throw new HandoffError("That alert isn't one of yours.");
  return asActor(db, actor, async (tx) => {
    const current = channelsFor(k, await loadPrefs(tx, actor.userId));
    const next = { ...current, ...change };
    const why = checkChannelChange(k, next);
    if (why) throw new HandoffError(why);
    await tx.query(
      `INSERT INTO notification_prefs (user_id, kind, in_app, push, sms, email) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, kind) DO UPDATE SET in_app = EXCLUDED.in_app, push = EXCLUDED.push, sms = EXCLUDED.sms, email = EXCLUDED.email`,
      [actor.userId, k, next.in_app, next.push, next.sms, next.email]);
    return next;
  });
}

export async function setDeliverySettings(db: Db, actor: Actor, change: { quiet?: { on: boolean; start: string; end: string }; digest?: string; phone?: string | null }) {
  if (change.quiet && (!/^\d{2}:\d{2}$/.test(change.quiet.start) || !/^\d{2}:\d{2}$/.test(change.quiet.end))) throw new HandoffError("Choose start and end times.");
  if (change.digest !== undefined) {
    if (!["off", "morning", "evening"].includes(change.digest)) throw new HandoffError("Choose when to get your summary.");
    if (audienceOf(actor.role) !== "staff") throw new HandoffError("Summaries are for clinic staff.");
  }
  let phone = change.phone;
  if (phone !== undefined && phone !== null) {
    phone = phone.replace(/[^0-9+]/g, "");
    if (phone === "") phone = null;
    else if (!/^\+?\d{10,15}$/.test(phone)) throw new HandoffError("Enter a mobile number with area code.");
  }
  return asActor(db, actor, async (tx) => {
    await tx.query(`INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [actor.userId]);
    if (change.quiet) await tx.query(`UPDATE user_settings SET quiet_on = $2, quiet_start = $3, quiet_end = $4 WHERE user_id = $1`, [actor.userId, change.quiet.on, change.quiet.start, change.quiet.end]);
    if (change.digest !== undefined) await tx.query(`UPDATE user_settings SET digest = $2 WHERE user_id = $1`, [actor.userId, change.digest]);
    if (phone !== undefined) await tx.query(`UPDATE user_settings SET phone = $2 WHERE user_id = $1`, [actor.userId, phone]);
    return true;
  });
}

/** Dev only: what would have been sent. */
export async function devOutbox(db: Db, limit = 50) {
  const r = await db.query<{ id: number; channel: string; to_address: string | null; subject: string; body: string; status: string; send_after: Date; created_at: Date; name: string | null }>(
    `SELECT o.id, o.channel, o.to_address, o.subject, o.body, o.status, o.send_after, o.created_at, u.display_name AS name
       FROM outbox o LEFT JOIN app_users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT $1`, [limit]);
  return r.rows.map((x) => ({ ...x, send_after: new Date(x.send_after).toISOString(), created_at: new Date(x.created_at).toISOString() }));
}

// ---------- small lookups for the alerts below (system reads) ----------
export async function patientInfo(db: Db, patientId: string) {
  const r = await db.query<{ user_id: string; first_name: string; last_name: string; clinic_id: string }>(`SELECT user_id, first_name, last_name, clinic_id FROM patients WHERE id = $1`, [patientId]);
  return r.rows[0] ?? null;
}
export async function supportPeople(db: Db, patientId: string, section?: string) {
  const r = await db.query<{ partner_user_id: string }>(
    `SELECT partner_user_id FROM partner_grants WHERE patient_id = $1 AND revoked_at IS NULL AND removed_at IS NULL ${section ? "AND $2 = ANY(sections)" : ""}`,
    section ? [patientId, section] : [patientId]);
  return r.rows.map((x) => x.partner_user_id);
}

/** A patient message reached the queue: urgent ones alert every nurse and physician right away. */
export async function alertStaffOfMessage(db: Db, patientId: string, handoffId: string, kind: string) {
  const p = await patientInfo(db, patientId);
  if (!p) return;
  const urgent = kind === "urgent_symptom" || kind === "crisis";
  const what = kind === "crisis" ? "crisis: call now" : kind === "urgent_symptom" ? "urgent symptom: call now" : kind === "missed_dose" ? "missed dose" : "new message";
  await notify(db, { clinicId: p.clinic_id, kind: urgent ? "urgent_message" : "new_message", title: `${p.first_name} ${p.last_name} · ${what}`, link: `/nurse/${handoffId}`, to: { clinicians: true } });
}
export async function alertStaffOfCall(db: Db, patientId: string, reason: string) {
  const p = await patientInfo(db, patientId);
  if (p) await notify(db, { clinicId: p.clinic_id, kind: "call_to_make", title: `${p.first_name} ${p.last_name} · ${reason}`, link: `/nurse/patients/${patientId}`, to: { clinicians: true } });
}
export async function alertPatient(db: Db, patientId: string, kind: NotificationKind, title: string, link?: string) {
  const p = await patientInfo(db, patientId);
  if (p) await notify(db, { clinicId: p.clinic_id, kind, title, link, to: { userIds: [p.user_id] } });
}
