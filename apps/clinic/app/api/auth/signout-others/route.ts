import { HandoffError } from "@kinpath/core";
import { signOutOtherDevices } from "@kinpath/db";
import { getDb } from "@/lib/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export async function POST(req: Request) {
  return handle(req, ["patient", "partner"], async (s) => {
    if (!s.token) throw new HandoffError("You're using demo sign-in.");
    return { signedOut: await signOutOtherDevices(await getDb(), s.token) };
  });
}
