#!/usr/bin/env node
/**
 * Creates a clinic and its first admin in a production database, and prints a one-time link
 * for that admin to set a password (valid 72 hours). Run once per clinic, after the server has
 * started at least once (which applies the database migrations).
 *
 *   DATABASE_URL=... node apps/clinic/scripts/bootstrap.mjs \
 *     --clinic-id bayside --clinic-name "Bayside Fertility" \
 *     --admin-name "Kara Diaz" --admin-email kara@baysidefertility.com \
 *     --base-url https://bayside.thepumpkin.ai
 */
import crypto from "node:crypto";
import pg from "pg";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const need = ["clinic-id", "clinic-name", "admin-name", "admin-email", "base-url"];
const missing = need.filter((k) => !args[k]);
if (missing.length) { console.error(`Missing: ${missing.map((m) => `--${m}`).join(", ")}`); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL first."); process.exit(1); }
if (!/^[a-z0-9-]{2,40}$/.test(args["clinic-id"])) { console.error("--clinic-id: lowercase letters, numbers and dashes."); process.exit(1); }

const ssl = /sslmode=(require|verify-full|verify-ca)/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "1" } : undefined;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });
await db.connect();
try {
  const m = await db.query(`SELECT count(*)::int AS n FROM kp_migrations`).catch(() => null);
  if (!m || m.rows[0].n === 0) throw new Error("The database has no tables yet. Start the server once so it applies migrations, then run this again.");
  await db.query("BEGIN");
  await db.query(`INSERT INTO clinics (id, name) VALUES ($1, $2)`, [args["clinic-id"], args["clinic-name"]]);
  const u = await db.query(`INSERT INTO app_users (clinic_id, role, display_name, email) VALUES ($1, 'clinic_admin', $2, $3) RETURNING id`,
    [args["clinic-id"], args["admin-name"], args["admin-email"].toLowerCase()]);
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(`INSERT INTO sign_in_codes (purpose, user_id, code_hash, expires_at) VALUES ('setup', $1, $2, now() + interval '72 hours')`,
    [u.rows[0].id, crypto.createHash("sha256").update(token).digest("hex")]);
  await db.query(`INSERT INTO audit_events (clinic_id, actor_user_id, action, detail) VALUES ($1, $2, 'clinic.bootstrapped', '{}')`, [args["clinic-id"], u.rows[0].id]);
  await db.query("COMMIT");
  console.log(`Created ${args["clinic-name"]} and its first admin, ${args["admin-name"]}.`);
  console.log(`Send this one-time link to ${args["admin-email"]} (valid 72 hours):`);
  console.log(`${args["base-url"].replace(/\/$/, "")}/login/setup?t=${token}`);
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  const msg = /clinics_pkey/.test(e.message) ? `A clinic with the id "${args["clinic-id"]}" already exists.`
    : /app_users_clinic_id_email_key|duplicate key/.test(e.message) ? "Someone with that email already has an account." : e.message;
  console.error(`Not created: ${msg}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
