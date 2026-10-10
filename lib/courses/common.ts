import "server-only";
import type { Account } from "@/lib/auth";
import type { AuditInput } from "@/lib/audit";
import { OWNER_ACADEMY_SLUG, decide, type Action } from "@/lib/caps";

/** L2: shared pieces for course generation (research, blueprints, lesson versions, the learner view). */
export type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type Result<T = Record<string, unknown>> =
  | { ok: true; status?: number; body: T; event: Event }
  | { ok: false; status: number; reason: string; event: Event };
export const refused = (status: number, reason: string, action: string, target: Event["target"] = null): Result<never> =>
  ({ ok: false, status, reason, event: { action, result: "Blocked", context: `Refused: ${reason}`, target } });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export { ATTORNEY, NO_ATTORNEY } from "./wording";
export const AUDIENCES = ["beginner", "intermediate", "advanced"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const isAudience = (v: unknown): v is Audience => typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
export const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export const DEFAULT_FRESHNESS = "What tools, terms and methods are current, and what has become outdated?";

/**
 * The course scope on top of the route's capability: Course Admins and Reviewers act on their assigned courses only
 * (courses.edit / courses.review / courses.publish in lib/caps.ts); nobody but the Owner reaches the Owner Academy.
 */
export function courseScope(account: Account, action: Extract<Action, "courses.edit" | "courses.review" | "courses.publish">, slug: string): string | null {
  if (slug === OWNER_ACADEMY_SLUG) return "The Owner Academy is never generated or changed here.";
  const d = decide({ role: account.roleKey, assignedCourses: account.assignedCourses }, action, { course: slug });
  return d.allowed ? null : "You can only work on courses assigned to you.";
}

/** Who may see a course in the builder: the Owner and Super Admins see every course; others their assigned ones. */
export function canSeeCourse(account: Account, slug: string): boolean {
  if (slug === OWNER_ACADEMY_SLUG) return false;
  return account.roleKey === "owner" || account.roleKey === "superAdmin" || account.assignedCourses.includes(slug);
}

/** The longest run of words a text shares with a source passage: a long run means it was copied, not rewritten. */
export function longestSharedRun(text: string, passage: string): number {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const a = words(text);
  const b = words(passage);
  if (!a.length || !b.length) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}
