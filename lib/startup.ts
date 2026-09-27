import "server-only";
import { getServerEnv } from "@/lib/env";

export function assertEnvOrExit() {
  try {
    getServerEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
