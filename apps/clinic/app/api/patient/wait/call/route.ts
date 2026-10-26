import { askForCall } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { why?: string };
  return handle(req, ["patient"], async (s) => ({ ok: await askForCall(await getDb(), s, s.patientId!, String(b.why ?? "")) }));
}
