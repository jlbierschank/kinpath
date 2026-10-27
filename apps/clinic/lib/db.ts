import "server-only";
import { migrate, openConfiguredDb, seed, type Db } from "@kinpath/db";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { checkConfig } from "./config";

/**
 * Production: DATABASE_URL points at managed Postgres (under a signed BAA). Migrations run at
 * startup; no demo data is ever added.
 * Development: an embedded Postgres in apps/clinic/.data (git-ignored), filled with SYNTHETIC
 * data on first run. Never point the demo build at real patient data.
 */
const dir = process.env.KINPATH_DB_DIR ?? path.join(process.cwd(), ".data", "pglite");
const g = globalThis as unknown as { __kinpathDb?: Promise<Db> };
const managed = () => !!process.env.DATABASE_URL;

async function boot(): Promise<Db> {
  checkConfig();
  if (!managed()) await mkdir(path.dirname(dir), { recursive: true });
  const db = await openConfiguredDb(dir);
  await migrate(db);
  if (!managed() || process.env.KINPATH_SEED_DEMO === "1") {
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM clinics WHERE kind <> 'system'`);
    if (r.rows[0]!.n === 0) await seed(db, new Date());
  }
  return db;
}

export function getDb(): Promise<Db> {
  if (!g.__kinpathDb) {
    // If startup fails, forget the failed attempt so the next request retries.
    g.__kinpathDb = boot().catch((e) => { g.__kinpathDb = undefined; throw e; });
  }
  return g.__kinpathDb;
}

/** Demo builds only: wipe the embedded database. Never runs against managed Postgres. */
export async function resetDb(): Promise<void> {
  if (managed()) throw new Error("Reset is only for the demo database.");
  const current = g.__kinpathDb;
  g.__kinpathDb = undefined;
  if (current) await (await current).close();
  await rm(dir, { recursive: true, force: true });
}
