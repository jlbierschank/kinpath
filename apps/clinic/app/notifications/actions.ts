"use server";
import { redirect } from "next/navigation";
import { markNotificationsRead } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { requireSession } from "@/lib/session";

const ALL = ["nurse", "physician", "financial_counselor", "scheduler", "clinic_admin", "patient", "partner"] as const;
export async function markAllReadAction() {
  const s = await requireSession([...ALL]);
  await markNotificationsRead(await getDb(), s, "all");
  redirect("/notifications");
}
export async function openNotificationAction(f: FormData) {
  const s = await requireSession([...ALL]);
  await markNotificationsRead(await getDb(), s, [String(f.get("id"))]);
  const link = String(f.get("link") ?? "");
  redirect(link.startsWith("/") ? link : "/notifications");
}
