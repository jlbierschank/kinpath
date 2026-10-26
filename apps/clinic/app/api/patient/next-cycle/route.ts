import { patientNextCycle, saveNextCyclePlan } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient"], async (s) => patientNextCycle(await getDb(), s, s.patientId!));
}
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { questions?: string; ready?: boolean };
  return handle(req, ["patient"], async (s) => saveNextCyclePlan(await getDb(), s, s.patientId!, {
    questions: typeof b.questions === "string" ? b.questions : undefined, ready: b.ready === true,
  }));
}
