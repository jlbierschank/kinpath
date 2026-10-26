import { partnerHome } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(req: Request) {
  return handle(req, ["partner"], async (s) => {
    const h = await partnerHome(await getDb(), s);
    const clinic = { name: "Bayside Fertility" };
    if (!h.shared) return { clinic, shared: false, name: s.name };
    return {
      clinic, shared: true, name: s.name, firstName: h.firstName, sections: h.sections, stage: h.stage, stimDay: h.stimDay,
      schedule: h.schedule, notes: h.notes,
      results: h.results?.map((r) => ({ id: r.id, analyte: r.analyte, value: r.value, unit: r.unit, status: r.label.status, text: r.label.patientText })) ?? null,
    };
  });
}
