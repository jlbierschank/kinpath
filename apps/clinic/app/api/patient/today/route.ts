import { planReminders } from "@kinpath/core";
import { getReminderPrefs, patientInbox, patientResults, patientSchedule, patientToday } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(req: Request) {
  return handle(req, ["patient"], async (s) => {
    const db = await getDb();
    const pid = s.patientId!;
    const [today, schedule, inbox, results, prefs] = await Promise.all([
      patientToday(db, s, pid), patientSchedule(db, s, pid), patientInbox(db, s, pid), patientResults(db, s, pid), getReminderPrefs(db, s, pid),
    ]);
    const reminders = planReminders(schedule.upcoming, prefs, new Date(), "Bayside Fertility");
    return {
      clinic: { name: "Bayside Fertility", replyWindow: { en: "Nurses reply 8 am–6 pm, usually within 2 hours.", es: "Las enfermeras responden de 8 am a 6 pm, normalmente en 2 horas." } },
      firstName: today.firstName, lang: today.lang, stage: today.stage, stimDay: today.stimDay,
      schedule, inbox, results: results.map((r) => ({ id: r.id, analyte: r.analyte, value: r.value, unit: r.unit, status: r.label.status, text: r.label.patientText, approvedBy: r.label.approvedBy ?? null })),
      prefs, reminders,
    };
  });
}
