import { reportMissedDose } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { note?: string };
  return handle(req, ["patient"], async (s) => reportMissedDose(await getDb(), s, { patientId: s.patientId!, doseLogId: id, note: body.note }));
}
