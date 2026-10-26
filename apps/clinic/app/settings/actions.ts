"use server";

import { redirect } from "next/navigation";
import { pairSteps } from "@kinpath/core";
import { addTerm, moveGuide, removeRange, removeTerm, saveGuide, saveProtocol, saveRange } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const num = (f: FormData, k: string) => (str(f, k).trim() === "" ? Number.NaN : Number(str(f, k)));

async function run(tab: string, fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Error && e.name === "ContentError") redirect(`/settings?tab=${tab}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/settings?tab=${tab}&saved=${encodeURIComponent(ok)}`);
}

export async function saveRangeAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("ranges", async () => saveRange(await getDb(), s, {
    id: str(f, "id") || undefined, analyte: str(f, "analyte"), unit: str(f, "unit"), dayFrom: num(f, "dayFrom"), dayTo: num(f, "dayTo"),
    low: num(f, "low"), high: num(f, "high"), inRangeEn: str(f, "inRangeEn"), inRangeEs: str(f, "inRangeEs"),
  }), "Range saved. Patients see the change on their next result.");
}

export async function removeRangeAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("ranges", async () => removeRange(await getDb(), s, str(f, "id")), "Range removed. Results for those days now go to a nurse.");
}

export async function saveProtocolAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("protocols", async () => saveProtocol(await getDb(), s, { id: str(f, "id"), title: str(f, "title"), bodyEn: str(f, "bodyEn"), bodyEs: str(f, "bodyEs") }), "Protocol answer saved. New drafts use it right away.");
}

export async function saveGuideAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("walkthroughs", async () => saveGuide(await getDb(), s, { medication: str(f, "medication"), steps: pairSteps(str(f, "stepsEn"), str(f, "stepsEs")), videoUrl: str(f, "videoUrl") }), "Walkthrough saved.");
}

export async function moveGuideAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("walkthroughs", async () => moveGuide(await getDb(), s, str(f, "medication"), str(f, "direction") === "up" ? "up" : "down"), "Order updated.");
}

export async function addTermAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("urgent", async () => addTerm(await getDb(), s, str(f, "term"), str(f, "level") === "crisis" ? "crisis" : "urgent"), "Added. Messages with this word now skip the AI.");
}

export async function removeTermAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run("urgent", async () => removeTerm(await getDb(), s, str(f, "id")), "Removed.");
}
