import { calendarFeed } from "@kinpath/db";
import { getDb } from "@/lib/db";

/** Her private calendar feed (subscribed from her calendar app; the secret link is the key). */
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ics = await calendarFeed(await getDb(), token.replace(/\.ics$/, ""));
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
