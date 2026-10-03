import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listCourses } from "@/lib/courses/admin";

// L2: the course builder's list (assigned courses only, for Course Admins and Reviewers).
export const GET = withCap("courses.view", async (_req, _ctx, account) => ok({ courses: await listCourses(account) }));
