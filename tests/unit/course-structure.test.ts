/**
 * C1: the module recipe (defaults, caps, 5 or 6 modules, at least 3 activity types), which existing activity types fill
 * which part, the income-claims check (what must and mustn't match), and the video checks by content and size.
 * Pure functions only; the database rules are in tests/db/course-structure.test.ts and the routes in
 * tests/integration/course-structure.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CORE_PARTS, DEFAULT_RECIPE, MODULE_COUNT, PART_TYPES, RECIPE_CAPS, VIDEO_MAX_BYTES, briefText, checkModuleCount, checkRecipe, clampRecipe, coverage,
  defaultPartOf, sniffVideo, tooLarge, typeFits,
} from "@/lib/courses/structure";
import { findIncomeClaims, scanTexts, textsOf } from "@/lib/courses/income";
import { ITEM_TYPES } from "@/lib/activities/types";

const BOOSTERS = ["real-world-teardown", "common-mistakes-hunt", "checklist-or-template", "tool-shortlist", "role-play-scenario", "teach-it-back", "weekly-reflection"];

describe("the module recipe", () => {
  it("has sensible defaults within the caps, with every core part at least once", () => {
    for (const p of CORE_PARTS) {
      expect(DEFAULT_RECIPE[p]).toBeGreaterThanOrEqual(RECIPE_CAPS[p].min);
      expect(DEFAULT_RECIPE[p]).toBeLessThanOrEqual(RECIPE_CAPS[p].max);
      expect(RECIPE_CAPS[p].min).toBe(1);
    }
    expect(RECIPE_CAPS).toMatchObject({ videos: { max: 4 }, quizzes: { max: 4 }, assignments: { max: 3 }, sandboxes: { max: 3 }, sequences: { max: 3 }, boosters: { min: 0, max: 5 } });
    expect(checkRecipe(DEFAULT_RECIPE, BOOSTERS)).toEqual({ recipe: DEFAULT_RECIPE });
  });

  it("refuses counts outside the caps, more than 5 boosters, and boosters not on the list", () => {
    expect(checkRecipe({ ...DEFAULT_RECIPE, videos: 0 }, BOOSTERS)).toEqual({ problem: "Explainer videos: choose 1 to 4." });
    expect(checkRecipe({ ...DEFAULT_RECIPE, quizzes: 5 }, BOOSTERS)).toEqual({ problem: "Quizzes: choose 1 to 4." });
    expect(checkRecipe({ ...DEFAULT_RECIPE, sandboxes: 1.5 }, BOOSTERS)).toEqual({ problem: "Sandboxes: choose 1 to 3." });
    expect(checkRecipe({ ...DEFAULT_RECIPE, boosters: BOOSTERS.slice(0, 6) }, BOOSTERS)).toEqual({ problem: "Learning boosters: choose up to 5." });
    expect(checkRecipe({ ...DEFAULT_RECIPE, boosters: ["made-up"] }, BOOSTERS)).toEqual({ problem: "\"made-up\" isn't on the list of learning boosters." });
    // Repeated boosters count once.
    expect(checkRecipe({ ...DEFAULT_RECIPE, boosters: ["teach-it-back", "teach-it-back"] }, BOOSTERS)).toEqual({ recipe: { ...DEFAULT_RECIPE, boosters: ["teach-it-back"] } });
  });

  it("brings a model's proposal within the caps instead of refusing it (a person reviews the Blueprint)", () => {
    expect(clampRecipe({ videos: 9, quizzes: 0, assignments: "x", sandboxes: 2, sequences: 3, boosters: ["teach-it-back", "made-up"] }, BOOSTERS))
      .toEqual({ videos: 4, quizzes: 1, assignments: DEFAULT_RECIPE.assignments, sandboxes: 2, sequences: 3, boosters: ["teach-it-back"] });
  });

  it("a course has 5 or 6 modules", () => {
    expect(MODULE_COUNT).toEqual({ min: 5, max: 6 });
    expect(checkModuleCount(4)).toBe("A course has 5 or 6 modules (this one has 4).");
    expect(checkModuleCount(5)).toBeNull();
    expect(checkModuleCount(6)).toBeNull();
    expect(checkModuleCount(7)).toMatch(/5 or 6/);
  });

  it("uses only existing activity types for every part, and maps each type to a part", () => {
    for (const types of Object.values(PART_TYPES)) for (const t of types) expect(ITEM_TYPES).toContain(t);
    for (const t of ITEM_TYPES) expect(typeFits(t, defaultPartOf(t)) || t === "teach_back").toBe(true);
    expect(typeFits("multiple_choice", "sandbox")).toBe(false);
    expect(typeFits("teach_back", "booster", ["teach_back"])).toBe(true);
  });

  it("measures a module against its recipe, and keeps the L6 rule of at least 3 activity types", () => {
    const items = [
      { item_type: "multiple_choice", recipe_part: "quiz", booster_key: null },
      { item_type: "true_false", recipe_part: null, booster_key: null },
      { item_type: "mini_project", recipe_part: "assignment", booster_key: null },
      { item_type: "teach_back", recipe_part: "booster", booster_key: "teach-it-back" },
    ];
    const c = coverage({ ...DEFAULT_RECIPE, quizzes: 3 }, 1, items);
    expect(c.counts).toEqual({ videos: 1, quizzes: 2, assignments: 1, sandboxes: 0, sequences: 0, boosters: 1 });
    expect(c.missing).toEqual(["sandboxes", "sequences"]);
    expect(c.short).toEqual([{ part: "quizzes", have: 2, want: 3 }]);
    expect(c.boostersMissing).toEqual(["common-mistakes-hunt"]);
    expect(c).toMatchObject({ types: 4, varietyOk: true });
    expect(coverage(DEFAULT_RECIPE, 0, items.slice(0, 2))).toMatchObject({ varietyOk: false, missing: expect.arrayContaining(["videos"]) });
  });
});

describe("the income-claims check", () => {
  const claims = (t: string) => findIncomeClaims(t).map((f) => f.claim);

  it.each([
    ["Students make $5,000 a month with this agency model.", "a promise to make or earn money"],
    ["You could earn up to $10k from your first clients.", "a promise to make or earn money"],
    ["Bring in $2,000/mo with cold outreach.", "a promise to make or earn money"],
    ["This store can generate $500 per week.", "a promise to make or earn money"],
    ["Most sellers see $3,000 per month in profit.", "a dollar amount presented as income"],
    ["Build $1k/mo passive income from templates.", "passive income"],
    ["After this module you will earn more from every client.", "an earnings promise"],
    ["Guaranteed results in 30 days.", "guaranteed results"],
    ["We guarantee clients for every graduate.", "guaranteed results"],
    ["The fastest way to get rich on Amazon.", "get rich"],
    ["Scale to a six-figure agency.", "six or seven figures"],
    ["Reach financial freedom with dropshipping.", "financial freedom"],
    ["Quit your day job in a year.", "quit your job"],
    ["Replace your salary with newsletter sponsorships.", "replace your income"],
    ["Make money fast with print on demand.", "make money fast"],
    ["10x your income with AI tools.", "a multiple of income"],
    ["The earning potential of UGC is huge.", "earning potential"],
  ])("blocks: %s", (text, claim) => {
    expect(claims(text)).toContain(claim);
  });

  it.each([
    "Charge $500 a month for the retainer, and put it in writing.",
    "A Shopify plan costs $39 per month.",
    "Track your costs: software at $20/month adds up.",
    "Set a price you can explain, and review it every quarter.",
    "Results vary. Nothing here promises income.",
    "Income from freelance work is taxable; keep records.",
    "Ask the client what result they need, and by when.",
    "Make a list of five businesses to contact.",
    "Earn their trust by answering questions honestly.",
  ])("lets through: %s", (text) => {
    expect(findIncomeClaims(text)).toEqual([]);
  });

  it("says exactly what matched and where, with a short excerpt", () => {
    const f = scanTexts([
      { where: "Module 2 › Lesson \"Pricing\" › section \"Offers\" › paragraph 3", text: "Some sellers claim you can make $3,000 a month quickly, which isn't typical." },
      { where: "Module 1 › title", text: "Getting started" },
    ]);
    expect(f).toEqual([{
      where: "Module 2 › Lesson \"Pricing\" › section \"Offers\" › paragraph 3", claim: "a promise to make or earn money", text: "make $3,000",
      excerpt: "Some sellers claim you can make $3,000 a month quickly, which isn't typical.",
    }, expect.objectContaining({ claim: "an earnings promise", text: "you can make" })]);
  });

  it("reads text out of lesson bodies, items and briefs, ignoring ids and links", () => {
    expect(textsOf({ sections: [{ heading: "H", paragraphs: [{ text: "P", refs: [1] }] }], sourceId: "abc", url: "https://x" })).toEqual(["H", "P"]);
  });
});

describe("video files", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(60).fill(0)]);
  it("knows an mp4 and a webm by their first bytes, never by the name", () => {
    expect(sniffVideo(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe("video/mp4");
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...Array.from("webm").map((c) => c.charCodeAt(0)), ...new Array(40).fill(0)]);
    expect(sniffVideo(webm)).toBe("video/webm");
    // A Matroska file that isn't WebM, a PNG, a PDF and an empty file are all refused.
    expect(sniffVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array.from("matroska").map((c) => c.charCodeAt(0)), ...new Array(40).fill(0)]))).toBeNull();
    expect(sniffVideo(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffVideo(new TextEncoder().encode("%PDF-1.7 renamed to video.mp4"))).toBeNull();
    expect(sniffVideo(new Uint8Array())).toBeNull();
  });
  it("has a 50 MB limit and says so plainly", () => {
    expect(VIDEO_MAX_BYTES).toBe(52_428_800);
    expect(tooLarge(80 * 1024 * 1024)).toBe("That file is 80.0 MB. The limit is 50 MB per video: export a shorter or smaller file (for example 1080p at a lower bitrate), or split it into two videos.");
  });
  it("turns a brief into text to paste into a video tool, flagging any point without a source", () => {
    const t = briefText("Test video", { purpose: "Test purpose", points: [{ text: "Point A", sources: [{ title: "Test study" }] }, { text: "Point B" }], targetMinutes: 6, tone: "Plain", avoid: ["Hype"] });
    expect(t).toContain("1. Point A (source: Test study)");
    expect(t).toContain("2. Point B (no source: check it before saying it)");
    expect(t).toContain("Never promise income, earnings or results.");
  });
});
