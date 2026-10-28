import "server-only";

/**
 * Refuses to start a production server in an unsafe setup. Each problem is explained in words.
 * (Demo builds, with KINPATH_DEV_LOGIN=1 or pnpm dev, skip these checks.)
 */
export function checkConfig() {
  const prod = process.env.NODE_ENV === "production" && process.env.KINPATH_DEV_LOGIN !== "1";
  if (!prod) return;
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is not set. Production must use managed Postgres under a signed BAA, not the demo database.");
  else if (!/sslmode=(require|verify-full|verify-ca)/.test(process.env.DATABASE_URL) && process.env.DATABASE_SSL !== "1") problems.push("The database connection isn't encrypted. Add sslmode=require (or verify-full) to DATABASE_URL.");
  if (process.env.KINPATH_SEED_DEMO === "1") problems.push("KINPATH_SEED_DEMO must not be set in production.");
  if (process.env.KINPATH_INSECURE_COOKIES === "1") problems.push("KINPATH_INSECURE_COOKIES must not be set in production.");
  const test = process.env.KINPATH_TEST_MODE === "1";
  if (process.env.KINPATH_AI_PROVIDER && process.env.KINPATH_AI_BAA_SIGNED !== "1" && !test) problems.push("AI drafting is turned on, but KINPATH_AI_BAA_SIGNED=1 isn't set. Sign the AI vendor's BAA first (see docs/AI.md), then set it.");
  if ((process.env.KINPATH_EMAIL_PROVIDER || process.env.KINPATH_SMS_PROVIDER) && process.env.KINPATH_MESSAGING_BAA_SIGNED !== "1" && !test) problems.push("Email or texts are turned on, but KINPATH_MESSAGING_BAA_SIGNED=1 isn't set. Sign the email and text vendors' BAAs first, then set it.");
  if (test && process.env.KINPATH_AI_BAA_SIGNED !== "1" && process.env.KINPATH_AI_PROVIDER) console.warn(JSON.stringify({ level: "warn", where: "config", message: "Test build: AI reading is on without a signed BAA. Testers must use made-up information only." }));
  if (problems.length) throw new Error(`Kinpath won't start in production:\n- ${problems.join("\n- ")}`);
}

/** Error logging without health information: no SQL values, no request bodies. */
export function logError(where: string, e: unknown) {
  const err = e as { name?: string; code?: string; message?: string };
  console.error(JSON.stringify({ level: "error", where, name: err?.name, code: err?.code, message: String(err?.message ?? e).slice(0, 200).replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email]").replace(/\b\d{6,}\b/g, "[number]") }));
}
