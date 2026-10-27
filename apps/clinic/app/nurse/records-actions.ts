"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { confirmRecord, dismissRecord } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const backTo = (f: FormData) => { const b = str(f, "back"); return /^\/(nurse|money)(\/[\w-]*)?$/.test(b) ? b : "/nurse"; };
async function run(back: string, fn: () => Promise<unknown>, ok: string) {
  try { await fn(); } catch (e) { if (isHandoffError(e)) redirect(`${back}?error=${encodeURIComponent(e.message)}#records`); throw e; }
  redirect(`${back}?saved=${encodeURIComponent(ok)}#records`);
}

export async function confirmRecordAction(f: FormData) {
  const s = await requireSession(["nurse", "physician", "financial_counselor"]);
  await run(backTo(f), async () => confirmRecord(await getDb(), s, str(f, "itemId"), { patientId: str(f, "patientId") || undefined }), str(f, "ok") || "Done.");
}
export async function dismissRecordAction(f: FormData) {
  const s = await requireSession(["nurse", "physician", "financial_counselor"]);
  await run(backTo(f), async () => dismissRecord(await getDb(), s, str(f, "itemId")), "Dismissed. It won't come back unless the records system sends a new version.");
}
