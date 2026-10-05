import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { learnerCourses } from "@/lib/courses/learn";

// L2: published courses and lessons only. Drafts and versions in Review never appear here.
export const GET = withCap("learn", async (_req, _ctx, account) => ok({ courses: await learnerCourses(account) }));
