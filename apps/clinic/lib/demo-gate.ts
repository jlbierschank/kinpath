/**
 * Optional passcode for a shared demo (KINPATH_DEMO_PASSCODE). Keeps the public demo link to the
 * people it's given to. It is not a security control for real patient data; real sign-in is.
 */
export const DEMO_COOKIE = "kp_demo_pass";

export async function passToken(passcode: string): Promise<string> {
  const bytes = new TextEncoder().encode(`kinpath-demo:${passcode}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
