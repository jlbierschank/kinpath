import { startJoin } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { open, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { code?: string; name?: string };
  return open(req, async () => startJoin(await getDb(), String(b.code ?? ""), String(b.name ?? "")));
}
