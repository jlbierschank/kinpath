import "server-only";
import { migrate, openDb, seed, type Db } from "@kinpath/db";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Development database: an embedded Postgres stored in apps/clinic/.data (git-ignored),
 * filled with SYNTHETIC data on first run. Never point this at real patient data.
 */
const dir = process.env.KINPATH_DB_DIR ?? path.join(process.cwd(), ".data", "pglite");
const g = globalThis as unknown as { __kinpathDb?: Promise<Db> };

async function boot(): Promise<Db> {
  await mkdir(path.dirname(dir), { recursive: true });
  const db = await openDb(dir);
  await migrate(db);
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM clinics`);
  if (r.rows[0]!.n === 0) await seed(db, new Date());
  return db;
}

export function getDb(): Promise<Db> {
  if (!g.__kinpathDb) {
    // If startup fails, forget the failed attempt so the next request retries.
    g.__kinpathDb = boot().catch((e) => { g.__kinpathDb = undefined; throw e; });
  }
  return g.__kinpathDb;
}

export async function resetDb(): Promise<void> {
  const current = g.__kinpathDb;
  g.__kinpathDb = undefined;
  if (current) await (await current).close();
  await rm(dir, { recursive: true, force: true });
}
