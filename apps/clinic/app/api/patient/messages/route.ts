import { sendPatientMessage } from "@kinpath/db";
import { HandoffError } from "@kinpath/core";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  return handle(req, ["patient"], async (s) => {
    const text = (body.text ?? "").trim();
    if (!text) throw new HandoffError("Message is empty.");
    if (text.length > 4000) throw new HandoffError("Message is too long.");
    return sendPatientMessage(await getDb(), s, { patientId: s.patientId!, text });
  });
}
