import { isPersonalSpace, sessionFromToken, verifySignInCode } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { open, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { identifier?: string; code?: string; device?: string };
  return open(req, async () => {
    const db = await getDb();
    const { token } = await verifySignInCode(db, String(b.identifier ?? ""), String(b.code ?? ""), String(b.device ?? "Phone app"));
    const s = (await sessionFromToken(db, token))!;
    return { token, userId: s.userId, name: s.name, role: s.role, space: (await isPersonalSpace(db, s.clinicId)) ? "personal" : "clinic" };
  });
}
