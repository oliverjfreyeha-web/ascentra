/**
 * Design rebuild D6/D7 · Every restyled route (D4, D5 and D6) with the role and test data it opens with, shared by
 * design-routes.spec.ts and the D7 contrast sampling.
 */
import { D6_API, D6_LESSON_ID } from "./d6-data";
import { COURSES, PROFILE_PROGRESS, PROGRESS } from "./d4-data";

export type Route = { path: string; role: string | null; api?: Record<string, unknown>; calm: boolean; status?: Record<string, number> };
const R = (path: string, role: string | null, calm: boolean, api?: Record<string, unknown>): Route => ({ path, role, calm, api });
export const ROUTES: Route[] = [
  R("/admin", "owner", true, D6_API.admin), R("/admin/audit", "owner", true, D6_API.audit), R("/admin/safety", "owner", true, D6_API.safety),
  R("/admin/review", "owner", true, D6_API.review), R("/admin/import", "owner", true, D6_API.import), R("/admin/security", "owner", true),
  R("/admin/topics", "owner", true), R("/admin/courses", "owner", true), R("/admin/sources", "owner", true), R("/admin/catalog", "owner", true),
  R("/admin/course-requests", "owner", true), R("/admin/missions", "owner", true),
  R("/account", "learner", true, D6_API.account), R("/guardian", "guardian", true, D6_API.guardian), { ...R("/pro", "learner", true, D6_API.pro), status: { "/api/v1/pro": 403 } },
  R("/sign-in", null, true), R("/sign-up", null, true), R("/welcome", "learner", true, D6_API.welcome), R("/credits", null, true),
  R("/not-available", null, true), R("/not-open", "learner", true), R("/missing", null, true),
  R("/learn/path", "learner", false, D6_API.path), R("/learn/track/copywriting", "learner", false, D6_API.track), R(`/learn/${D6_LESSON_ID}`, "learner", false, D6_API.lesson),
  R("/learn/choose", "learner", false), R("/learn/leaderboard", "learner", false), R("/learn/notebook", "learner", false), R("/community", "learner", false),
  // D7: the D4 and D5 pages too (Home signed in and as a visitor, the Library, My progress with the Profile dashboard).
  R("/", "learner", false, { "/api/v1/learn/progress": PROGRESS }), R("/", null, false), R("/learn", "learner", false, { "/api/v1/learn/courses": COURSES, "/api/v1/learn/progress": PROGRESS }),
  R("/learn/progress", "learner", false, { "/api/v1/learn/progress": PROFILE_PROGRESS }),
];
