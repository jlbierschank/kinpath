import { createSummaryShare } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { recipient?: string; includeResults?: boolean; includeMeds?: boolean };
  return handle(req, ["patient"], async (s) => {
    const r = await createSummaryShare(await getDb(), s, s.patientId!, { recipient: String(b.recipient ?? ""), includeResults: b.includeResults === true, includeMeds: b.includeMeds === true });
    // The link points at this server. In production this is the clinic's HTTPS address.
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    return { id: r.id, url: `${proto}://${host}/summary/${r.token}`, expiresAt: r.expiresAt };
  });
}
