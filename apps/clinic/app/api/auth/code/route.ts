import { requestSignInCode } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { open, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { identifier?: string };
  return open(req, async () => requestSignInCode(await getDb(), String(b.identifier ?? "")));
}
