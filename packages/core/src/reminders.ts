/**
 * Dose reminders. Pure functions so the phone app, the server and the tests all agree.
 *
 * Rules:
 * - A dose reminder is never silenced, even in quiet hours. Missing an injection matters more.
 * - The "did you take it?" follow-up respects quiet hours and moves to the end of them.
 * - Lock-screen text never names a medication or a fertility clinic unless the patient turns
 *   that on. Default: "Bayside: you have a reminder."
 */
import type { Lang } from "./ranges";

export interface ReminderPrefs {
  /** Minutes before the dose. */
  leadMinutes: number;
  /** Minutes after the dose to ask "did you take it?" if it isn't logged. */
  followUpMinutes: number;
  /** "HH:MM" local times. Quiet hours can cross midnight (e.g. 21:30 to 07:00). */
  quietStart: string;
  quietEnd: string;
  /** Show medication names on the lock screen. Off by default. */
  lockScreenDetail: boolean;
  lang: Lang;
}

export const DEFAULT_PREFS: ReminderPrefs = {
  leadMinutes: 15, followUpMinutes: 60, quietStart: "21:30", quietEnd: "07:00", lockScreenDetail: false, lang: "en",
};

export interface ScheduledDose { id: string; medication: string; scheduledFor: string; takenAt: string | null }

export interface PlannedReminder {
  key: string; // stable id, so rescheduling replaces instead of duplicating
  doseIds: string[];
  at: string; // ISO
  kind: "dose" | "follow_up";
  title: string;
  body: string;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Is a local wall-clock time inside quiet hours? Uses the device's local time. */
export function inQuietHours(date: Date, prefs: Pick<ReminderPrefs, "quietStart" | "quietEnd">): boolean {
  const t = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(prefs.quietStart), end = minutesOf(prefs.quietEnd);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

function endOfQuiet(date: Date, prefs: ReminderPrefs): Date {
  const end = minutesOf(prefs.quietEnd);
  const d = new Date(date);
  d.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (d <= date) d.setDate(d.getDate() + 1);
  return d;
}

function text(kind: PlannedReminder["kind"], meds: string[], clinic: string, prefs: ReminderPrefs): { title: string; body: string } {
  const es = prefs.lang === "es";
  if (!prefs.lockScreenDetail) {
    return { title: clinic, body: es ? "Tienes un recordatorio." : "You have a reminder." };
  }
  const list = meds.join(", ");
  if (kind === "dose") return { title: clinic, body: es ? `Pronto: ${list}` : `Coming up: ${list}` };
  return { title: clinic, body: es ? `¿Ya registraste ${list}?` : `Did you log ${list}?` };
}

/** Plan reminders for doses that haven't been taken yet. Doses at the same time share one reminder. */
/**
 * opts.quiet: after a negative result the app goes quiet. Dose reminders still ring (a missed
 * medication is a safety issue), but the "did you log it?" follow-up nudges stop.
 */
export function planReminders(doses: ScheduledDose[], prefs: ReminderPrefs, now: Date, clinicName: string, opts: { quiet?: boolean } = {}): PlannedReminder[] {
  const pending = doses.filter((d) => d.takenAt === null && new Date(d.scheduledFor) > new Date(now.getTime() - prefs.followUpMinutes * 60_000));
  const groups = new Map<string, ScheduledDose[]>();
  for (const d of pending) {
    const k = new Date(d.scheduledFor).toISOString();
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const out: PlannedReminder[] = [];
  for (const [when, group] of [...groups.entries()].sort()) {
    const due = new Date(when);
    const meds = group.map((g) => g.medication);
    const ids = group.map((g) => g.id).sort();
    const doseAt = new Date(due.getTime() - prefs.leadMinutes * 60_000);
    if (doseAt > now) out.push({ key: `dose:${when}`, doseIds: ids, at: doseAt.toISOString(), kind: "dose", ...text("dose", meds, clinicName, prefs) });
    let follow = new Date(due.getTime() + prefs.followUpMinutes * 60_000);
    if (inQuietHours(follow, prefs)) follow = endOfQuiet(follow, prefs);
    if (follow > now && !opts.quiet) out.push({ key: `follow:${when}`, doseIds: ids, at: follow.toISOString(), kind: "follow_up", ...text("follow_up", meds, clinicName, prefs) });
  }
  return out;
}
