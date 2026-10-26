import "server-only";
import { pullAllEnabled } from "@kinpath/db";
import { getDb } from "./db";
import { logError } from "./config";

/** Pulls from every clinic's records system on a timer (KINPATH_FHIR_PULL_MINUTES, default 15; 0 turns it off). */
export function startPuller() {
  const g = globalThis as unknown as { __kinpathPuller?: NodeJS.Timeout };
  const minutes = Number(process.env.KINPATH_FHIR_PULL_MINUTES ?? 15);
  if (g.__kinpathPuller || !(minutes > 0)) return;
  const run = async () => {
    try {
      const r = await pullAllEnabled(await getDb());
      const n = Object.keys(r).length;
      if (n) console.log(JSON.stringify({ level: "info", where: "fhir-pull", clinics: n, results: Object.values(r).map((x) => x.split(" ")[0]) }));
    } catch (e) { logError("fhir-pull", e); }
  };
  g.__kinpathPuller = setInterval(run, minutes * 60_000);
  g.__kinpathPuller.unref?.();
}
