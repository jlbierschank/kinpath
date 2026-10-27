import { isPersonalSpace } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** Who's signed in, and whether they're in a clinic's space or their own. */
export async function GET(req: Request) {
  return handle(req, ["patient", "partner"], async (s) => ({ name: s.name, role: s.role, space: (await isPersonalSpace(await getDb(), s.clinicId)) ? "personal" : "clinic" }));
}
