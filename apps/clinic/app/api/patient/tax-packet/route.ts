import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";
import { taxPacketResponse } from "@/lib/tax-pdf";

/** A clinic's patient's year-end packet: the payments in her record for a year, as a list, CSV or PDF. */
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient"], async (s) => taxPacketResponse(await getDb(), s, s.patientId!, req.url));
}
