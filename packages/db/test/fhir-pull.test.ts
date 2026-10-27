import { createServer, type Server } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureFhirSource, fhirSource, IDS, jwksFor, migrate, openDb, patientResults, pullAllEnabled, pullFromFhir, recordsToReview, saveFhirSource,
  seed, upcomingAppointments, type Db,
} from "../src";

const kara = { userId: IDS.kara, clinicId: IDS.bayside, role: "clinic_admin" as const, name: "Kara Diaz" };
const maria = { userId: IDS.maria, clinicId: IDS.bayside, role: "nurse" as const, name: "Maria Lopez, RN" };
const maya = { userId: IDS.mayaUser, clinicId: IDS.bayside, role: "patient" as const };

/** A stand-in EHR: SMART Backend Services token endpoint plus a few FHIR searches. */
function fakeEhr(getJwks: () => Promise<{ keys: Record<string, unknown>[] } | null>) {
  const seenJti = new Set<string>();
  const calls: string[] = [];
  let base = "";
  const tomorrow = new Date(Date.now() + 86400_000); tomorrow.setUTCHours(12, 30, 0, 0);
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    const send = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/fhir/.well-known/smart-configuration") return send(200, { token_endpoint: `${base}/auth/token` });
    if (url.pathname === "/auth/token" && req.method === "POST") {
      let raw = ""; for await (const c of req) raw += c;
      const form = new URLSearchParams(raw);
      if (form.get("grant_type") !== "client_credentials" || form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return send(400, { error: "invalid_request" });
      const [h, b, s] = (form.get("client_assertion") ?? "").split(".");
      const head = JSON.parse(Buffer.from(h!, "base64url").toString()); const claims = JSON.parse(Buffer.from(b!, "base64url").toString());
      const jwk = (await getJwks())?.keys.find((k) => k.kid === head.kid);
      const sigOk = !!jwk && verify("sha384", Buffer.from(`${h}.${b}`), createPublicKey({ key: jwk as never, format: "jwk" }), Buffer.from(s!, "base64url"));
      const now = Date.now() / 1000;
      const ok = sigOk && head.alg === "RS384" && head.typ === "JWT" && claims.iss === "pumpkin-123" && claims.sub === claims.iss
        && claims.aud === `${base}/auth/token` && claims.exp > now && claims.exp <= now + 300 && claims.jti && !seenJti.has(claims.jti);
      if (!ok) return send(401, { error: "invalid_client" });
      seenJti.add(claims.jti);
      return send(200, { access_token: "tok-abc", token_type: "bearer", expires_in: 300, scope: form.get("scope") });
    }
    if (req.headers.authorization !== "Bearer tok-abc") return send(401, { resourceType: "OperationOutcome" });
    const bundle = (resources: unknown[], next?: string) => send(200, { resourceType: "Bundle", type: "searchset", entry: resources.map((r) => ({ resource: r, search: { mode: "match" } })), link: next ? [{ relation: "next", url: next }] : [] });
    if (url.pathname === "/fhir/Patient") {
      const id = url.searchParams.get("identifier");
      if (id === "urn:mrn|BF-100231") return bundle([{ resourceType: "Patient", id: "ehr-maya" }]);
      if (id === "urn:mrn|BF-100245") return bundle([{ resourceType: "Patient", id: "p1" }, { resourceType: "Patient", id: "p2" }]); // ambiguous
      return bundle([]);
    }
    const obs = (id: string, code: string, v: number, unit: string) => ({ resourceType: "Observation", id, status: "final", category: [{ coding: [{ code: "laboratory" }] }],
      code: { coding: [{ system: "http://loinc.org", code }] }, subject: { reference: `${base}/fhir/Patient/ehr-maya` }, effectiveDateTime: new Date().toISOString(), valueQuantity: { value: v, code: unit } });
    if (url.pathname === "/fhir/Observation") return url.searchParams.get("page") === "2" ? bundle([obs("o2", "2839-9", 0.9, "ng/mL")]) : bundle([obs("o1", "2243-4", 412, "pg/mL")], `${base}/fhir/Observation?page=2`);
    if (url.pathname === "/fhir/MedicationRequest") return bundle([{ resourceType: "MedicationRequest", id: "mr-9", status: "active", intent: "order", subject: { reference: "Patient/ehr-maya" },
      medicationCodeableConcept: { text: "Ovidrel" }, dosageInstruction: [{ timing: { repeat: { timeOfDay: ["21:30:00"], boundsPeriod: { start: tomorrow.toISOString().slice(0, 10), end: tomorrow.toISOString().slice(0, 10) } } }, doseAndRate: [{ doseQuantity: { value: 250, unit: "mcg" } }] }] }]);
    if (url.pathname === "/fhir/Appointment") return bundle([{ resourceType: "Appointment", id: "ap-9", status: "booked", start: tomorrow.toISOString(), serviceType: [{ text: "Egg retrieval" }],
      participant: [{ actor: { reference: "Patient/ehr-maya" } }] }]);
    if (url.pathname === "/fhir/Coverage") return bundle([{ resourceType: "Coverage", id: "cov-9", status: "active", beneficiary: { reference: "Patient/ehr-maya" }, payor: [{ display: "Example Health Plan" }], subscriberId: "ZZ123499" }]);
    if (url.pathname === "/fhir/Invoice") return bundle([{ resourceType: "Invoice", id: "inv-9", status: "issued", subject: { reference: "Patient/ehr-maya" }, date: "2026-10-25", totalGross: { value: 250, currency: "USD" }, lineItem: [{ chargeItemCodeableConcept: { text: "Embryo storage" } }] }]);
    send(404, {});
  });
  return {
    calls,
    start: () => new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(base); })),
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

let db: Db; let ehr: ReturnType<typeof fakeEhr>; let base: string;
beforeEach(async () => {
  db = await openDb(); await migrate(db); await seed(db, new Date());
  ehr = fakeEhr(() => jwksFor(db, IDS.bayside)); base = await ehr.start();
});
afterEach(async () => { await ehr.stop(); });

const connect = (clientId = "pumpkin-123") => saveFhirSource(db, kara, { baseUrl: `${base}/fhir`, clientId, mrnSystem: "urn:mrn", enabled: true });

describe("pulling from the records system's FHIR API", () => {
  it("publishes only a public key for the vendor to register", async () => {
    const src = await ensureFhirSource(db, kara);
    const jwks = (await jwksFor(db, IDS.bayside))!;
    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS384", use: "sig", kid: src.kid });
    expect(jwks.keys[0]).not.toHaveProperty("d");
    const stored = (await db.query<{ private_key_enc: string }>(`SELECT private_key_enc FROM fhir_sources`)).rows[0]!.private_key_enc;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toMatch(/PRIVATE KEY/);
  });

  it("finds the token address, signs in, and brings in labs (across pages), orders and appointments", async () => {
    await connect();
    expect((await fhirSource(db, kara))!.tokenUrl).toBe(`${base}/auth/token`);
    const r = await pullFromFhir(db, IDS.bayside);
    expect(r).toMatchObject({ patients: 1, ambiguous: 1, notFound: 0 });
    expect(r.counts).toMatchObject({ resultsAdded: 2, ordersWaiting: 1, appointments: 1, billing: 2 });
    expect((await patientResults(db, maya, IDS.maya)).some((x) => x.value === 412)).toBe(true);
    expect((await recordsToReview(db, maria)).map((x) => x.kind)).toEqual(["med_order"]);
    expect((await upcomingAppointments(db, maya, IDS.maya))[0]).toMatchObject({ title: "Egg retrieval", kind: "retrieval", source: "records" });
    expect((await fhirSource(db, kara))!.lastStatus).toMatch(/Checked 1 patient, 6 new or changed records\. 1 matched more than one patient there and were skipped\./);
  });

  it("a second pull changes nothing and doesn't search for the patient again", async () => {
    await connect();
    await pullFromFhir(db, IDS.bayside);
    const before = ehr.calls.filter((c) => c.includes("/fhir/Patient?identifier=urn%3Amrn%7CBF-100231")).length;
    const r = await pullAllEnabled(db);
    expect(r[IDS.bayside]).toMatch(/^ok/);
    expect(ehr.calls.filter((c) => c.includes("/fhir/Patient?identifier=urn%3Amrn%7CBF-100231")).length).toBe(before);
    expect((await patientResults(db, maya, IDS.maya)).filter((x) => x.value === 412)).toHaveLength(1);
  });

  it("a wrong client id is refused, and the admin sees why", async () => {
    await connect("someone-else");
    await expect(pullFromFhir(db, IDS.bayside)).rejects.toThrow(/refused Pumpkin's sign-in \(401: invalid_client\)/);
    expect((await fhirSource(db, kara))!.lastStatus).toMatch(/refused Pumpkin's sign-in/);
  });

  it("only admins set it up, and plain http is refused outside local testing", async () => {
    await expect(saveFhirSource(db, maria, { baseUrl: `${base}/fhir`, clientId: "x", enabled: true })).rejects.toThrow(/clinic admin/);
    await expect(saveFhirSource(db, kara, { baseUrl: "http://ehr.example.com/fhir", clientId: "x", enabled: true })).rejects.toThrow(/https/);
  });
});
