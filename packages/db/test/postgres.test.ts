/**
 * Runs Kinpath's migrations and key flows through the real Postgres wire protocol, using the
 * same node-postgres adapter production uses with DATABASE_URL. (The server here is PGlite
 * speaking the Postgres protocol, so the test needs no installed database.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  asActor, DEMO_STAFF_PASSWORD, IDS, migrate, myNotifications, nurseQueue, patientWait, PgDb, recordTransfer, seed, sendPatientMessage, sessionFromToken, staffSignIn,
  type Actor,
} from "../src";

const PORT = 55432 + Math.floor(Math.random() * 1000);
let server: PGLiteSocketServer;
let pglite: PGlite;
let db: PgDb;
const maya: Actor = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };

beforeAll(async () => {
  pglite = await PGlite.create();
  server = new PGLiteSocketServer({ db: pglite, port: PORT, host: "127.0.0.1" });
  await server.start();
  db = new PgDb(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { max: 1 });
  await migrate(db as never);
  await seed(db as never);
}, 60_000);

afterAll(async () => {
  await db?.close();
  await server?.stop();
  await pglite?.close();
});

describe("on Postgres through node-postgres (production path)", () => {
  it("applies every migration once", async () => {
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM kp_migrations`);
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(10);
    await migrate(db as never); // running again changes nothing
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM kp_migrations`)).rows[0]!.n).toBe(r.rows[0]!.n);
  });

  it("enforces row-level security inside transactions", async () => {
    expect((await asActor(db as never, maya, (tx) => tx.query(`SELECT * FROM patients`))).rows).toHaveLength(1);
    await expect(asActor(db as never, maya, (tx) => tx.query(`SELECT * FROM sessions`))).rejects.toThrow();
  });

  it("rolls back a failed transaction completely", async () => {
    await expect(db.transaction(async (tx) => { await tx.query(`INSERT INTO clinics (id, name) VALUES ('temp', 'Temp')`); throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await db.query(`SELECT * FROM clinics WHERE id = 'temp'`)).rows).toHaveLength(0);
  });

  it("runs sign-in, messaging, notifications and the wait end to end", async () => {
    const s = await staffSignIn(db as never, "maria@bayside.example", DEMO_STAFF_PASSWORD);
    expect((await sessionFromToken(db as never, s.token))!.userId).toBe(IDS.maria);
    await sendPatientMessage(db as never, maya, { patientId: IDS.maya, text: "I have chest pain" });
    expect((await nurseQueue(db as never, maria))[0]!.kind).toBe("urgent_symptom");
    expect((await myNotifications(db as never, maria)).unread).toBe(1);
    const today = new Date();
    const d = (n: number) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
    await recordTransfer(db as never, maria, { patientId: IDS.maya, transferOn: d(0).toISOString().slice(0, 10), testAt: d(9).toISOString() });
    const w = await patientWait(db as never, maya, IDS.maya, today);
    expect(w.stage).toBe("wait");
    expect(typeof w.testAt).toBe("string");
  });
});
