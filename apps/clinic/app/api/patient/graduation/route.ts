import { patientGraduation } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient"], async (s) => patientGraduation(await getDb(), s, s.patientId!));
}
