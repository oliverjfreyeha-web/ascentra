import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listRequests } from "@/lib/path/path";

// L7: the Course Admin queue of anonymous requests (topic, level and how many asked). ?status=open|planned|dismissed
export const GET = withCap("course_requests.view", async (req) => ok({ requests: await listRequests(new URL(req.url).searchParams.get("status")) }));
