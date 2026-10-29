import { HandoffError, planReminders } from "@kinpath/core";
import {
  addAppointment, addCapture, addCost, addMedication, addQuestion, addResult, askMyClinic, captureFile, deleteAppointment, deleteCost, deleteMyAccount, deleteQuestion,
  deleteResult, dismissItem, exportMyData, getReminderPrefs, itemsToCheck, newCalendarLink, SAMPLES, saveItem, setQuestionAsked, soloCosts, soloMeds, soloProfile,
  soloResults, soloToday, stopCalendarLink, stopMedication, setMedSupply, updateSoloProfile, visitQuestions, financePartners,
  patientSharing, saveKit, setMedLastDay, createPersonalShare, personalShares, stopSummaryShare, aboutMe, addTenderDate, deleteTenderDate, questionIdeas, saveAbout, setAlias, setQuiet, visitSummary, withdrawAboutConsent,
} from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";
import { baseUrl } from "@/lib/session";

/**
 * Pumpkin on your own: the phone app's API for a patient in her own space.
 * Every call runs as her, under row-level security; the database refuses anything outside her space.
 */
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
type Ctx = { params: Promise<{ action: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  return handle(req, ["patient"], async (s) => {
    const db = await getDb();
    const pid = s.patientId!;
    switch (action) {
      case "today": {
        const today = await soloToday(db, s, pid);
        const prefs = await getReminderPrefs(db, s, pid);
        return { ...today, reminders: planReminders(today.schedule.upcoming, prefs, new Date(), "Pumpkin", { quiet: false }), prefs };
      }
      case "profile": return soloProfile(db, s, pid);
      case "meds": return soloMeds(db, s, pid);
      case "results": return soloResults(db, s, pid);
      case "costs": return { ...(await soloCosts(db, s, pid)), partners: await financePartners(db, s) };
      case "questions": return visitQuestions(db, s, pid);
      case "items": return itemsToCheck(db, s, pid);
      case "samples": return Object.entries(SAMPLES).map(([id, x]) => ({ id, label: x.label, description: x.description }));
      case "file": {
        const id = new URL(req.url).searchParams.get("id") ?? "";
        const f = await captureFile(db, s, pid, id);
        if (!f) throw new HandoffError("There's no file for this one.");
        return { mime: f.mime, filename: f.filename, base64: f.bytes.toString("base64") };
      }
      case "export": return exportMyData(db, s);
      case "about": return aboutMe(db, s, pid);
      case "question-ideas": return questionIdeas(db, s, pid);
      case "visit-summary": return visitSummary(db, s, pid);
      case "sharing": return patientSharing(db, s, pid);
      case "shares": return personalShares(db, s, pid);
      default: throw new HandoffError("Not found.");
    }
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  // Ids are UUIDs; anything else is a bad request, not a database error.
  if (typeof b.id !== "undefined" && !/^[0-9a-f-]{36}$/i.test(String(b.id))) return handle(req, ["patient"], async () => { throw new HandoffError("That item is gone. Go back and try again."); });
  const obj = (k: string) => (b[k] && typeof b[k] === "object" ? (b[k] as Record<string, unknown>) : {});
  return handle(req, ["patient"], async (s) => {
    const db = await getDb();
    const pid = s.patientId!;
    switch (action) {
      case "profile": return updateSoloProfile(db, s, pid, { stage: b.stage as string | undefined, clinicName: b.clinicName as string | undefined, afterHoursPhone: b.afterHoursPhone as string | undefined });
      case "ask-clinic": return askMyClinic(db, s, pid, str("clinicName"));
      case "capture": return addCapture(db, s, pid, { kind: str("kind") as never, mime: str("mime") || undefined, filename: str("filename") || undefined, base64: str("base64") || undefined, text: str("text") || undefined, sampleId: str("sampleId") || undefined });
      case "save-item": return saveItem(db, s, pid, str("id"), b.data && typeof b.data === "object" ? obj("data") : null, { checked: b.checked === true });
      case "dismiss-item": return dismissItem(db, s, pid, str("id"));
      case "add-med": return addMedication(db, s, pid, obj("data") as never);
      case "stop-med": return stopMedication(db, s, pid, str("id"));
      case "supply": return setMedSupply(db, s, pid, str("medication"), b.doses === null || b.doses === undefined || b.doses === "" ? null : Number(b.doses));
      case "add-result": return addResult(db, s, pid, obj("data") as never);
      case "delete-result": return deleteResult(db, s, pid, str("id"));
      case "add-appointment": return addAppointment(db, s, pid, obj("data") as never);
      case "delete-appointment": return deleteAppointment(db, s, pid, str("id"));
      case "add-cost": return addCost(db, s, pid, obj("data") as never);
      case "delete-cost": return deleteCost(db, s, pid, str("id"));
      case "add-question": return addQuestion(db, s, pid, str("text"));
      case "question-asked": return setQuestionAsked(db, s, pid, str("id"), b.asked === true);
      case "delete-question": return deleteQuestion(db, s, pid, str("id"));
      case "calendar": {
        const { token } = await newCalendarLink(db, s, pid, { detail: b.detail === true });
        const url = `${await baseUrl()}/api/integrations/calendar/${token}`;
        return { url, webcal: url.replace(/^https?:/, "webcal:") };
      }
      case "calendar-off": return stopCalendarLink(db, s, pid);
      case "delete-account": return deleteMyAccount(db, s, str("confirm"));
      case "about": return saveAbout(db, s, pid, obj("patch") as never, { consent: b.consent === true, step: (str("step") || undefined) as never });
      case "about-withdraw": return withdrawAboutConsent(db, s, pid);
      case "tender-add": return addTenderDate(db, s, pid, obj("date") as never);
      case "tender-delete": return deleteTenderDate(db, s, pid, str("id"));
      case "quiet": return setQuiet(db, s, pid, { pauseDays: b.pauseDays === undefined ? undefined : (b.pauseDays as number | null), onBreak: typeof b.onBreak === "boolean" ? b.onBreak : undefined });
      case "kit": return saveKit(db, s, pid, obj("patch"));
      case "med-last-day": return setMedLastDay(db, s, pid, str("medication"), str("lastDay"));
      case "share-summary": {
        const made = await createPersonalShare(db, s, pid, { recipient: str("recipient"), includeResults: b.includeResults === true, includeMeds: b.includeMeds === true });
        return { id: made.id, expiresAt: made.expiresAt, url: `${await baseUrl()}/summary/${made.token}` };
      }
      case "stop-share": return stopSummaryShare(db, s, str("id"));
      case "alias": return setAlias(db, s, pid, { alias: str("alias"), icon: str("icon"), tint: str("tint"), shows: Array.isArray(b.shows) ? (b.shows as string[]) : [] });
      default: throw new HandoffError("Not found.");
    }
  });
}
