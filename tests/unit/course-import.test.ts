/**
 * I1: the course import file's checks, as pure functions: a valid file; each kind of invalid file with the exact path;
 * the tier and module counts; difficulty order; sources and labels; at least 3 task types per module; recipe caps; the
 * income-claims and attorney checks on every text field; HTML and script stripping; https-only links; unknown and
 * published topics; a business capstone without "Automation with AI". The database side (one transaction, new
 * versions, Owner only) is tested on Postgres in tests/db/course-import.test.ts and through the routes in
 * tests/integration/course-import.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkImport, stripHtml, type ImportContext } from "@/lib/courses/import-format";
import { sampleCourse } from "../fixtures/course-import";

const ctx = (over: Partial<NonNullable<ImportContext["topic"]>> | null = {}): ImportContext => ({
  topic: over === null ? null : { slug: "graphic-design", name: "Freelance graphic design", kind: "business", teenHidden: false, published: false, draftVersions: 0, ...over },
  skillSlugs: new Set(["copywriting"]),
  boosters: [{ key: "teach-it-back", itemTypes: ["teach_back"] }, { key: "common-mistakes-hunt", itemTypes: ["spot_the_mistake"] }],
  today: "2026-10-10",
});
const check = (doc: unknown, c = ctx()) => checkImport(JSON.stringify(doc), c);
const paths = (doc: unknown, c = ctx()) => check(doc, c).problems.map((p) => `${p.path}: ${p.message}`);
const edit = (f: (d: ReturnType<typeof sampleCourse>) => void) => { const d = sampleCourse(); f(d); return d; };

describe("a valid file", () => {
  it("checks clean and says what would be created, writing nothing", () => {
    const r = check(sampleCourse());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ modules: 3, lessons: 3, videoSlots: 3, sources: 1, resources: 2, resourcesHidden: 1, capstone: true, notices: 1, items: { video: 3, quiz: 3, assignment: 3, sandbox: 3, sequence: 3 } });
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/stored but not shown to learners/);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/summarized and credited, never copied/);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/Practice \(simulated\)/);
  });

  it("the plan holds only what the file holds, with sources as placeholders the database replaces", () => {
    const plan = check(sampleCourse()).plan!;
    expect(plan.sizeTier).toBe("compact");
    expect(plan.modules[0].items.map((i) => [i.itemType, i.part, i.importance])).toEqual([
      ["multiple_choice", "quiz", "very_important"], ["short_answer", "assignment", "should_know"], ["spot_the_mistake", "sandbox", "important"], ["ordering", "sequence", "should_know"],
    ]);
    expect(plan.modules[0].items[0].notebookNote).toMatch(/one clear message/);
    expect(plan.modules[0].videos[0]).toMatchObject({ title: "Test video 1", importance: "important", brief: { targetMinutes: 5, points: [{ text: expect.any(String), sources: [{ sourceId: "@@src:s1@@" }] }] } });
    expect(plan.modules[0].lessons[0].citations).toEqual([expect.objectContaining({ ref: 1, sourceId: "@@src:s1@@", url: "https://example.org/test-design-basics" })]);
    expect(plan.capstone.automation).toEqual({ what: expect.any(String), prompts: ["Test headline helper: Test: suggest three short headlines for a practice flyer."], plans: [] });
    // No topic cost or outlook fields are ever in the plan.
    expect(JSON.stringify(plan)).not.toMatch(/cost_low|costLow|outlook/);
  });

  it("docs/COURSE-IMPORT.md shows this same sample file", () => {
    const md = readFileSync("docs/COURSE-IMPORT.md", "utf8");
    const json = md.match(/```json\n([\s\S]*?)\n```/)![1];
    expect(JSON.parse(json)).toEqual(sampleCourse());
  });
});

describe("refused files, with the exact path", () => {
  it("not JSON, too large, wrong version, unknown fields", () => {
    expect(checkImport("{ not json", ctx()).problems[0]).toMatchObject({ path: "(file)", message: expect.stringMatching(/isn't valid JSON/) });
    expect(checkImport("x".repeat(2 * 1024 * 1024 + 1), ctx()).problems[0].message).toMatch(/2 MB at most/);
    expect(paths({ ...sampleCourse(), formatVersion: 2 })).toContain("formatVersion: must be 1");
    expect(paths({ ...sampleCourse(), extra: true })[0]).toMatch(/^\(file\): unknown field\(s\): extra/);
  });

  it("an unknown topic, or one already published as a course", () => {
    expect(paths(sampleCourse(), ctx(null))[0]).toMatch(/^topicSlug: unknown topic "graphic-design"/);
    expect(paths(sampleCourse(), ctx({ published: true }))[0]).toMatch(/^topicSlug: .*already has a published course/);
  });

  it("the module count must fit the size tier", () => {
    expect(paths(edit((d) => { d.course.sizeTier = "standard"; }))).toContain("modules: A Standard course has 5 to 6 modules (this one has 3).");
    expect(paths(edit((d) => { d.modules = d.modules.slice(0, 2); }))).toContain("modules: A Compact course has 3 to 4 modules (this one has 2).");
  });

  it("difficulty never goes down; modules are numbered in order", () => {
    expect(paths(edit((d) => { d.modules[2].difficulty = 1; }))).toContain("modules[2].difficulty: difficulty can't go down (module 2 is 2, this is 1)");
    expect(paths(edit((d) => { d.modules[1].number = 3; })).join(" ")).toMatch(/modules\[1\]\.number: modules are numbered 1, 2, 3/);
  });

  it("every item cites a source that exists; every source id is unique", () => {
    expect(paths(edit((d) => { d.modules[2].items[4].sourceIds = ["nope"]; }))).toContain("modules[2].items[4].sourceIds[0]: unknown source \"nope\"");
    expect(paths(edit((d) => { d.modules[0].items[1].sourceIds = []; }))).toContain("modules[0].items[1].sourceIds: needs at least 1");
    expect(paths(edit((d) => { d.sources.push({ ...d.sources[0], link: "https://example.org/other" }); }))).toContain("sources[1].id: duplicate source id \"s1\" (also sources[0])");
    expect(paths(edit((d) => { d.modules[0].lessons[0].sections[0].paragraphs[0].sourceIds = ["x"]; }))).toContain("modules[0].lessons[0].sections[0].paragraphs[0].sourceIds[0]: unknown source \"x\"");
  });

  it("every item has an importance label; a Very important one its Notebook note", () => {
    expect(paths(edit((d) => { delete (d.modules[0].items[2] as Record<string, unknown>).importance; })).join(" ")).toMatch(/modules\[0\]\.items\[2\]\.importance/);
    expect(paths(edit((d) => { delete (d.modules[0].items[1] as Record<string, unknown>).notebookNote; }))).toContain("modules[0].items[1].notebookNote: a Very important item needs its Notebook note (20 to 800 characters)");
  });

  it("only task types the app supports, in the part they fit, with content in that type's shape", () => {
    expect(paths(edit((d) => { d.modules[0].items[2].taskType = "live_client_call"; }))[0]).toMatch(/^modules\[0\]\.items\[2\]\.taskType: "live_client_call" isn't a task type the app supports\. Use one of: multiple_choice/);
    expect(paths(edit((d) => { d.modules[0].items[2].taskType = "multiple_choice"; })).join(" ")).toMatch(/modules\[0\]\.items\[2\]\.taskType: a assignment can't be a Multiple choice/);
    expect(paths(edit((d) => { d.modules[0].items[1].answerKey = { correct: 7 }; }))).toContain("modules[0].items[1].content: Give 2 to 6 options and the correct one.");
    expect(paths(edit((d) => { delete (d.modules[0].items[1] as Record<string, unknown>).answerKey; }))).toContain("modules[0].items[1].answerKey: A code-graded item needs an answer key.");
    expect(paths(edit((d) => { delete (d.modules[0].items[0] as Record<string, unknown>).videoBrief; }))[0]).toMatch(/^modules\[0\]\.items\[0\]\.videoBrief: a video item needs its brief/);
  });

  it("at least 3 different task types per module", () => {
    expect(paths(edit((d) => { d.modules[1].items = d.modules[1].items.slice(0, 3); }))).toContain("modules[1].items: needs at least 3 different task types (has 2)");
  });

  it("recipe counts within the caps; boosters from the list", () => {
    expect(paths(edit((d) => { d.modules[0].recipe.quizzes = 9; }))).toContain("modules[0].recipe: Quizzes: choose 1 to 4.");
    expect(paths(edit((d) => { (d.modules[0].recipe.boosters as string[]) = ["made-up"]; }))).toContain("modules[0].recipe: \"made-up\" isn't on the list of learning boosters.");
  });

  it("links are https only; dates are past", () => {
    expect(paths(edit((d) => { d.sources[0].link = "http://example.org/x"; }))).toContain("sources[0].link: must be an https:// link");
    expect(paths(edit((d) => { d.resources[0].link = "javascript:alert(1)"; }))).toContain("resources[0].link: must be an https:// link");
    expect(paths(edit((d) => { d.course.marketing = "See data:text/html;base64,AAAA"; }))).toContain("course.marketing: contains a script or data link; only https links are allowed");
    expect(paths(edit((d) => { d.course.toolsAndCosts[0].checkedOn = "2027-01-01"; }))).toContain("course.toolsAndCosts[0].checkedOn: a checked-on date can't be in the future");
  });

  it("the income-claims check runs on every text field, with the exact text and its path", () => {
    expect(paths(edit((d) => { d.modules[1].lessons[0].sections[0].paragraphs[0].text = "Follow these steps and you will earn $5,000 a month."; })))
      .toContain('modules[1].lessons[0].sections[0].paragraphs[0].text: reads as a promise to make or earn money: "earn $5,000". Reword it.');
    expect(paths(edit((d) => { d.course.growth = ["Build passive income from flyers."]; }))).toContain('course.growth[0]: reads as passive income: "passive income". Reword it.');
    expect(paths(edit((d) => { d.capstone.automation!.masterPrompts[0].purpose = "Help me get rich fast."; })).join(" ")).toMatch(/capstone\.automation\.masterPrompts\[0\]\.purpose: reads as get rich/);
    expect(paths(edit((d) => { d.course.legalChecklist = ["Our contract is attorney-approved."]; }))).toContain("course.legalChecklist[0]: ASCENTRA never calls anything attorney-approved. Reword it.");
  });

  it("a business course's capstone needs Automation with AI; a skill's doesn't", () => {
    const d = edit((x) => { delete (x.capstone as Record<string, unknown>).automation; });
    expect(paths(d)).toContain("capstone.automation: a business course's capstone needs \"Automation with AI\" (whatAutomated, masterPrompts, aiPlans)");
    expect(check(d, ctx({ kind: "skill" })).ok).toBe(true);
  });

  it("unknown skills, and a teen setting that differs from the topic only warns (the topic isn't changed)", () => {
    expect(paths(edit((d) => { (d.course.skillsTaught as string[]) = ["no-such-skill"]; }))).toContain("course.skillsTaught[0]: unknown skill \"no-such-skill\"");
    const r = check(sampleCourse(), ctx({ teenHidden: true }));
    expect(r.ok).toBe(true);
    expect(r.warnings.find((w) => w.path === "course.teenStatus")?.message).toMatch(/doesn't change the topic/);
  });
});

describe("untrusted text", () => {
  it("strips HTML and scripts from every string, keeping the text", () => {
    expect(stripHtml('Hello <b>bold</b><script>alert("x")</script> world<img src=x onerror=alert(1)>')).toBe("Hello bold world");
    expect(stripHtml("a <style>p{}</style>b <!-- c -->d")).toBe("a b d");
    const r = check(edit((d) => { d.modules[0].lessons[0].summary = 'Test <script>steal()</script><i>summary</i>.'; }));
    expect(r.ok).toBe(true);
    expect((r.plan!.modules[0].lessons[0].body as { summary: string }).summary).toBe("Test summary.");
    expect(r.warnings[0].message).toMatch(/HTML or script was removed from 1 field/);
  });

  it("an object key like __proto__ is dropped, never applied", () => {
    const raw = JSON.stringify(sampleCourse()).replace('"formatVersion":1', '"__proto__":{"polluted":true},"formatVersion":1');
    const r = checkImport(raw, ctx());
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
