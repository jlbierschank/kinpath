import { removeSupportPerson } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { partnerUserId?: string };
  return handle(req, ["patient"], async (s) => ({ ok: await removeSupportPerson(await getDb(), s, s.patientId!, String(b.partnerUserId ?? "")) }));
}
