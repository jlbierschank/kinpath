"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { addPatient, bookAppointment, cancelAppointment, startCycle, updatePatient, type CYCLE_KINDS } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const STAFF = ["nurse", "physician", "scheduler"] as const;
async function run(fn: () => Promise<unknown>, ok: string, hash = "") {
  try { await fn(); } catch (e) { if (isHandoffError(e)) redirect(`/patients?error=${encodeURIComponent(e.message)}${hash}`); throw e; }
  redirect(`/patients?saved=${encodeURIComponent(ok)}${hash}`);
}

export async function addPatientAction(f: FormData) {
  const s = await requireSession([...STAFF]);
  const withCycle = str(f, "cycleKind") !== "";
  await run(async () => addPatient(await getDb(), s, {
    firstName: str(f, "firstName"), lastName: str(f, "lastName"), mrn: str(f, "mrn"), contact: str(f, "contact"), lang: str(f, "lang") === "es" ? "es" : "en",
    cycle: withCycle ? { kind: str(f, "cycleKind") as keyof typeof CYCLE_KINDS, startedOn: str(f, "startedOn") } : null,
  }), `${str(f, "firstName")} was added and sent a welcome with how to sign in.`);
}
export async function updatePatientAction(f: FormData) {
  const s = await requireSession([...STAFF]);
  await run(async () => updatePatient(await getDb(), s, str(f, "patientId"), { mrn: str(f, "mrn"), contact: str(f, "contact"), lang: str(f, "lang") === "es" ? "es" : "en" }), "Saved.");
}
export async function startCycleAction(f: FormData) {
  const s = await requireSession(["nurse", "physician"]);
  await run(async () => startCycle(await getDb(), s, str(f, "patientId"), { kind: str(f, "cycleKind") as keyof typeof CYCLE_KINDS, startedOn: str(f, "startedOn") }), "Cycle started.");
}
export async function bookAction(f: FormData) {
  const s = await requireSession([...STAFF]);
  await run(async () => bookAppointment(await getDb(), s, { patientId: str(f, "patientId"), startsAt: str(f, "startsAt"), kind: str(f, "kind"), title: str(f, "title"), location: str(f, "location") }),
    "Booked. She was told she has a new appointment.", "#appointments");
}
export async function cancelAppointmentAction(f: FormData) {
  const s = await requireSession([...STAFF]);
  await run(async () => cancelAppointment(await getDb(), s, str(f, "appointmentId")), "Canceled. She was told.", "#appointments");
}
