import { medGuide } from "@kinpath/db";
import { HandoffError } from "@kinpath/core";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function GET(req: Request, { params }: { params: Promise<{ medication: string }> }) {
  const { medication } = await params;
  return handle(req, ["patient", "partner"], async (s) => {
    const g = await medGuide(await getDb(), s, decodeURIComponent(medication));
    if (!g) throw new HandoffError("No walkthrough yet. Your nurse can help.");
    return { medication: g.medication, steps: g.steps, videoUrl: g.video_url, approvedBy: g.approved_by };
  });
}
