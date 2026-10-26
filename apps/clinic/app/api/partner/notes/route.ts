import { sendPartnerNote } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  return handle(req, ["partner"], async (s) => {
    const r = await sendPartnerNote(await getDb(), s, String(body.text ?? ""));
    return { id: r.id, level: r.triage.level };
  });
}
