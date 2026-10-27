"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { ensureFhirSource, importRecords, pullFromFhir, saveFhirSource, createIntegrationKey, revokeIntegrationKey, sendSampleRecords } from "@kinpath/db";
import { isFinanceCsv, parseFhirBundle, parseFinanceCsv, parseHl7, parseResultsCsv } from "@kinpath/core";
import { getDb } from "@/lib/db";
import { devLoginEnabled, requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (q: string) => redirect(`/admin/records?${q}`);
async function run(fn: () => Promise<string>) {
  let q: string;
  try { q = await fn(); } catch (e) { if (isHandoffError(e)) back(`error=${encodeURIComponent(e.message)}`); throw e; }
  back(q!);
}

/** Returns the new key to the page that asked (never through the address bar or a cookie). */
export async function createKeyAction(_prev: { key?: string; error?: string } | null, f: FormData): Promise<{ key?: string; error?: string }> {
  const s = await requireSession(["clinic_admin"]);
  try {
    return { key: (await createIntegrationKey(await getDb(), s, str(f, "name"))).key };
  } catch (e) {
    if (isHandoffError(e)) return { error: e.message };
    throw e;
  }
}
export async function revokeKeyAction(f: FormData) {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => { await revokeIntegrationKey(await getDb(), s, str(f, "keyId")); return `saved=${encodeURIComponent("Key turned off. Anything still using it is refused from now on.")}`; });
}
export async function sendSampleAction() {
  const s = await requireSession(["clinic_admin"]);
  if (!devLoginEnabled()) back("error=" + encodeURIComponent("Sample records are only for demo builds."));
  await run(async () => {
    const r = await sendSampleRecords(await getDb(), s);
    return `saved=${encodeURIComponent(`Sample records sent: ${r.resultsAdded} results added (${r.resultsToNurse} to the nurse first), ${r.ordersWaiting} order waiting for a nurse, ${r.appointments} appointment, ${r.toReview} to review, ${r.duplicates} already here, ${r.skipped} skipped. Sign in as Maria to see them, or as Maya to see her visit.`)}`;
  });
}

/** An admin uploads an export from the records system: CSV, a FHIR Bundle (.json) or HL7 v2 (.hl7/.txt). */
export async function uploadRecordsAction(_prev: { summary?: string; error?: string } | null, f: FormData): Promise<{ summary?: string; error?: string }> {
  const s = await requireSession(["clinic_admin"]);
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > 5 * 1024 * 1024) return { error: "Files can be up to 5 MB." };
  const text = await file.text();
  const head = text.trimStart();
  try {
    const parsed = head.startsWith("MSH") || head.startsWith("FHS") || head.startsWith("BHS") ? parseHl7(text)
      : head.startsWith("{") ? parseFhirBundle(JSON.parse(text))
      : isFinanceCsv(text) ? parseFinanceCsv(text) : parseResultsCsv(text);
    const r = await importRecords(await getDb(), { clinicId: s.clinicId, keyId: null, format: "upload", uploadedBy: s.name }, parsed);
    const parts = [
      `${r.resultsAdded} result${r.resultsAdded === 1 ? "" : "s"} added${r.resultsToNurse ? ` (${r.resultsToNurse} to a nurse first)` : ""}`,
      r.hcgAdded && `${r.hcgAdded} hCG`, r.corrected && `${r.corrected} corrected`, r.ordersWaiting && `${r.ordersWaiting} order${r.ordersWaiting === 1 ? "" : "s"} waiting for a nurse`,
      r.appointments && `${r.appointments} appointment${r.appointments === 1 ? "" : "s"}`,
      r.billing && `${r.billing} billing line${r.billing === 1 ? "" : "s"}`, r.estimatesWaiting && `${r.estimatesWaiting} estimate${r.estimatesWaiting === 1 ? "" : "s"} for the financial counselor`,
      r.toReview && `${r.toReview} to review`,
      r.duplicates && `${r.duplicates} already here`, r.skipped && `${r.skipped} skipped`,
    ].filter(Boolean);
    return { summary: `${file.name}: ${parts.join(", ")}.` };
  } catch (e) {
    if ((e as Error)?.name === "RecordsError" || e instanceof SyntaxError) return { error: e instanceof SyntaxError ? "That file isn't valid JSON." : (e as Error).message };
    throw e;
  }
}

export async function setUpFhirAction() {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => { await ensureFhirSource(await getDb(), s); return `saved=${encodeURIComponent("Pumpkin's key is ready. Give the key address below to the records system vendor.")}#fhir`; });
}
export async function saveFhirAction(f: FormData) {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => {
    await saveFhirSource(await getDb(), s, { baseUrl: str(f, "baseUrl"), tokenUrl: str(f, "tokenUrl"), clientId: str(f, "clientId"), mrnSystem: str(f, "mrnSystem"), scope: str(f, "scope"), enabled: str(f, "enabled") === "on" });
    return `saved=${encodeURIComponent(str(f, "enabled") === "on" ? "Saved. Pumpkin will check for new records every 15 minutes." : "Saved. Automatic checking is off.")}#fhir`;
  });
}
export async function pullNowAction() {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => {
    const r = await pullFromFhir(await getDb(), s.clinicId);
    return `saved=${encodeURIComponent(`Checked ${r.patients} patient${r.patients === 1 ? "" : "s"}: ${r.counts?.received ?? 0} new or changed records.`)}#fhir`;
  });
}
