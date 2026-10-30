"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  closeAfterCall, closeRefill, type RefillOutcome, draftReply, enterLabResult, markReplyRead, reportMissedDose, sendPatientMessage, sendReply,
} from "@kinpath/db";
import { getDb, resetDb } from "@/lib/db";
import { devLoginEnabled, getSession, homeFor, requireSession, SESSION_COOKIE } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function signIn(form: FormData) {
  if (!devLoginEnabled()) redirect("/login");
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.set("kp_dev_user", str(form, "userId"), { httpOnly: true, sameSite: "lax", path: "/" });
  const s = await getSession();
  redirect(s ? homeFor(s.role) : "/");
}

export async function signOut() {
  (await cookies()).delete("kp_dev_user");
  redirect("/");
}

export async function resetDemo() {
  if (!devLoginEnabled() || process.env.DATABASE_URL) redirect("/login");
  await resetDb();
  (await cookies()).delete(SESSION_COOKIE);
  (await cookies()).delete("kp_dev_user");
  redirect("/");
}

// ---------- patient ----------
export async function reportMissed(form: FormData) {
  const s = await requireSession(["patient"]);
  await reportMissedDose(await getDb(), s, { patientId: s.patientId!, doseLogId: str(form, "doseLogId"), note: str(form, "note") });
  revalidatePath("/patient");
}

export async function messageTeam(form: FormData) {
  const s = await requireSession(["patient"]);
  const text = str(form, "text").trim();
  if (text) await sendPatientMessage(await getDb(), s, { patientId: s.patientId!, text });
  revalidatePath("/patient");
}

export async function markRead(form: FormData) {
  const s = await requireSession(["patient"]);
  await markReplyRead(await getDb(), s, str(form, "handoffId"));
  revalidatePath("/patient");
}

// ---------- nurse ----------
export async function draft(form: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const id = str(form, "handoffId");
  await draftReply(await getDb(), s, id);
  revalidatePath(`/nurse/${id}`);
}

export async function send(form: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await sendReply(await getDb(), s, str(form, "handoffId"), str(form, "text"));
  redirect("/nurse");
}

export async function handleRefill(form: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  const outcome = str(form, "outcome") as RefillOutcome;
  await closeRefill(await getDb(), s, str(form, "handoffId"), outcome, str(form, "note"));
  redirect("/nurse?saved=" + encodeURIComponent("Refill request handled."));
}

export async function markCalled(form: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await closeAfterCall(await getDb(), s, str(form, "handoffId"), str(form, "note"));
  redirect("/nurse");
}

export async function enterResult(form: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await enterLabResult(await getDb(), s, {
    patientId: str(form, "patientId"), analyte: str(form, "analyte"), unit: str(form, "unit"),
    value: Number(str(form, "value")), stimDay: Number(str(form, "stimDay")),
  });
  redirect("/nurse");
}
