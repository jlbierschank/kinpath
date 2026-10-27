import { patientMoney } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** Only what she shares: row-level security returns nothing unless 'money' is shared. Never her questions. */
export async function GET(req: Request) {
  return handle(req, ["partner"], async (s) => {
    const m = await patientMoney(await getDb(), s, s.patientId!);
    return { ...m, questions: [] };
  });
}
