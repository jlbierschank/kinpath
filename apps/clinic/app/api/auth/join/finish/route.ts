import { finishJoin } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { open, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { code?: string; confirm?: string; device?: string };
  return open(req, async () => {
    const r = await finishJoin(await getDb(), String(b.code ?? ""), String(b.confirm ?? ""), String(b.device ?? "Phone app"));
    return { token: r.token, userId: r.userId, name: r.name, patientFirstName: r.patientFirstName, role: "partner" };
  });
}
