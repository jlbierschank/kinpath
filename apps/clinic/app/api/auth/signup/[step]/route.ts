import { finishSignup, isPersonalSpace, requestSignup, sessionFromToken, verifySignup } from "@kinpath/db";
import { HandoffError } from "@kinpath/core";
import { getDb } from "@/lib/db";
import { open, preflight } from "@/lib/api";

/** Sign up on your own: start (send a code or join the waitlist), verify (code → ticket), finish (create her space). */
export const OPTIONS = preflight;
export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  const { step } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  return open(req, async () => {
    const db = await getDb();
    if (step === "start") return requestSignup(db, s("identifier"));
    if (step === "verify") return verifySignup(db, s("identifier"), s("code"));
    if (step === "finish") {
      const out = await finishSignup(db, s("ticket"), { firstName: s("firstName"), lastName: s("lastName"), stage: s("stage"), clinicName: s("clinicName"), afterHoursPhone: s("afterHoursPhone"), timeZone: s("timeZone") }, s("device") || "Phone app");
      const session = (await sessionFromToken(db, out.token))!;
      return { ...out, space: (await isPersonalSpace(db, session.clinicId)) ? "personal" : "clinic" };
    }
    throw new HandoffError("Unknown step.");
  });
}
