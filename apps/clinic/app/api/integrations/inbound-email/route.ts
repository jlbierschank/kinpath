import { timingSafeEqual } from "node:crypto";
import { receiveForwardedEmail } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/config";

/**
 * Forwarded emails (add+<token>@in.thepumpkin.ai), posted here by the inbound email service as JSON:
 * { to, subject, text, attachments: [{ filename, contentType, contentBase64 }] }.
 * Off unless KINPATH_INBOUND_SECRET is set; the service sends it in the x-pumpkin-inbound-secret header.
 */
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const secret = process.env.KINPATH_INBOUND_SECRET;
  const got = req.headers.get("x-pumpkin-inbound-secret") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response("Not found", { status: 404 });
  try {
    const b = (await req.json()) as { to?: string; subject?: string; text?: string; attachments?: { filename?: string; contentType?: string; contentBase64: string }[] };
    const r = await receiveForwardedEmail(await getDb(), { to: String(b.to ?? ""), subject: b.subject, text: b.text, attachments: Array.isArray(b.attachments) ? b.attachments : [] });
    // Always 200 so the sender can't probe which addresses exist.
    return Response.json({ ok: true, accepted: r.accepted });
  } catch (e) {
    logError("/api/integrations/inbound-email", e);
    return Response.json({ ok: true, accepted: false });
  }
}
