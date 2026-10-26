import { markNotificationsRead, myNotifications } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient", "partner"], async (s) => myNotifications(await getDb(), s, 50));
}
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { ids?: string[] | "all" };
  return handle(req, ["patient", "partner"], async (s) => ({ ok: await markNotificationsRead(await getDb(), s, b.ids === "all" ? "all" : Array.isArray(b.ids) ? b.ids.map(String) : []) }));
}
