"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { askAboutCosts } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function askCostAction(f: FormData) {
  const s = await requireSession(["patient"]);
  try {
    await askAboutCosts(await getDb(), s, { patientId: s.patientId!, question: String(f.get("question") ?? ""), estimateId: String(f.get("estimateId") ?? "") || null });
  } catch (e) { if (isHandoffError(e)) redirect(`/patient/costs?error=${encodeURIComponent(e.message)}#ask`); throw e; }
  redirect("/patient/costs?asked=1#ask");
}
