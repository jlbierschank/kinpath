"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import {
  addLedgerEntry, answerCostQuestion, deleteDraftEstimate, saveCoverage, saveEstimate, savePartner, shareEstimate, voidLedgerEntry,
} from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
async function run(back: string, fn: () => Promise<unknown>, ok: string, hash = "") {
  try { await fn(); } catch (e) { if (isHandoffError(e)) redirect(`${back}?error=${encodeURIComponent(e.message)}${hash}`); throw e; }
  redirect(`${back}?saved=${encodeURIComponent(ok)}${hash}`);
}
const counselor = () => requireSession(["financial_counselor"]);

export async function saveEstimateAction(f: FormData) {
  const s = await counselor();
  const pid = str(f, "patientId");
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({ label: str(f, `label${i}`), category: str(f, `cat${i}`), amount: str(f, `amt${i}`), insurance: str(f, `ins${i}`) }))
    .filter((i) => i.label.trim() || i.amount.trim());
  const share = str(f, "share") === "yes";
  await run(`/money/${pid}`, async () => {
    const { id } = await saveEstimate(await getDb(), s, { patientId: pid, estimateId: str(f, "estimateId") || undefined, title: str(f, "title"), note: str(f, "note"), validUntil: str(f, "validUntil") || undefined, items });
    if (share) await shareEstimate(await getDb(), s, id);
  }, share ? "Shared. She was told her estimate is ready." : "Draft saved. She can't see it until you share it.", "#estimate");
}
export async function shareEstimateAction(f: FormData) {
  const s = await counselor();
  await run(`/money/${str(f, "patientId")}`, async () => shareEstimate(await getDb(), s, str(f, "estimateId")), "Shared. She was told her estimate is ready.", "#estimate");
}
export async function deleteDraftAction(f: FormData) {
  const s = await counselor();
  await run(`/money/${str(f, "patientId")}`, async () => deleteDraftEstimate(await getDb(), s, str(f, "estimateId")), "Draft deleted.", "#estimate");
}
export async function saveCoverageAction(f: FormData) {
  const s = await counselor();
  const pid = str(f, "patientId");
  await run(`/money/${pid}`, async () => saveCoverage(await getDb(), s, {
    patientId: pid, coverageId: str(f, "coverageId") || undefined, kind: str(f, "kind"), payerName: str(f, "payerName"), planName: str(f, "planName"), memberLast4: str(f, "memberLast4"),
    fertilityBenefit: str(f, "fertilityBenefit"), lifetimeMax: str(f, "lifetimeMax"), lifetimeUsed: str(f, "lifetimeUsed"), cyclesMax: str(f, "cyclesMax"), cyclesUsed: str(f, "cyclesUsed"),
    deductible: str(f, "deductible"), deductibleMet: str(f, "deductibleMet"), oopMax: str(f, "oopMax"), oopMet: str(f, "oopMet"), priorAuth: str(f, "priorAuth"), endsOn: str(f, "endsOn") || undefined,
  }), "Coverage saved.", "#coverage");
}
export async function addEntryAction(f: FormData) {
  const s = await counselor();
  const pid = str(f, "patientId");
  const kind = str(f, "kind");
  await run(`/money/${pid}`, async () => addLedgerEntry(await getDb(), s, { patientId: pid, kind, description: str(f, "description"), amount: str(f, "amount"), occurredOn: str(f, "occurredOn"), dueOn: str(f, "dueOn") || undefined, method: str(f, "method") }),
    kind === "payment" ? "Payment recorded. Her receipt is in the app." : "Saved.", "#account");
}
export async function voidEntryAction(f: FormData) {
  const s = await counselor();
  await run(`/money/${str(f, "patientId")}`, async () => voidLedgerEntry(await getDb(), s, str(f, "entryId")), "Removed.", "#account");
}
export async function answerAction(f: FormData) {
  const s = await counselor();
  await run(`/money/${str(f, "patientId")}`, async () => answerCostQuestion(await getDb(), s, str(f, "questionId"), str(f, "answer")), "Answered. She was told.", "#questions");
}
export async function savePartnerAction(f: FormData) {
  const s = await requireSession(["financial_counselor", "clinic_admin"]);
  await run("/money/partners", async () => savePartner(await getDb(), s, {
    id: str(f, "id") || undefined, kind: str(f, "kind"), name: str(f, "name"), description: str(f, "description"), url: str(f, "url"), phone: str(f, "phone"),
    active: str(f, "active") !== "no", sortOrder: Number(str(f, "sortOrder") || 0),
  }), "Saved. Patients see active options on their costs page.");
}
