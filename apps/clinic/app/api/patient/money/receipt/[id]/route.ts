import { paymentReceipt } from "@kinpath/db";
import { HandoffError } from "@kinpath/core";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** A payment receipt (for HSA, FSA or taxes). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, ["patient", "partner"], async (s) => {
    const r = await paymentReceipt(await getDb(), s, id);
    if (!r) throw new HandoffError("That receipt wasn't found.");
    return r;
  });
}
