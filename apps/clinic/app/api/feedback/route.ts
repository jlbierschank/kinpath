import { sendFeedback } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** Feedback from inside the app. Kept, and emailed to the team when KINPATH_TEAM_EMAIL is set. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(req, ["patient", "partner"], async (s) =>
    sendFeedback(await getDb(), s, { body: String(b.body ?? ""), screen: typeof b.screen === "string" ? b.screen : undefined, appVersion: typeof b.appVersion === "string" ? b.appVersion : undefined }));
}
