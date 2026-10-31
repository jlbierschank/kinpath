import { dataChoices, setDataChoice } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

/** A clinic's patient's own data choices. Only she can see or change them. */
export const OPTIONS = preflight;
export async function GET(req: Request) {
  return handle(req, ["patient"], async (s) => dataChoices(await getDb(), s, s.patientId!));
}
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { choice?: string; on?: boolean };
  return handle(req, ["patient"], async (s) => setDataChoice(await getDb(), s, s.patientId!, body.choice === "predictions" ? "predictions" : body.choice === "research" ? "research" : ("" as never), body.on === true));
}
