import { signOut } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { bearer, open, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  return open(req, async () => { const t = bearer(req); if (t) await signOut(await getDb(), t); return { ok: true }; });
}
