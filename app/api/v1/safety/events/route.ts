import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { safetyQueue } from "@/lib/mentor/safety-queue";

// L4: the safety review queue (?status=open|reviewed). Categories and actions only, never conversation text.
export const GET = withCap("safety.view", async (req) => ok({ events: await safetyQueue(new URL(req.url).searchParams.get("status")) }));
