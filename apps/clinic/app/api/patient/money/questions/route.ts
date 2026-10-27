import { askAboutCosts } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { question?: string; estimateId?: string };
  return handle(req, ["patient"], async (s) => askAboutCosts(await getDb(), s, { patientId: s.patientId!, question: String(b.question ?? ""), estimateId: b.estimateId ?? null }));
}
