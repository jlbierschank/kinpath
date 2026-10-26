import { saveKeepsake } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { hidden?: string[] };
  return handle(req, ["patient"], async (s) => ({ ok: await saveKeepsake(await getDb(), s, s.patientId!, Array.isArray(b.hidden) ? b.hidden.map(String) : []) }));
}
