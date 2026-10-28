import "server-only";
import { deliverDue, sendersFromEnv } from "@kinpath/db";
import { getDb } from "./db";
import { logError } from "./config";

/** Sends the outbox every few seconds once an email or text provider is set (see docs/TESTING.md). */
export function startSender() {
  const g = globalThis as unknown as { __kinpathSender?: NodeJS.Timeout };
  if (g.__kinpathSender) return;
  const senders = sendersFromEnv();
  for (const p of senders.problems) console.error(JSON.stringify({ level: "error", where: "sender", message: p }));
  if (!senders.email && !senders.sms) return;
  console.log(JSON.stringify({ level: "info", where: "sender", on: senders.on }));
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await deliverDue(await getDb(), senders);
      if (r.sent || r.failed || r.retry) console.log(JSON.stringify({ level: "info", where: "sender", ...r }));
    } catch (e) { logError("sender", e); } finally { busy = false; }
  };
  g.__kinpathSender = setInterval(run, Number(process.env.KINPATH_SEND_SECONDS ?? 5) * 1000);
  g.__kinpathSender.unref?.();
}
