/**
 * S1: the skill track file (format version 2), as pure checks: a valid file (one Round, or all three); each kind of
 * invalid file with the exact path; 5 sections per Round; difficulty within a Round and across Rounds (against the file
 * or the stored Rounds); Round order; v1/v2 mismatches; income claims and attorney wording on every text field; HTML
 * stripping; https-only links; hands-on tasks. The database side is in tests/db/track-import.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkImport, type ImportContext, type TrackPlan } from "@/lib/courses/import-format";
import { sampleCourse, sampleTrack } from "../fixtures/course-import";

type Doc = ReturnType<typeof sampleTrack>;
const ctx = (over: Partial<NonNullable<ImportContext["topic"]>> = {}, track: ImportContext["track"] = null): ImportContext => ({
  topic: { slug: "copywriting", name: "Copywriting", kind: "skill", teenHidden: false, published: false, draftVersions: 0, ...over },
  skillSlugs: new Set(["copywriting"]), boosters: [{ key: "teach-it-back", itemTypes: ["teach_back"] }], today: "2026-10-10", track,
});
const check = (doc: unknown, c = ctx()) => checkImport(JSON.stringify(doc), c);
const paths = (doc: unknown, c = ctx()) => check(doc, c).problems.map((p) => `${p.path}: ${p.message}`);
const edit = (f: (d: Doc) => void, rounds = [1]) => { const d = sampleTrack("copywriting", rounds); f(d); return d; };
const storedMeta = (n: number, diffs: number[]) => ({ roundNumber: n, label: `Round ${n}`, goal: "g", sections: diffs.map((difficulty, i) => ({ number: i + 1, title: "t", difficulty })) });

describe("a valid file", () => {
  it("one Round checks clean and says what would be created, writing nothing", () => {
    const r = check(sampleTrack());
    expect(r.problems).toEqual([]);
    expect(r.summary).toMatchObject({ format: 2, topic: "Copywriting", modules: 5, lessons: 5, rounds: [1], carriedRounds: [], items: { quiz: 5, sandbox: 5, sequence: 5, task: 5 } });
    const plan = r.plan as TrackPlan;
    expect(plan.format).toBe(2);
    expect(plan.modules.map((m) => [m.round, m.position])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
    // A hands-on task is an existing type in the part that type fills.
    expect(plan.modules[0].items.find((i) => i.itemType === "mini_project")).toMatchObject({ part: "assignment" });
    expect(plan.blueprint).toMatchObject({ track: true, rounds: [{ roundNumber: 1, label: "Round 1: test practice", sections: expect.any(Array) }] });
    expect(JSON.stringify(plan)).not.toMatch(/sizeTier|capstone/);
  });

  it("all three Rounds at once: positions 1 to 15", () => {
    const r = check(sampleTrack("copywriting", [1, 2, 3]));
    expect(r.ok).toBe(true);
    expect((r.plan as TrackPlan).modules.map((m) => m.position)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it("Round 2 alone when Round 1 is stored: checked against the stored difficulties, and Round 1 is carried", () => {
    const stored = { rounds: [1], meta: [storedMeta(1, [1, 1, 2, 2, 3])] };
    const r = check(sampleTrack("copywriting", [2]), ctx({}, stored));
    expect(r.problems).toEqual([]);
    expect(r.summary).toMatchObject({ rounds: [2], carriedRounds: [1], newDraftVersion: true });
    expect(((r.plan as TrackPlan).blueprint.rounds as { roundNumber: number }[]).map((x) => x.roundNumber)).toEqual([1, 2]);
  });

  it("docs/COURSE-IMPORT.md shows the one-Round sample file as its v2 sample", () => {
    const md = readFileSync("docs/COURSE-IMPORT.md", "utf8");
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
    expect(blocks.find((b) => b.formatVersion === 2)).toEqual(sampleTrack());
  });
});

describe("refused files, with the exact path", () => {
  it("too large, unknown fields, a missing track field", () => {
    expect(checkImport(JSON.stringify({ ...sampleTrack(), pad: "x".repeat(2 * 1024 * 1024) }), ctx()).problems[0].message).toMatch(/2 MB at most/);
    expect(paths({ ...sampleTrack(), extra: true })[0]).toMatch(/^\(file\): unknown field\(s\): extra/);
    expect(paths(edit((d) => { delete (d.track as Record<string, unknown>).title; }))[0]).toMatch(/^track\.title: /);
    expect(paths(edit((d) => { (d as Record<string, unknown>).modules = []; }))[0]).toMatch(/unknown field\(s\): modules/);
  });

  it("a Round has exactly 5 sections; Rounds are 1 to 3, each once", () => {
    expect(paths(edit((d) => { d.rounds[0].sections.pop(); }))).toContain("rounds[0].sections: a Round has exactly 5 sections");
    expect(paths(edit((d) => { d.rounds[0].sections.push(d.rounds[0].sections[0]); }))).toContain("rounds[0].sections: a Round has exactly 5 sections");
    expect(paths(edit((d) => { d.rounds[0].roundNumber = 4; }))[0]).toMatch(/^rounds\[0\]\.roundNumber: /);
    expect(paths(edit((d) => { d.rounds = [...d.rounds, ...d.rounds]; }, [1]))).toContain("rounds[1].roundNumber: Round 1 is in the file twice");
    expect(paths(edit((d) => { d.rounds = [d.rounds[0], d.rounds[0], d.rounds[0], d.rounds[0]]; }))).toContain("rounds: 3 at most");
  });

  it("Round order: Round r can't come before Round r-1 exists (in the file or stored)", () => {
    expect(paths(sampleTrack("copywriting", [2]))).toContain("rounds[0].roundNumber: Round 2 can't be created before Round 1 exists (as a Draft or Published). Import Round 1 first, or both together.");
    expect(paths(sampleTrack("copywriting", [1, 3]))[0]).toMatch(/Round 3 can't be created before Round 2 exists/);
    expect(paths(sampleTrack("copywriting", [3]), ctx({}, { rounds: [1], meta: [storedMeta(1, [1, 1, 2, 2, 3])] }))[0]).toMatch(/Round 3 can't be created before Round 2/);
  });

  it("difficulty never goes down within a Round", () => {
    expect(paths(edit((d) => { d.rounds[0].sections[3].difficulty = 1; }))).toContain("rounds[0].sections[3].difficulty: difficulty can't go down (section 3 is 2, this is 1)");
  });

  it("section k of Round r is at least as hard as section k of Round r-1, and Round r is harder on average", () => {
    const easier = edit((d) => { d.rounds[0].sections[0].difficulty = 2; d.rounds[0].sections[1].difficulty = 2; d.rounds[1].sections[0].difficulty = 1; }, [1, 2]);
    expect(paths(easier)).toContain("rounds[1].sections[0].difficulty: section 1 of Round 2 can't be easier than section 1 of Round 1 (2)");
    const same = edit((d) => { d.rounds[1].sections.forEach((x, i) => { x.difficulty = d.rounds[0].sections[i].difficulty; }); }, [1, 2]);
    expect(paths(same)).toContain("rounds[1]: Round 2 must be harder on average than Round 1 (1.8); this one is 1.8");
    // Against the stored Round 1 too.
    const hard = { rounds: [1], meta: [storedMeta(1, [3, 3, 3, 3, 3])] };
    expect(paths(sampleTrack("copywriting", [2]), ctx({}, hard)).join(" ")).toMatch(/section 1 of Round 2 can't be easier than section 1 of Round 1 \(3\)/);
  });

  it("a section still needs 3 task types, the recipe caps and its labels; a hands-on task is build_it or mini_project", () => {
    expect(paths(edit((d) => { d.rounds[0].sections[0].items = d.rounds[0].sections[0].items.slice(0, 2); }))).toContain("rounds[0].sections[0].items: needs at least 3 different task types (has 2)");
    expect(paths(edit((d) => { d.rounds[0].sections[0].recipe.quizzes = 99; }))[0]).toMatch(/^rounds\[0\]\.sections\[0\]\.recipe: /);
    expect(paths(edit((d) => { (d.rounds[0].sections[0].items[0] as { notebookNote?: string }).notebookNote = undefined; }))).toContain("rounds[0].sections[0].items[0].notebookNote: a Very important item needs its Notebook note (20 to 800 characters)");
    expect(paths(edit((d) => { (d.rounds[0].sections[0].items[3] as { taskType: string }).taskType = "short_answer"; }))).toContain("rounds[0].sections[0].items[3].taskType: a hands-on task is one of: build_it, mini_project");
    expect(paths(edit((d) => { (d.rounds[0].sections[0].items[3] as { kind: string }).kind = "project"; }))[0]).toMatch(/^rounds\[0\]\.sections\[0\]\.items\[3\]\.kind: /);
  });

  it("v1/v2 mismatch: a v1 file for a skill, and a v2 file for a business or side hustle, are refused clearly", () => {
    expect(paths(sampleCourse("copywriting"))[0]).toMatch(/^formatVersion: "Copywriting" is a skill\. A skill is a track of 3 Rounds: use format version 2/);
    expect(paths(sampleTrack("graphic-design"), ctx({ slug: "graphic-design", name: "Freelance graphic design", kind: "business" }))).toContain("formatVersion: Format version 2 is for skills only; \"Freelance graphic design\" is a business. Businesses and side hustles use format version 1.");
    expect(paths(sampleTrack("pet-sitting"), ctx({ slug: "pet-sitting", name: "Pet sitting", kind: "side_hustle" }))[0]).toMatch(/is a side hustle\. Businesses and side hustles use format version 1/);
  });

  it("a published skill isn't refused: the import makes a new Draft version and never edits the published one", () => {
    const r = check(sampleTrack(), ctx({ published: true }, { rounds: [1], meta: [storedMeta(1, [1, 1, 2, 2, 3])] }));
    expect(r.ok).toBe(true);
    expect(r.summary.newDraftVersion).toBe(true);
  });

  it("income claims and attorney wording on every text field", () => {
    expect(paths(edit((d) => { d.rounds[0].goal = "Test: earn $5,000 a month writing copy."; })).join(" ")).toMatch(/^rounds\[0\]\.goal: reads as /);
    expect(paths(edit((d) => { d.track.glossary[0].meaning = "Test: guaranteed income from your first client."; })).join(" ")).toMatch(/track\.glossary\[0\]\.meaning: reads as /);
    expect(paths(edit((d) => { d.rounds[0].sections[2].lessons[0].summary = "Test: these steps are attorney-approved."; })).join(" ")).toMatch(/rounds\[0\]\.sections\[2\]\.lessons\[0\]\.summary: /);
  });

  it("HTML and scripts are stripped (and said so); links are https only; no script links in text", () => {
    const r = check(edit((d) => { d.rounds[0].label = "<b>Round 1</b><script>alert(1)</script> test"; }));
    expect(r.ok).toBe(true);
    expect((r.plan as TrackPlan).rounds[0].label).toBe("Round 1 test");
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/HTML or script was removed/);
    expect(paths(edit((d) => { d.sources[0].link = "http://example.org/x"; }))).toContain("sources[0].link: must be an https:// link");
    expect(paths(edit((d) => { d.resources[0].link = "javascript:alert(1)"; }))).toContain("resources[0].link: must be an https:// link");
    expect(paths(edit((d) => { d.rounds[0].goal = "Test: see javascript:alert(1) for more."; }))).toContain("rounds[0].goal: contains a script or data link; only https links are allowed");
  });

  it("unknown sources and skills", () => {
    expect(paths(edit((d) => { d.rounds[0].sections[1].sourceIds = ["nope"]; }))).toContain("rounds[0].sections[1].sourceIds[0]: unknown source \"nope\"");
    expect(paths(edit((d) => { d.track.skillsTaught = ["no-such-skill"]; }))).toContain("track.skillsTaught[0]: unknown skill \"no-such-skill\"");
  });
});
