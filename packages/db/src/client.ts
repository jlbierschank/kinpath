/**
 * Database access. In development and tests this runs an embedded Postgres (PGlite), so no
 * server is needed. In production the same SQL runs on managed Postgres under a HIPAA BAA.
 *
 * Every query runs inside `asActor`, which switches to the restricted kp_app role and sets the
 * user, clinic and role for row-level security. There is no other way to read patient data.
 */
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { Role } from "@kinpath/core";
import { MIGRATIONS } from "./migrations.generated";

/** The small slice of a Postgres client Kinpath uses. Embedded PGlite and node-postgres both fit it. */
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
export interface Db extends Tx {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// node-postgres: keep DATE columns as "YYYY-MM-DD" strings (like the rest of the code expects),
// and bigints as numbers where they're small counts.
pg.types.setTypeParser(1082, (v: string) => v);

/** Managed Postgres in production (DATABASE_URL). Connections use TLS when the URL asks for it. */
export class PgDb implements Db {
  private pool: pg.Pool;
  constructor(connectionString: string, opts: { max?: number; ssl?: boolean | { rejectUnauthorized: boolean } } = {}) {
    this.pool = new pg.Pool({ connectionString, max: opts.max ?? 10, ssl: opts.ssl, idleTimeoutMillis: 30_000 });
  }
  async query<T>(sql: string, params?: unknown[]) { const r = await this.pool.query(sql, params as unknown[]); return { rows: r.rows as T[] }; }
  async exec(sql: string) { return this.pool.query(sql); }
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    const tx: Tx = {
      query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await c.query(sql, params as unknown[])).rows as R[] }),
      exec: (sql: string) => c.query(sql),
    };
    try {
      await c.query("BEGIN");
      const out = await fn(tx);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async close() { await this.pool.end(); }
}

export interface Actor {
  userId: string;
  clinicId: string;
  role: Role;
}

/** Embedded Postgres for development and tests (a folder on disk, or in memory). */
export async function openDb(dataDir?: string): Promise<Db> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return db as unknown as Db;
}

/** Production: DATABASE_URL set → managed Postgres. Otherwise the embedded database. */
export async function openConfiguredDb(dataDir?: string): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) return openDb(dataDir);
  const ssl = /sslmode=(require|verify-full|verify-ca)/.test(url) || process.env.DATABASE_SSL === "1"
    ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "1" } : undefined;
  return new PgDb(url, { ssl, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS kp_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const m of MIGRATIONS) {
    const done = await db.query<{ name: string }>(`SELECT name FROM kp_migrations WHERE name = $1`, [m.name]);
    if (done.rows.length > 0) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query(`INSERT INTO kp_migrations (name) VALUES ($1)`, [m.name]);
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
