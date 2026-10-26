"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isHandoffError } from "@kinpath/core";
import { completeStaffSetup, confirmTwoStepSetup, requestSignInCode, signOut, staffSignIn, verifySignInCode, verifyTwoStep } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { deviceLabel, getAnySession, homeFor, SESSION_COOKIE, setSessionCookie } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (path: string, msg: string, extra = "") => redirect(`${path}?error=${encodeURIComponent(msg)}${extra}`);

async function attempt<T>(path: string, fn: () => Promise<T>, extra = ""): Promise<T> {
  try { return await fn(); } catch (e) { if (isHandoffError(e)) back(path, e.message, extra); throw e; }
}

export async function staffSignInAction(f: FormData) {
  const r = await attempt("/login", async () => staffSignIn(await getDb(), str(f, "email"), str(f, "password"), await deviceLabel()));
  await setSessionCookie(r.token, true);
  redirect("/login/two-step");
}

export async function twoStepAction(f: FormData) {
  const s = await getAnySession();
  if (!s?.token) redirect("/login");
  await attempt("/login/two-step", async () => verifyTwoStep(await getDb(), s.token!, str(f, "code")));
  redirect(homeFor(s.role));
}

export async function confirmSetupAction(f: FormData) {
  const s = await getAnySession();
  if (!s?.token) redirect("/login");
  await attempt("/login/two-step", async () => confirmTwoStepSetup(await getDb(), s.token!, str(f, "code")));
  redirect(`${homeFor(s.role)}?saved=${encodeURIComponent("Two-step sign-in is on. You're all set.")}`);
}

export async function requestCodeAction(f: FormData) {
  const to = str(f, "identifier");
  const r = await attempt("/login", async () => requestSignInCode(await getDb(), to), "&tab=code");
  redirect(`/login/code?to=${encodeURIComponent(to)}&sent=${encodeURIComponent(r.sentTo)}`);
}

export async function verifyCodeAction(f: FormData) {
  const to = str(f, "identifier");
  const r = await attempt("/login/code", async () => verifySignInCode(await getDb(), to, str(f, "code"), await deviceLabel()), `&to=${encodeURIComponent(to)}`);
  await setSessionCookie(r.token, false);
  const s = await getAnySession();
  redirect(s ? homeFor(s.role) : "/");
}

export async function setupPasswordAction(f: FormData) {
  const t = str(f, "t");
  if (str(f, "password") !== str(f, "confirm")) back("/login/setup", "The two passwords don't match.", `&t=${encodeURIComponent(t)}`);
  const r = await attempt("/login/setup", async () => completeStaffSetup(await getDb(), t, str(f, "password"), await deviceLabel()), `&t=${encodeURIComponent(t)}`);
  await setSessionCookie(r.token, true);
  redirect("/login/two-step");
}

export async function signOutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await signOut(await getDb(), token);
  jar.delete(SESSION_COOKIE);
  jar.delete("kp_dev_user");
  redirect("/login");
}
