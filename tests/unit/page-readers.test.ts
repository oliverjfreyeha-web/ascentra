/**
 * L2: every page that calls a course-generation endpoint reads the answer through that endpoint's reader in
 * app/courses-api.ts, never by hand. tests/integration/course-generation.test.ts passes the real routes' answers
 * through the same readers, so a page and its API can't disagree about the shape (the L1 /api/v1/me lesson).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Endpoint (as it appears in a page) → the reader that page must use. */
const READERS: [RegExp, string][] = [
  [/["'`]\/api\/v1\/sources\/research["'`]/, "researchRunsFrom"],
  [/\/api\/v1\/courses\/estimate/, "estimateFrom"],
  [/["'`]\/api\/v1\/courses["'`]/, "coursesFrom"],
  [/`\/api\/v1\/courses\/\$\{encodeURIComponent\(slug\)\}`/, "courseDetailFrom"],
  [/\/api\/v1\/learn\/courses/, "learnerCoursesFrom"],
  [/\/api\/v1\/learn\/lessons\//, "learnerLessonFrom"],
  [/["'`]\/api\/v1\/sources\?status=approved["'`]/, "librarySourcesFrom"],
  // L4
  [/\/api\/v1\/mentor\/threads\?lessonId=/, "mentorThreadsFrom"],
  [/\/api\/v1\/mentor\/threads\/\$\{/, "mentorThreadFrom"],
  [/call\("POST", "\/api\/v1\/mentor"/, "mentorReplyFrom"],
  [/\/api\/v1\/safety\/events\?status=/, "safetyEventsFrom"],
  // L5: the Mentor allowance parts of the billing and Guardian answers.
  [/call\("GET", "\/api\/v1\/billing"\)/, "mentorAddonFrom"],
  [/call\("GET", "\/api\/v1\/guardian"\)/, "teenAllowancesFrom"],
  [/"\/api\/v1\/billing\/mentor-addon", body\(\{ agreed: false \}\)/, "addonQuoteFrom"],
  [/"\/api\/v1\/billing\/mentor-addon", body\(\{ confirm: true/, "addonChangeFrom"],
  // L6: the topic catalog and the activity library.
  [/call\("GET", "\/api\/v1\/catalog"\)/, "catalogFrom"],
  [/"\/api\/v1\/catalog\/queue", \{ slugs: picked \}/, "batchQuoteFrom"],
  [/"\/api\/v1\/catalog\/queue", \{ slugs: picked, confirm: true/, "batchQueuedFrom"],
  [/`\$\{base\}\/activities`\)/, "libraryFrom"],
  [/`\$\{base\}\/lessons\/\$\{l\.id\}\/activities`/, "poolDraftedFrom"],
  [/`\$\{base\}\/lessons\/\$\{l\.id\}\/misses`/, "missesFrom"],
  [/`\$\{base\}\/modules\/\$\{m\.id\}\/activities\/publish`, \{ reason/, "modulePublishedFrom"],
  [/`\$\{base\}\/activities\/\$\{i\.id\}\/review`/, "itemStatusFrom"],
  [/\/api\/v1\/learn\/activities\/\$\{a\.id\}\/attempt/, "attemptFrom"],
  [/\/api\/v1\/learn\/activities\/\$\{a\.id\}\/feedback/, "feedbackFrom"],
  [/\/api\/v1\/learn\/lessons\/\$\{encodeURIComponent\(id\)\}/, "lessonActivitiesFrom"],
];

const pages = (function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return p === join("app", "api") ? [] : walk(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
})("app");

describe("pages read the course-generation API through its readers", () => {
  it.each(READERS.map(([re, reader]) => [reader, re] as const))("%s", (reader, re) => {
    const callers = pages.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(callers.length, `no page calls the endpoint ${re}`).toBeGreaterThan(0);
    for (const f of callers) expect(readFileSync(f, "utf8"), f).toMatch(new RegExp(`\\b${reader}\\(`));
  });

  it("the research POST is read with researchResultFrom", () => {
    const src = readFileSync("app/admin/sources/research-panel.tsx", "utf8");
    expect(src).toMatch(/call\("POST", "\/api\/v1\/sources\/research"/);
    expect(src).toMatch(/\bresearchResultFrom\(/);
  });

  it("the course builder's controls follow the roles the server allows (and publishing re-checks the second factor)", () => {
    const src = readFileSync("app/admin/courses/[slug]/course-builder.tsx", "utf8");
    expect(src).toMatch(/useReverification\(call\)/);
    expect(src).toMatch(/verified\("POST", `\$\{base\}\/versions\/\$\{v\.id\}\/publish`/);
  });
});
