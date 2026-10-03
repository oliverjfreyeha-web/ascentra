import { withCap } from "@/lib/auth";
import { aiStatus } from "@/lib/ai";
import { ok } from "@/lib/http";

// The AI orchestration service (L1): configured or off, the models per job, spend against the caps, provider status.
export const GET = withCap("ai.status", async () => ok(await aiStatus()));
