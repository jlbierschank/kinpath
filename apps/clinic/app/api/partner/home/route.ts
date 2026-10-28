import { isPersonalSpace, partnerHome, partnerWait, upcomingAppointments } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(req: Request) {
  return handle(req, ["partner"], async (s) => {
    const h = await partnerHome(await getDb(), s);
    // Someone on her own has no clinic on Pumpkin: the app talks about Pumpkin and her own clinic instead.
    const clinic = (await isPersonalSpace(await getDb(), s.clinicId)) ? { name: "Pumpkin", personal: true } : { name: "Bayside Fertility", personal: false };
    if (!h.shared) return { clinic, shared: false, name: s.name };
    // Visits only when she shares her schedule (row-level security enforces this too).
    const appointments = h.sections.includes("schedule") ? await upcomingAppointments(await getDb(), s, h.patientId) : [];
    const wait = h.sections.includes("schedule") && (h.stage === "wait" || h.stage === "result") ? await partnerWait(await getDb(), s, h.patientId) : null;
    return {
      clinic, shared: true, name: s.name, firstName: h.firstName, sections: h.sections, stage: h.stage, stimDay: h.stimDay,
      schedule: h.schedule, notes: h.notes, wait, news: h.news, appointments,
      results: h.results?.map((r) => ({ id: r.id, analyte: r.analyte, value: r.value, unit: r.unit, status: r.label.status, text: r.label.patientText })) ?? null,
    };
  });
}
