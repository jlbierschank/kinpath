/**
 * Puts the server's planned reminders on the phone as local notifications.
 * The text was already made privacy-safe by @kinpath/core (no medication names on the
 * lock screen unless the patient turned that on). Web has no scheduled notifications.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { PlannedReminder } from "@kinpath/core";

export const remindersSupported = Platform.OS === "ios" || Platform.OS === "android";

if (remindersSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  // Buttons on the dose reminder itself: log it or snooze it without hunting for the right screen.
  void Notifications.setNotificationCategoryAsync("dose", [
    { identifier: "log", buttonTitle: "Log it", options: { opensAppToForeground: true } },
    { identifier: "snooze", buttonTitle: "Snooze 15 min", options: { opensAppToForeground: true } },
  ]).catch(() => {});
}

const SNOOZE = "snooze-";

export async function askPermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("doses", { name: "Dose reminders", importance: Notifications.AndroidImportance.HIGH });
  }
  const s = await Notifications.requestPermissionsAsync();
  return s.granted || s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Replace every scheduled reminder with the current plan. Safe to call on each refresh. */
export async function syncReminders(plan: PlannedReminder[]): Promise<number> {
  if (!remindersSupported) return 0;
  // Replace the plan, but keep any snooze the person asked for.
  for (const x of await Notifications.getAllScheduledNotificationsAsync()) {
    if (!x.identifier.startsWith(SNOOZE)) await Notifications.cancelScheduledNotificationAsync(x.identifier);
  }
  let n = 0;
  for (const r of plan) {
    const at = new Date(r.at);
    if (at.getTime() <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: r.key.replace(/[^a-zA-Z0-9-]/g, "-"),
      content: { title: r.title, body: r.body, data: { kind: r.kind, doseIds: r.doseIds }, ...(r.kind === "dose" ? { categoryIdentifier: "dose" } : {}) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: Platform.OS === "android" ? "doses" : undefined },
    });
    n++;
  }
  return n;
}

/** Remind again in 15 minutes, with the same privacy-safe words. Returns when it will ring. */
export async function snoozeDose(doseIds: string[], title: string, body: string, minutes = 15): Promise<Date | null> {
  if (!remindersSupported) return null;
  const at = new Date(Date.now() + minutes * 60_000);
  await Notifications.scheduleNotificationAsync({
    identifier: `${SNOOZE}${Date.now()}`,
    content: { title, body, data: { kind: "dose", doseIds }, categoryIdentifier: "dose" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: Platform.OS === "android" ? "doses" : undefined },
  });
  return at;
}

export type DoseAction = { action: "log" | "snooze" | "open"; doseIds: string[]; title: string; body: string };
/** Calls back when someone taps Log it or Snooze on a dose reminder (including the tap that launched the app). */
export function onDoseAction(handle: (a: DoseAction) => void): () => void {
  if (!remindersSupported) return () => {};
  const seen = new Set<string>();
  const take = (r: Notifications.NotificationResponse | null) => {
    if (!r) return;
    const id = `${r.notification.request.identifier}:${r.actionIdentifier}:${r.notification.date}`;
    if (seen.has(id)) return; seen.add(id);
    const data = r.notification.request.content.data as { kind?: string; doseIds?: string[] } | undefined;
    if (data?.kind !== "dose" || !data.doseIds?.length) return;
    const action = r.actionIdentifier === "log" ? "log" : r.actionIdentifier === "snooze" ? "snooze" : "open";
    handle({ action, doseIds: data.doseIds, title: r.notification.request.content.title ?? "Dose reminder", body: r.notification.request.content.body ?? "" });
    void Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
  };
  void Notifications.getLastNotificationResponseAsync().then(take).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(take);
  return () => sub.remove();
}

export type ReminderPermission = "granted" | "denied" | "undetermined" | "unsupported";
/** Whether reminders can ring on this phone, without asking. */
export async function reminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported) return "unsupported";
  const s = await Notifications.getPermissionsAsync();
  if (s.granted || s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return "granted";
  return s.canAskAgain ? "undetermined" : "denied";
}
/** One test notification a few seconds from now, so she knows reminders really ring. */
export async function sendTestReminder(seconds = 5): Promise<boolean> {
  if (!remindersSupported) return false;
  await Notifications.scheduleNotificationAsync({
    identifier: `${SNOOZE}test-${Date.now()}`,
    content: { title: "Pumpkin", body: "This is how your reminders will look. You're all set." },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: Platform.OS === "android" ? "doses" : undefined },
  });
  return true;
}
