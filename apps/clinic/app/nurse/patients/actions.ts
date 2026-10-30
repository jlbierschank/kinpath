"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { completeTask, decideLink, enterPregnancyResult, graduatePatient, matchLink, recordTransfer, releasePregnancyResult } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

async function run(back: string, fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
  } catch (e) {
    if (isHandoffError(e)) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`${back}${back.includes("?") ? "&" : "?"}saved=${encodeURIComponent(ok)}`);
}

export async function recordTransferAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const id = str(f, "patientId");
  const frozen = str(f, "embryosFrozen").trim();
  await run(`/nurse/patients/${id}`, async () => recordTransfer(await getDb(), s, { patientId: id, transferOn: str(f, "transferOn"), testAt: str(f, "testAt"), embryosFrozen: frozen === "" ? null : Number(frozen) }),
    "Transfer recorded. Her app now shows the wait and her blood test date. Remaining stimulation doses were canceled.");
}

export async function enterResultAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const id = str(f, "patientId");
  const hcg = str(f, "hcg").trim() === "" ? Number.NaN : Number(str(f, "hcg"));
  await run(`/nurse/patients/${id}`, async () => enterPregnancyResult(await getDb(), s, { patientId: id, hcg, outcome: str(f, "outcome"), note: str(f, "note") }),
    "Result saved. She can't see it until you release it.");
}

export async function releaseResultAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const id = str(f, "patientId");
  await run(`/nurse/patients/${id}`, async () => releasePregnancyResult(await getDb(), s, { patientId: id, toldByPhone: str(f, "toldByPhone") === "yes" }),
    "Released. It's in her app now.");
}

export async function completeTaskAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("/nurse", async () => completeTask(await getDb(), s, str(f, "taskId"), str(f, "note")), "Marked done.");
}

export async function graduateAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const id = str(f, "patientId");
  await run(`/nurse/patients/${id}`, async () => graduatePatient(await getDb(), s, { patientId: id, obName: str(f, "obName") }),
    "Graduated. Her app now shows her graduation, her keepsake and a way to share her summary with her OB-GYN.");
}

// ---------- patients connecting their own Pumpkin ----------

export async function decideLinkAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const accept = str(f, "decision") === "accept";
  const chart = str(f, "chartId");
  await run("/nurse", async () => decideLink(await getDb(), s, str(f, "linkId"), accept, accept && chart ? chart : null),
    accept ? (chart ? "Connected. Her shared Pumpkin is on her patient page." : "Connected. Match her to a chart once she's in your records.") : "Declined. She'll see that your clinic didn't confirm the request.");
}

export async function matchLinkAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("/nurse", async () => matchLink(await getDb(), s, str(f, "linkId"), str(f, "chartId")), "Matched to her chart.");
}
