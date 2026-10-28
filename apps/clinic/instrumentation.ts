/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPuller } = await import("./lib/puller");
    startPuller();
    const { startSender } = await import("./lib/sender");
    startSender();
  }
}
