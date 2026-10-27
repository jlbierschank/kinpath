#!/usr/bin/env node
/**
 * The Pumpkin waitlist for people starting on their own. Run against the production database
 * (after the server has started once, so migrations are applied).
 *
 *   DATABASE_URL=... node apps/clinic/scripts/waitlist.mjs status
 *   DATABASE_URL=... node apps/clinic/scripts/waitlist.mjs import waitlist.csv   # emails or phones from the website, one per line (or a column named email)
 *   DATABASE_URL=... node apps/clinic/scripts/waitlist.mjs let-in 25             # the next 25 people, oldest first
 *
 * Letting someone in queues an "It's your turn" message (no health details). Messages send once the
 * texting and email services are connected; until then they wait in the outbox.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const [cmd, arg] = process.argv.slice(2);
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL first."); process.exit(1); }
const contactOf = (s) => {
  const t = String(s).trim().toLowerCase().replace(/^"|"$/g, "");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { value: t, channel: "email" };
  const d = t.replace(/[^0-9+]/g, "");
  return /^\+?\d{10,15}$/.test(d) ? { value: d, channel: "sms" } : null;
};
const ssl = /sslmode=(require|verify-full|verify-ca)/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "1" } : undefined;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });
await db.connect();
try {
  if (cmd === "status") {
    const r = await db.query(`SELECT status, count(*)::int AS n FROM early_access GROUP BY status ORDER BY status`);
    for (const x of r.rows) console.log(`${x.status}: ${x.n}`);
    if (!r.rows.length) console.log("The waitlist is empty.");
  } else if (cmd === "import") {
    if (!arg) throw new Error("Give the file: import waitlist.csv");
    const lines = readFileSync(arg, "utf8").split(/\r?\n/);
    const header = lines[0].toLowerCase().split(",");
    const col = Math.max(0, header.findIndex((h) => /email|phone|contact/.test(h)));
    let added = 0, skipped = 0;
    for (const line of lines.slice(header.some((h) => /email|phone|contact/.test(h)) ? 1 : 0)) {
      const c = contactOf(line.split(",")[col] ?? "");
      if (!c) { if (line.trim()) skipped++; continue; }
      const r = await db.query(`INSERT INTO early_access (identifier, source) VALUES ($1,'site') ON CONFLICT (identifier) DO NOTHING RETURNING identifier`, [c.value]);
      added += r.rows.length;
    }
    console.log(`Added ${added} to the waitlist${skipped ? `; skipped ${skipped} lines that weren't an email or phone` : ""}.`);
  } else if (cmd === "let-in") {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error("How many? let-in 25 (1 to 500)");
    const r = await db.query(`UPDATE early_access SET status = 'invited', invited_at = now()
      WHERE identifier IN (SELECT identifier FROM early_access WHERE status = 'waiting' ORDER BY added_at LIMIT $1) RETURNING identifier`, [n]);
    for (const { identifier } of r.rows) {
      const c = contactOf(identifier);
      await db.query(`INSERT INTO outbox (clinic_id, user_id, channel, to_address, subject, body, status) VALUES ('pumpkin', NULL, $1, $2, $3, $4, 'send')`,
        [c.channel, c.value, "It's your turn on Pumpkin", `It's your turn. Get the Pumpkin app, choose "Start on my own", and use this ${c.channel === "email" ? "email" : "number"}. We'll send you a code.`]);
    }
    console.log(`Let in ${r.rows.length}. Each was sent an "It's your turn" message.`);
  } else {
    console.log("Commands: status | import <file> | let-in <how many>");
  }
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  await db.end();
}
