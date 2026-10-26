"use server";

import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { changeRole, inviteStaff, resendSetup, setStaffActive } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { baseUrl, requireSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
async function run(fn: () => Promise<unknown>, ok: string | ((r: unknown) => string)) {
  let r: unknown;
  try { r = await fn(); } catch (e) { if (isHandoffError(e)) redirect(`/admin/team?error=${encodeURIComponent(e.message)}`); throw e; }
  redirect(`/admin/team?saved=${encodeURIComponent(typeof ok === "function" ? ok(r) : ok)}`);
}

export async function inviteStaffAction(f: FormData) {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => inviteStaff(await getDb(), s, { name: str(f, "name"), email: str(f, "email"), role: str(f, "role"), title: str(f, "title") }, await baseUrl()),
    `Invited. ${str(f, "name").split(" ")[0]} will get an email with a link to set a password (it works for 72 hours).`);
}
export async function changeRoleAction(f: FormData) {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => changeRole(await getDb(), s, str(f, "userId"), str(f, "role")), "Role changed. It takes effect right away.");
}
export async function setActiveAction(f: FormData) {
  const s = await requireSession(["clinic_admin"]);
  const active = str(f, "active") === "yes";
  await run(async () => setStaffActive(await getDb(), s, str(f, "userId"), active), active ? "Reactivated. They can sign in again." : "Deactivated. They were signed out everywhere and can't sign in.");
}
export async function resendSetupAction(f: FormData) {
  const s = await requireSession(["clinic_admin"]);
  await run(async () => resendSetup(await getDb(), s, str(f, "userId"), await baseUrl()), "A new setup link was sent.");
}
