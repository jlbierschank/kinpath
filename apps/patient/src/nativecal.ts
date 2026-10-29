/**
 * The phone's own "Add to Calendar" sheet for one visit (iPhone and Android). She picks the calendar
 * and can edit before saving; Pumpkin needs no calendar permission. Not on the web, where the
 * calendar links in You do this job.
 */
import { Platform } from "react-native";

export const nativeCalendar = Platform.OS === "ios" || Platform.OS === "android";

export async function addVisitToCalendar(v: { title: string; startsAt: string; location?: string | null }): Promise<boolean> {
  if (!nativeCalendar) return false;
  const Cal = await import("expo-calendar/legacy");
  const start = new Date(v.startsAt);
  const r = await Cal.createEventInCalendarAsync({ title: v.title, startDate: start, endDate: new Date(start.getTime() + 3600_000), location: v.location ?? undefined });
  return r.action === "saved";
}
