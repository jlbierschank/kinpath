import { requestRefill } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

/** A clinic's patient asks for a refill. It lands in the nurse queue like a message. */
export const OPTIONS = preflight;
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { medication?: string; note?: string };
  return handle(req, ["patient"], async (s) => requestRefill(await getDb(), s, s.patientId!, { medication: body.medication ?? "", note: body.note ?? "" }));
}
