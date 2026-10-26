/**
 * Database access. In development and tests this runs an embedded Postgres (PGlite), so no
 * server is needed. In production the same SQL runs on managed Postgres under a HIPAA BAA.
 *
 * Every query runs inside `asActor`, which switches to the restricted kp_app role and sets the
 * user, clinic and role for row-level security. There is no other way to read patient data.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "@kinpath/core";

export type Db = PGlite;
export type Tx = Transaction;

export interface Actor {
  userId: string;
  clinicId: string;
  role: Role;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function openDb(dataDir?: string): Promise<Db> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS kp_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const done = await db.query<{ name: string }>(`SELECT name FROM kp_migrations WHERE name = $1`, [file]);
    if (done.rows.length > 0) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(join(migrationsDir, file), "utf8"));
      await tx.query(`INSERT INTO kp_migrations (name) VALUES ($1)`, [file]);
    });
  }
}

/** Run `fn` as a specific person. Row-level security applies to everything inside. */
export async function asActor<T>(db: Db, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.role', $3, true)`,
      [actor.userId, actor.clinicId, actor.role],
    );
    await tx.exec(`SET LOCAL ROLE kp_app`);
    return fn(tx);
  });
}

export async function audit(tx: Tx, actor: Actor, action: string, patientId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (clinic_id, actor_user_id, action, patient_id, detail) VALUES ($1, $2, $3, $4, $5)`,
    [actor.clinicId, actor.userId, action, patientId, JSON.stringify(detail)],
  );
}
