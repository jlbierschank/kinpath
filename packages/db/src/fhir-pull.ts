/**
 * Pulling records from the clinic's records system FHIR API, the standard way EHR vendors allow
 * server-to-server access: SMART Backend Services (client credentials with a signed JWT).
 *
 * - Pumpkin makes a key pair per clinic. The public key is published as a JWK Set at
 *   /api/integrations/jwks/<clinic>; the clinic's EHR vendor registers Pumpkin with that URL and
 *   gives back a client id.
 * - The private key is stored encrypted with KINPATH_SECRET_KEY.
 * - Every run: get a token, find each patient by MRN (Patient?identifier=), then fetch lab
 *   Observations, MedicationRequests and upcoming Appointments changed since the last run, and send
 *   them through the same import rules as everything else (nothing is guessed; nurses review orders).
 *
 * Spec checked against hl7.org/fhir/smart-app-launch (client-confidential-asymmetric): RS384,
 * kid and typ "JWT" in the header; iss = sub = client id; aud = token URL; exp at most 5 minutes
 * ahead; a unique jti; client_assertion_type urn:ietf:params:oauth:client-assertion-type:jwt-bearer.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { HandoffError, parseFhirBundle } from "@kinpath/core";
import { asActor, audit, type Actor, type Db } from "./client";
import { importRecords, type ImportCounts } from "./records";

type Fetch = typeof fetch;
const DEFAULT_SCOPE = "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Appointment.rs system/Coverage.rs system/Invoice.rs";

// ---------- secrets ----------

function secretKey(): Buffer {
  const raw = process.env.KINPATH_SECRET_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("KINPATH_SECRET_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
    return k;
  }
  if (process.env.NODE_ENV === "production" && process.env.KINPATH_DEV_LOGIN !== "1") {
    throw new HandoffError("The server needs KINPATH_SECRET_KEY set before it can store a records-system key. See docs/RECORDS.md.");
  }
  return createHash("sha256").update("kinpath-demo-only-secret").digest(); // demo builds only
}
function encrypt(text: string): string {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}
function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable stored key.");
  const d = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// ---------- setup ----------

export interface FhirSourceView {
  baseUrl: string | null; tokenUrl: string | null; clientId: string | null; scope: string; mrnSystem: string | null;
  enabled: boolean; lastPulledAt: string | null; lastStatus: string | null; kid: string;
}

/** Makes the clinic's key pair the first time (so the admin has a JWK Set URL to register). */
export async function ensureFhirSource(db: Db, admin: Actor): Promise<FhirSourceView> {
  if (admin.role !== "clinic_admin") throw new HandoffError("Only a clinic admin can set up the records connection.");
  const have = (await db.query(`SELECT 1 FROM fhir_sources WHERE clinic_id = $1`, [admin.clinicId])).rows[0];
  if (!have) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = randomUUID();
    const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, string>), kid, alg: "RS384", use: "sig", key_ops: ["verify"] };
    await db.query(`INSERT INTO fhir_sources (clinic_id, kid, public_jwk, private_key_enc) VALUES ($1,$2,$3,$4) ON CONFLICT (clinic_id) DO NOTHING`,
      [admin.clinicId, kid, JSON.stringify(jwk), encrypt(privateKey.export({ format: "pem", type: "pkcs8" }) as string)]);
  }
  return (await fhirSource(db, admin))!;
}

export async function fhirSource(db: Db, admin: Actor): Promise<FhirSourceView | null> {
  return asActor(db, admin, async (tx) => {
    const r = (await tx.query<{ base_url: string | null; token_url: string | null; client_id: string | null; scope: string; mrn_system: string | null; enabled: boolean; last_pulled_at: Date | null; last_status: string | null; kid: string }>(
      `SELECT base_url, token_url, client_id, scope, mrn_system, enabled, last_pulled_at, last_status, kid FROM fhir_sources`)).rows[0];
    return r ? { baseUrl: r.base_url, tokenUrl: r.token_url, clientId: r.client_id, scope: r.scope, mrnSystem: r.mrn_system, enabled: r.enabled,
      lastPulledAt: r.last_pulled_at ? new Date(r.last_pulled_at).toISOString() : null, lastStatus: r.last_status, kid: r.kid } : null;
  });
}

/** The public JWK Set the EHR vendor uses to check Pumpkin's signature. Public by design. */
export async function jwksFor(db: Db, clinicId: string): Promise<{ keys: Record<string, unknown>[] } | null> {
  const r = (await db.query<{ public_jwk: Record<string, unknown> }>(`SELECT public_jwk FROM fhir_sources WHERE clinic_id = $1`, [clinicId])).rows[0];
  return r ? { keys: [r.public_jwk] } : null;
}

const okUrl = (u: string) => {
  try {
    const x = new URL(u);
    const local = ["localhost", "127.0.0.1"].includes(x.hostname);
    return x.protocol === "https:" || (x.protocol === "http:" && local && process.env.NODE_ENV !== "production");
  } catch { return false; }
};

export async function saveFhirSource(db: Db, admin: Actor, input: { baseUrl: string; tokenUrl?: string; clientId: string; scope?: string; mrnSystem?: string; enabled: boolean }, f: Fetch = fetch) {
  if (admin.role !== "clinic_admin") throw new HandoffError("Only a clinic admin can set up the records connection.");
  await ensureFhirSource(db, admin);
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  if (!okUrl(baseUrl)) throw new HandoffError("Enter the FHIR address the vendor gave you. It must start with https://.");
  const clientId = input.clientId.trim();
  if (!clientId) throw new HandoffError("Enter the client id the vendor gave you.");
  let tokenUrl = (input.tokenUrl ?? "").trim();
  if (!tokenUrl) {
    // Most servers publish their token address here.
    try {
      const r = await f(`${baseUrl}/.well-known/smart-configuration`, { headers: { Accept: "application/json" } });
      tokenUrl = r.ok ? String(((await r.json()) as { token_endpoint?: string }).token_endpoint ?? "") : "";
    } catch { tokenUrl = ""; }
    if (!tokenUrl) throw new HandoffError("Couldn't find the token address automatically. Enter the token URL the vendor gave you.");
  }
  if (!okUrl(tokenUrl)) throw new HandoffError("The token URL must start with https://.");
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE fhir_sources SET base_url = $2, token_url = $3, client_id = $4, scope = $5, mrn_system = $6, enabled = $7, updated_at = now() WHERE clinic_id = $1`,
      [admin.clinicId, baseUrl, tokenUrl, clientId, (input.scope ?? "").trim() || DEFAULT_SCOPE, (input.mrnSystem ?? "").trim() || null, input.enabled]);
    await audit(tx, admin, "records.fhir_source_saved", null, { enabled: input.enabled });
  });
}

// ---------- pulling ----------

interface SourceRow { clinic_id: string; base_url: string; token_url: string; client_id: string; scope: string; mrn_system: string | null; kid: string; private_key_enc: string; last_pulled_at: Date | null }

function clientAssertion(src: SourceRow): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS384", typ: "JWT", kid: src.kid }));
  const body = b64url(JSON.stringify({ iss: src.client_id, sub: src.client_id, aud: src.token_url, exp: now + 240, iat: now, jti: randomUUID() }));
  const sig = sign("sha384", Buffer.from(`${head}.${body}`), createPrivateKey(decrypt(src.private_key_enc)));
  return `${head}.${body}.${b64url(sig)}`;
}

async function getToken(src: SourceRow, f: Fetch): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "client_credentials", scope: src.scope,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: clientAssertion(src),
  });
  const r = await f(src.token_url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; error_description?: string };
    throw new HandoffError(`The records system refused Pumpkin's sign-in (${r.status}${e.error ? `: ${e.error}` : ""}). Check the client id and that Pumpkin's key address is registered.`);
  }
  const t = (await r.json()) as { access_token?: string };
  if (!t.access_token) throw new HandoffError("The records system didn't return an access token.");
  return t.access_token;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function searchAll(f: Fetch, token: string, url: string, maxPages = 10): Promise<J[]> {
  const out: J[] = [];
  let next: string | null = url;
  for (let i = 0; next && i < maxPages; i++) {
    const r = await f(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/fhir+json" } });
    if (!r.ok) throw new HandoffError(`The records system returned an error (${r.status}) for a search.`);
    const b = (await r.json()) as J;
    for (const e of (b.entry ?? []) as J[]) if (e?.resource && e.search?.mode !== "include") out.push(e.resource);
    next = ((b.link ?? []) as J[]).find((l) => l.relation === "next")?.url ?? null;
  }
  return out;
}

export interface PullResult { patients: number; notFound: number; ambiguous: number; counts: ImportCounts | null }

/** One pull for one clinic. Runs as the server (no signed-in person). */
export async function pullFromFhir(db: Db, clinicId: string, opts: { fetch?: Fetch } = {}): Promise<PullResult> {
  const f = opts.fetch ?? fetch;
  const src = (await db.query<SourceRow>(`SELECT * FROM fhir_sources WHERE clinic_id = $1 AND base_url IS NOT NULL AND client_id IS NOT NULL`, [clinicId])).rows[0];
  if (!src) throw new HandoffError("The FHIR connection isn't set up yet.");
  const startedAt = new Date();
  try {
    const token = await getToken(src, f);
    const since = new Date((src.last_pulled_at ? new Date(src.last_pulled_at).getTime() - 3600_000 : Date.now() - 30 * 86400_000)).toISOString();
    const patients = (await db.query<{ id: string; mrn: string; last_name: string; fhir_id: string | null }>(
      `SELECT p.id, p.mrn, p.last_name, l.fhir_id FROM patients p LEFT JOIN fhir_patient_links l ON l.patient_id = p.id AND l.clinic_id = p.clinic_id
        WHERE p.clinic_id = $1 AND p.mrn IS NOT NULL`, [clinicId])).rows;
    const parsed: { records: ReturnType<typeof parseFhirBundle>["records"]; skipped: string[] } = { records: [], skipped: [] };
    let notFound = 0, ambiguous = 0, found = 0;
    for (const p of patients) {
      let fhirId = p.fhir_id;
      if (!fhirId) {
        const ident = encodeURIComponent(src.mrn_system ? `${src.mrn_system}|${p.mrn}` : p.mrn);
        const hits = await searchAll(f, token, `${src.base_url}/Patient?identifier=${ident}`, 1);
        if (hits.length === 0) { notFound++; continue; }
        if (hits.length > 1) { ambiguous++; continue; } // never guess
        fhirId = String(hits[0]!.id);
        await db.query(`INSERT INTO fhir_patient_links (clinic_id, patient_id, fhir_id) VALUES ($1,$2,$3) ON CONFLICT (clinic_id, patient_id) DO UPDATE SET fhir_id = $3`, [clinicId, p.id, fhirId]);
      }
      found++;
      // The patient as Pumpkin knows her, so the importer matches by MRN and last name as usual.
      const entries: J[] = [];
      entries.push({ fullUrl: `Patient/${fhirId}`, resource: { resourceType: "Patient", id: fhirId, identifier: [{ type: { coding: [{ code: "MR" }] }, value: p.mrn }], name: [{ family: p.last_name }] } });
      const pid = encodeURIComponent(fhirId);
      const s = encodeURIComponent(`gt${since}`);
      const today = startedAt.toISOString().slice(0, 10);
      const found_ = [
        ...await searchAll(f, token, `${src.base_url}/Observation?patient=${pid}&category=laboratory&_lastUpdated=${s}&_count=100`),
        ...await searchAll(f, token, `${src.base_url}/MedicationRequest?patient=${pid}&_lastUpdated=${s}&_count=100`),
        ...await searchAll(f, token, `${src.base_url}/Appointment?patient=${pid}&date=ge${today}&_count=100`),
        // Billing: many servers don't offer these, or Pumpkin may not be allowed to read them. Skip quietly if so.
        ...await searchAll(f, token, `${src.base_url}/Coverage?beneficiary=${pid}&_count=100`).catch(() => []),
        ...await searchAll(f, token, `${src.base_url}/Invoice?subject=${pid}&_lastUpdated=${s}&_count=100`).catch(() => []),
      ];
      for (const r of found_) {
        // Point every record at the Patient entry above, whatever form the server used.
        if (r.subject) r.subject = { reference: `Patient/${fhirId}` };
        if (r.resourceType === "Coverage") r.beneficiary = { reference: `Patient/${fhirId}` };
        if (r.resourceType === "Appointment") r.participant = [...((r.participant as J[]) ?? []).filter((x) => !/Patient\//.test(x?.actor?.reference ?? "")), { actor: { reference: `Patient/${fhirId}` } }];
        entries.push({ resource: r });
      }
      // One small bundle per patient, so a big clinic never hits the per-bundle limit.
      for (let i = 1; i < entries.length; i += 1500) {
        const one = parseFhirBundle({ resourceType: "Bundle", type: "collection", entry: [entries[0], ...entries.slice(i, i + 1500)] });
        parsed.records.push(...one.records); parsed.skipped.push(...one.skipped);
      }
    }
    const counts = parsed.records.length || parsed.skipped.length ? await importRecords(db, { clinicId, keyId: null, format: "pull" }, parsed) : null;
    const n = counts ? counts.received : 0;
    const status = `Checked ${found} patient${found === 1 ? "" : "s"}, ${n} new or changed record${n === 1 ? "" : "s"}.${notFound ? ` ${notFound} not found in the records system by MRN.` : ""}${ambiguous ? ` ${ambiguous} matched more than one patient there and were skipped.` : ""}`;
    await db.query(`UPDATE fhir_sources SET last_pulled_at = $2, last_status = $3 WHERE clinic_id = $1`, [clinicId, startedAt.toISOString(), status]);
    return { patients: found, notFound, ambiguous, counts };
  } catch (e) {
    const msg = e instanceof HandoffError || (e as Error)?.name === "HandoffError" ? (e as Error).message : "Couldn't reach the records system.";
    await db.query(`UPDATE fhir_sources SET last_status = $2 WHERE clinic_id = $1`, [clinicId, `Last try ${startedAt.toISOString()}: ${msg}`]);
    throw e instanceof HandoffError ? e : new HandoffError(msg);
  }
}

/** Every clinic with pulling turned on. The server calls this on a timer. */
export async function pullAllEnabled(db: Db, opts: { fetch?: Fetch } = {}) {
  const rows = (await db.query<{ clinic_id: string }>(`SELECT clinic_id FROM fhir_sources WHERE enabled AND base_url IS NOT NULL AND client_id IS NOT NULL`)).rows;
  const out: Record<string, string> = {};
  for (const r of rows) {
    try { const x = await pullFromFhir(db, r.clinic_id, opts); out[r.clinic_id] = `ok ${x.counts?.received ?? 0}`; }
    catch (e) { out[r.clinic_id] = `error ${(e as Error).message}`; }
  }
  return out;
}
