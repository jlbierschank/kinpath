/**
 * Sends what's waiting in the outbox: email through Resend or Postmark, texts through Twilio.
 * Nothing in the outbox carries health details (see notify.ts), so this only moves sign-in codes,
 * setup links and "you have something new in Pumpkin" alerts.
 *
 * Off until a provider is set. Without one, messages stay in the outbox for the Dev outbox page.
 */
import type { Db } from "./client";

export type OutMessage = { channel: "email" | "sms"; to: string; subject: string; body: string };
export type Sender = (m: OutMessage) => Promise<void>;
export type Senders = { email?: Sender; sms?: Sender };

const MAX_ATTEMPTS = 5;
/** A sign-in code that couldn't go out within this window is useless; don't send it late. */
const STALE_MINUTES = 30;

type Env = Record<string, string | undefined>;

async function check(res: Response, who: string) {
  if (res.ok) return;
  let detail = "";
  try { detail = (await res.text()).slice(0, 160); } catch { /* ignore */ }
  throw new Error(`${who} said ${res.status}${detail ? `: ${detail}` : ""}`);
}

/** Builds the senders from settings. Returns what's on, in words, for the startup log. */
export function sendersFromEnv(env: Env = process.env, f: typeof fetch = fetch): Senders & { on: string[]; problems: string[] } {
  const out: Senders & { on: string[]; problems: string[] } = { on: [], problems: [] };
  const emailProvider = env.KINPATH_EMAIL_PROVIDER?.trim().toLowerCase();
  if (emailProvider) {
    const key = env.KINPATH_EMAIL_KEY, from = env.KINPATH_EMAIL_FROM;
    if (!key || !from) out.problems.push("Email is turned on, but KINPATH_EMAIL_KEY or KINPATH_EMAIL_FROM is missing.");
    else if (emailProvider === "resend") {
      out.email = async (m) => check(await f("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.body }),
      }), "Resend");
      out.on.push("email (Resend)");
    } else if (emailProvider === "postmark") {
      out.email = async (m) => check(await f("https://api.postmarkapp.com/email", {
        method: "POST", headers: { "X-Postmark-Server-Token": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ From: from, To: m.to, Subject: m.subject, TextBody: m.body, MessageStream: env.KINPATH_EMAIL_STREAM || "outbound" }),
      }), "Postmark");
      out.on.push("email (Postmark)");
    } else out.problems.push(`KINPATH_EMAIL_PROVIDER "${emailProvider}" isn't one Pumpkin knows. Use resend or postmark.`);
  }
  const smsProvider = env.KINPATH_SMS_PROVIDER?.trim().toLowerCase();
  if (smsProvider) {
    const sid = env.KINPATH_TWILIO_SID, token = env.KINPATH_TWILIO_TOKEN, from = env.KINPATH_SMS_FROM;
    if (smsProvider !== "twilio") out.problems.push(`KINPATH_SMS_PROVIDER "${smsProvider}" isn't one Pumpkin knows. Use twilio.`);
    else if (!sid || !token || !from) out.problems.push("Texts are turned on, but KINPATH_TWILIO_SID, KINPATH_TWILIO_TOKEN or KINPATH_SMS_FROM is missing.");
    else {
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      out.sms = async (m) => {
        const form = new URLSearchParams({ To: m.to, Body: m.body });
        form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
        await check(await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
        }), "Twilio");
      };
      out.on.push("texts (Twilio)");
    }
  }
  return out;
}

const redact = (s: string) => s.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email]").replace(/\+?\d[\d\s-]{6,}\d/g, "[number]").slice(0, 300);

/** Sends what's due, oldest first. Returns counts. Safe to call on a timer. */
export async function deliverDue(db: Db, senders: Senders, now = new Date(), limit = 25) {
  const channels = (["email", "sms"] as const).filter((c) => senders[c]);
  const result = { sent: 0, failed: 0, retry: 0 };
  if (!channels.length) return result;
  const due = (await db.query<{ id: number; channel: "email" | "sms"; to_address: string | null; subject: string; body: string; attempts: number; created_at: Date }>(
    `SELECT id, channel, to_address, subject, body, attempts, created_at FROM outbox
      WHERE status = 'send' AND send_after <= $1 AND channel = ANY($2::text[]) ORDER BY id LIMIT $3`,
    [now.toISOString(), channels, limit])).rows;
  for (const m of due) {
    const stale = now.getTime() - new Date(m.created_at).getTime() > STALE_MINUTES * 60_000 && /code/i.test(m.subject);
    if (!m.to_address || stale) {
      await db.query(`UPDATE outbox SET status = 'failed', last_error = $2 WHERE id = $1`, [m.id, !m.to_address ? "No address on file." : "Too old to send (a sign-in code)."]);
      result.failed++;
      continue;
    }
    try {
      await senders[m.channel]!({ channel: m.channel, to: m.to_address, subject: m.subject, body: m.body });
      await db.query(`UPDATE outbox SET status = 'sent', sent_at = $2, attempts = attempts + 1, last_error = NULL WHERE id = $1`, [m.id, now.toISOString()]);
      result.sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const next = new Date(now.getTime() + 2 ** attempts * 60_000);
      await db.query(`UPDATE outbox SET attempts = $2, last_error = $3, status = $4, send_after = $5 WHERE id = $1`,
        [m.id, attempts, redact(String((e as Error)?.message ?? e)), giveUp ? "failed" : "send", next.toISOString()]);
      if (giveUp) result.failed++; else result.retry++;
    }
  }
  return result;
}
