import { patientMoney } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** Her costs: estimate, coverage, what's paid and owed, financing options, and her questions. */
export async function GET(req: Request) {
  return handle(req, ["patient"], async (s) => patientMoney(await getDb(), s, s.patientId!));
}
