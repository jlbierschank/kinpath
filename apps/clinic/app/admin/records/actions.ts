"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { createIntegrationKey, revokeIntegrationKey, sendSampleRecords } from "@kinpath/db";
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
    return `saved=${encodeURIComponent(`Sample records sent: ${r.resultsAdded} results added (${r.resultsToNurse} to the nurse first), ${r.ordersWaiting} order waiting for a nurse, ${r.toReview} to review, ${r.duplicates} already here, ${r.skipped} skipped. Sign in as Maria to see them.`)}`;
  });
}
