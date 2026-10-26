import { createInvite } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; relationship?: string; contact?: string; sections?: string[] };
  return handle(req, ["patient"], async (s) => createInvite(await getDb(), s, s.patientId!, {
    name: String(b.name ?? ""), relationship: String(b.relationship ?? ""), contact: String(b.contact ?? ""),
    sections: Array.isArray(b.sections) ? b.sections.map(String) : [],
  }));
}
