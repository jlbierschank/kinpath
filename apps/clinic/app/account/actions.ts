"use server";

import { redirect } from "next/navigation";
import { isHandoffError, kindsFor, audienceOf, type Channel } from "@kinpath/core";
import { changePassword, setDeliverySettings, setNotificationChannels, signOutOtherDevices, updateMyProfile } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const ALL = ["nurse", "physician", "financial_counselor", "scheduler", "clinic_admin", "patient", "partner"] as const;
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

async function run(tab: string, fn: () => Promise<unknown>, ok: string) {
  try { await fn(); } catch (e) { if (isHandoffError(e)) redirect(`/account?tab=${tab}&error=${encodeURIComponent(e.message)}`); throw e; }
  redirect(`/account?tab=${tab}&saved=${encodeURIComponent(ok)}`);
}

export async function saveProfileAction(f: FormData) {
  const s = await requireSession([...ALL]);
  await run("profile", async () => updateMyProfile(await getDb(), s, { name: str(f, "name"), title: str(f, "title"), signature: str(f, "signature"), lang: str(f, "lang") }), "Profile saved.");
}

export async function changePasswordAction(f: FormData) {
  const s = await requireSession([...ALL]);
  if (!s.token) redirect(`/account?tab=security&error=${encodeURIComponent("You're using demo sign-in. Sign in with a password to change it.")}`);
  if (str(f, "next") !== str(f, "confirm")) redirect(`/account?tab=security&error=${encodeURIComponent("The two new passwords don't match.")}`);
  await run("security", async () => changePassword(await getDb(), s.token!, str(f, "current"), str(f, "next")), "Password changed. Your other devices were signed out.");
}

export async function signOutOthersAction() {
  const s = await requireSession([...ALL]);
  if (!s.token) redirect(`/account?tab=security&error=${encodeURIComponent("You're using demo sign-in.")}`);
  await run("security", async () => signOutOtherDevices(await getDb(), s.token!), "Signed out of your other devices.");
}

export async function saveNotificationsAction(f: FormData) {
  const s = await requireSession([...ALL]);
  const db = await getDb();
  await run("notifications", async () => {
    for (const k of kindsFor(audienceOf(s.role))) {
      const c: Partial<Record<Channel, boolean>> = {};
      for (const ch of ["in_app", "push", "sms", "email"] as const) c[ch] = f.get(`${k}.${ch}`) === "on";
      await setNotificationChannels(db, s, k, c);
    }
    const staff = audienceOf(s.role) === "staff";
    await setDeliverySettings(db, s, {
      quiet: { on: f.get("quiet_on") === "on", start: str(f, "quiet_start") || "21:00", end: str(f, "quiet_end") || "07:00" },
      ...(staff ? { digest: str(f, "digest") || "off" } : {}),
      phone: str(f, "phone"),
    });
  }, "Notification settings saved.");
}
