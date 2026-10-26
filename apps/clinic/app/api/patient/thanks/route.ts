import { sendThankYou } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  return handle(req, ["patient"], async (s) => sendThankYou(await getDb(), s, s.patientId!, String(b.text ?? "")));
}
