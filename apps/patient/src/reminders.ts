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
}

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
  await Notifications.cancelAllScheduledNotificationsAsync();
  let n = 0;
  for (const r of plan) {
    const at = new Date(r.at);
    if (at.getTime() <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: r.key.replace(/[^a-zA-Z0-9-]/g, "-"),
      content: { title: r.title, body: r.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: Platform.OS === "android" ? "doses" : undefined },
    });
    n++;
  }
  return n;
}
