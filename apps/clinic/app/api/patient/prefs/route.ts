import { setLockScreenDetail } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { lockScreenDetail?: boolean };
  return handle(req, ["patient"], async (s) => {
    await setLockScreenDetail(await getDb(), s, s.patientId!, body.lockScreenDetail === true);
    return { ok: true };
  });
}
