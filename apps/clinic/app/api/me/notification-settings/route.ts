import { notificationSettings, setDeliverySettings, setNotificationChannels } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient", "partner"], async (s) => notificationSettings(await getDb(), s));
}
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { kind?: string; channels?: Record<string, boolean>; quiet?: { on: boolean; start: string; end: string }; phone?: string | null };
  return handle(req, ["patient", "partner"], async (s) => {
    const db = await getDb();
    if (b.kind && b.channels) await setNotificationChannels(db, s, b.kind, b.channels);
    if (b.quiet || b.phone !== undefined) await setDeliverySettings(db, s, { quiet: b.quiet, phone: b.phone });
    return notificationSettings(db, s);
  });
}
