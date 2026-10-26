import { setWaitPrefs } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { resultHow?: string; hideDayCount?: boolean; quietOff?: boolean };
  return handle(req, ["patient"], async (s) => ({
    ok: await setWaitPrefs(await getDb(), s, s.patientId!, {
      resultHow: typeof b.resultHow === "string" ? b.resultHow : undefined,
      hideDayCount: typeof b.hideDayCount === "boolean" ? b.hideDayCount : undefined,
      quietOff: typeof b.quietOff === "boolean" ? b.quietOff : undefined,
    }),
  }));
}
