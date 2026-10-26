import { mySessions } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient", "partner"], async (s) => (s.token ? mySessions(await getDb(), s.token) : []));
}
