import { NextResponse } from "next/server";
import { hl7Ack, parseFhirBundle, parseHl7, parseResultsCsv, RecordsError } from "@kinpath/core";
import { importRecords, keyFromToken } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/config";

/**
 * Where the clinic's records system sends lab results and medication orders.
 * Auth: "Authorization: Bearer pk_…" (a key an admin made on Records connection).
 * Body: a FHIR R4 Bundle (application/fhir+json or application/json), HL7 v2 messages
 * (x-application/hl7-v2+er7, application/hl7-v2, or text/plain starting with MSH), or a results CSV (text/csv).
 * The reply has counts only, never patient details. HL7 senders get HL7 acknowledgments (MSA AA / AE).
 */
const MAX_BYTES = 5 * 1024 * 1024;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const db = await getDb();
  const key = token ? await keyFromToken(db, token) : null;
  if (!key) return fail(401, "Missing or unknown key. An admin can create one on the Records connection page.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return fail(413, "Send at most 5 MB at a time.");
  const text = await req.text();
  if (text.length > MAX_BYTES) return fail(413, "Send at most 5 MB at a time.");
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  try {
    let parsed;
    if (type.includes("hl7") || (type.includes("text/plain") && text.trimStart().startsWith("MSH"))) {
      let h;
      try { h = parseHl7(text); } catch (e) { return new NextResponse(hl7Ack([{ controlId: "", type: "ACK^" }], false, (e as Error).message), { status: 400, headers: { "Content-Type": "x-application/hl7-v2+er7" } }); }
      await importRecords(db, { clinicId: key.clinicId, keyId: key.keyId, format: "hl7" }, h);
      return new NextResponse(hl7Ack(h.messages, true), { headers: { "Content-Type": "x-application/hl7-v2+er7", "Cache-Control": "no-store" } });
    }
    let format: "fhir" | "csv";
    if (type.includes("text/csv")) { parsed = parseResultsCsv(text); format = "csv"; }
    else if (type.includes("json")) {
      let body: unknown;
      try { body = JSON.parse(text); } catch { return fail(400, "The body isn't valid JSON."); }
      parsed = parseFhirBundle(body); format = "fhir";
    } else return fail(415, "Send application/fhir+json, HL7 v2 (x-application/hl7-v2+er7) or text/csv.");
    const r = await importRecords(db, { clinicId: key.clinicId, keyId: key.keyId, format }, parsed);
    return NextResponse.json({ ok: true, ...r, skippedReasons: [...new Set(parsed.skipped)] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof RecordsError || (e as Error)?.name === "RecordsError") return fail(400, (e as Error).message);
    logError("records-import", e);
    return fail(500, "Something went wrong saving these records. Nothing was saved; it's safe to send them again.");
  }
}
