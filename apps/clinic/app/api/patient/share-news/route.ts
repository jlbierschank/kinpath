import { shareNews } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  return handle(req, ["patient"], async (s) => ({ ok: await shareNews(await getDb(), s, s.patientId!) }));
}
