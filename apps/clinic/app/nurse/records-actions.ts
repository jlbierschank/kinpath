"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { confirmRecord, dismissRecord } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
async function run(fn: () => Promise<unknown>, ok: string) {
  try { await fn(); } catch (e) { if (isHandoffError(e)) redirect(`/nurse?error=${encodeURIComponent(e.message)}#records`); throw e; }
  redirect(`/nurse?saved=${encodeURIComponent(ok)}#records`);
}

export async function confirmRecordAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run(async () => confirmRecord(await getDb(), s, str(f, "itemId"), { patientId: str(f, "patientId") || undefined }), str(f, "ok") || "Done.");
}
export async function dismissRecordAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run(async () => dismissRecord(await getDb(), s, str(f, "itemId")), "Dismissed. It won't come back unless the records system sends a new version.");
}
