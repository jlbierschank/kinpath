import { setPartnerSharing } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { partnerUserId?: string; sections?: string[] };
  return handle(req, ["patient"], async (s) =>
    setPartnerSharing(await getDb(), s, s.patientId!, String(body.partnerUserId ?? ""), Array.isArray(body.sections) ? body.sections.map(String) : []));
}
