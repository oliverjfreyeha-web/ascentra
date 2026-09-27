// Runs once when the server starts. An incomplete environment stops the server.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnvOrExit } = await import("./lib/startup");
    assertEnvOrExit();
  }
}
