import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate, type Db } from "../src";

const run = promisify(execFile);
const PORT = 55437;
const SCRIPT = path.resolve(__dirname, "../../../apps/clinic/scripts/waitlist.mjs");
let server: PGLiteSocketServer; let pglite: PGlite;
const sh = (...args: string[]) => run("node", [SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: `postgres://postgres@127.0.0.1:${PORT}/postgres` }, cwd: path.resolve(__dirname, "../../../apps/clinic") }).then((r) => r.stdout.trim());

beforeAll(async () => {
  pglite = new PGlite(); await pglite.waitReady; await migrate(pglite as unknown as Db);
  server = new PGLiteSocketServer({ db: pglite, port: PORT, host: "127.0.0.1" }); await server.start();
});
afterAll(async () => { await server.stop(); await pglite.close(); });

it("imports the website's list and lets people in oldest first", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wl-"));
  const file = path.join(dir, "list.csv");
  writeFileSync(file, "email,created\nfirst@example.com,1\nnot-an-email,2\n(813) 555-0142,3\nfirst@example.com,4\n");
  expect(await sh("import", file)).toBe("Added 2 to the waitlist; skipped 1 lines that weren't an email or phone.");
  expect(await sh("let-in", "1")).toBe('Let in 1. Each was sent an "It\'s your turn" message.');
  expect(await sh("status")).toBe("invited: 1\nwaiting: 1");
  const out = await pglite.query<{ to_address: string; subject: string }>(`SELECT to_address, subject FROM outbox`);
  expect(out.rows).toEqual([{ to_address: "first@example.com", subject: "It's your turn on Pumpkin" }]);
}, 60_000);
