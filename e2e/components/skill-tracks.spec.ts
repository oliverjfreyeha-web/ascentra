/**
 * S1: the skill track screens as real React components in a real browser with the app's real stylesheets (no server:
 * the API is answered here with the real routes' shapes, from tests/integration/skill-tracks.test.ts).
 *   Track view: a Round selector (tabs: arrow keys, Home, End), then sections; each step shows the short lesson, then its
 *   tasks; a locked Round says which plan includes it; Round progress; "Round complete", never "Course complete".
 *   Library view: unlocked lessons by Round and section, searchable, read-only; locked Rounds named with their reason.
 *   My progress shows a track's Rounds; the topics admin shows "Track (3 Rounds)" for a skill instead of the size picker.
 * Then axe at desktop and phone width.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css", "app/learn/c2.css",
  "app/admin/topics/topics.css"].map((f) => readFileSync(f, "utf8")).join("\n");
const AXE = readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8");
let bundle = "";
test.beforeAll(async () => {
  const stubs = resolve("e2e/components/fixtures/c2-stubs.tsx");
  const out = await build({
    entryPoints: ["e2e/components/fixtures/s1-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty" },
    alias: { "@clerk/nextjs": stubs, "next/link": stubs, "next/navigation": stubs },
  });
  bundle = out.outputFiles[0].text;
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Whole points per Round (lib/progress/tracks.ts trackPoints): Should know 1/2/2, Important 2/3/4, Very important 3/5/6.
const PTS: Record<string, number[]> = { "Should know": [1, 2, 2], Important: [2, 3, 4], "Very important": [3, 5, 6] };
const item = (n: number, part: string, label: string, points: number, done: boolean, open: boolean) =>
  ({ kind: "activity", id: ID(n), title: `Test task ${n}: rewrite a made-up product note.`, part, importanceLabel: label, points, done, open });
const section = (round: number, k: number, state: string, reason: string | null, done = 0) => ({
  id: ID(round * 100 + k), number: k, title: `Test section ${k}: plain words`, state, reason, doneCount: done, itemCount: 4, done: done === 4,
  steps: [{
    lessonId: ID(round * 1000 + k), title: `Test lesson ${round}.${k}`, summary: state === "locked" ? null : `Test summary ${round}.${k}: one idea per sentence.`,
    items: [item(round * 10000 + k * 10 + 1, "quiz", "Very important", PTS["Very important"][round - 1], done > 0, state !== "locked"), item(round * 10000 + k * 10 + 2, "sandbox", "Important", PTS.Important[round - 1], done > 1, state !== "locked"),
      item(round * 10000 + k * 10 + 3, "sequence", "Should know", PTS["Should know"][round - 1], done > 2, state === "open"), item(round * 10000 + k * 10 + 4, "assignment", "Important", PTS.Important[round - 1], done > 3, state === "open")],
  }],
});
const TRACK = {
  slug: "copywriting", name: "Copywriting", plan: "basic", version: 3, rank: { name: "Operator", points: 52 },
  note: "Each Round goes deeper into the same 5 sections. Finish every item of a Round to open the next.",
  rounds: [
    { round: 1, label: "Round 1: test practice", goal: "Test goal 1: write clearer sentences.", state: "open", reason: null, complete: true, doneCount: 20, itemCount: 20,
      sections: [1, 2, 3, 4, 5].map((k) => section(1, k, "open", null, 4)) },
    { round: 2, label: "Round 2: test practice", goal: "Test goal 2: write clearer sentences than in Round 1.", state: "open", reason: null, complete: false, doneCount: 6, itemCount: 20,
      sections: [section(2, 1, "open", null, 4), section(2, 2, "half", "The rest opens when you finish section 1.", 2), section(2, 3, "locked", "Opens when you finish half of section 2."), section(2, 4, "locked", "Opens when you finish half of section 3."), section(2, 5, "locked", "Opens when you finish half of section 4.")] },
    { round: 3, label: "Round 3: test practice", goal: "Test goal 3.", state: "locked", reason: "Round 3 is part of Pro.", complete: false, doneCount: 0, itemCount: 20,
      sections: [1, 2, 3, 4, 5].map((k) => section(3, k, "locked", "Round 3 is part of Pro.")) },
  ],
};
const LIBRARY = {
  slug: "copywriting", name: "Copywriting", note: "Read-only. Lessons in sections you haven't opened yet aren't listed.",
  entries: [
    { round: 1, section: 1, sectionTitle: "Test section 1: plain words", lessonId: ID(1001), title: "Test lesson 1.1", paragraphs: ["Test summary 1.1: one idea per sentence.", "Test paragraph: a short sentence says one thing."] },
    { round: 1, section: 2, sectionTitle: "Test section 2: cutting words", lessonId: ID(1002), title: "Test lesson 1.2", paragraphs: ["Test summary 1.2: cut what the reader doesn't need."] },
    { round: 2, section: 1, sectionTitle: "Test section 1: plain words", lessonId: ID(2001), title: "Test lesson 2.1", paragraphs: ["Test summary 2.1: read it aloud."] },
  ],
  lockedRounds: [{ round: 3, reason: "Round 3 is part of Pro." }],
};
const PROGRESS = {
  rank: { index: 4, name: "Operator", points: 52, next: { name: "Strategist", needs: 18 } }, streak: { current: 2, longest: 4 }, plan: "basic",
  courses: [{
    courseId: ID(60), slug: "copywriting", name: "Copywriting", kind: "skill", pickStatus: "active", tier: null, plan: "basic", percent: 43, done: 26, items: 60,
    complete: false, bonus: false, capstone: null, points: 52, skillRank: { index: 4, name: "Operator" },
    modules: Array.from({ length: 15 }, (_, i) => ({ position: i + 1, title: `Test section ${(i % 5) + 1}`, state: i < 7 ? "open" : "locked", reason: null, gated: false, done: i < 6, doneCount: i < 6 ? 4 : 0, itemCount: 4, round: Math.floor(i / 5) + 1 })),
    track: { rounds: [
      { round: 1, state: "open", reason: null, complete: true, doneCount: 20, itemCount: 20 },
      { round: 2, state: "open", reason: null, complete: false, doneCount: 6, itemCount: 20 },
      { round: 3, state: "locked", reason: "Round 3 is part of Pro.", complete: false, doneCount: 0, itemCount: 20 },
    ] },
  }],
  pastCourses: [], skills: [{ slug: "copywriting", name: "Copywriting", percent: 43, rank: { index: 4, name: "Operator" } }],
  scores: [], pointsByDay: [], timeZone: "America/New_York", note: "Ranks and streaks come from items you finish. Results vary. Nothing here promises income.",
  pointsFor: { shouldKnow: 1, important: 2, veryImportant: 3 },
};
const topic = (n: number, kind: string, name: string) => ({
  id: ID(90 + n), kind, slug: name.toLowerCase().replace(/ /g, "-"), name, blurb: `Test blurb for ${name}.`, published: true, teenHidden: false, hasCourse: false, sortOrder: n * 10,
  catalogSlug: null, course: { status: "none", label: "None", firstLessonId: null }, demand30: 1, demandAll: 2, activePicks: 1,
  ...(kind === "skill" ? {} : { facts: { costLow: null, costHigh: null, costItems: [], costSources: [], costCheckedOn: null, outlookLabel: null, outlookSources: [], outlookCheckedOn: null, difficulty: null, riskNotes: null, teachesSkills: [] },
    card: { cost: null, outlook: null, difficulty: null, riskNotes: null, empty: "Estimate coming", note: "Estimate, not a promise." } }),
});
const TOPICS = { topics: [topic(1, "business", "Freelance graphic design"), topic(3, "skill", "Copywriting")], note: "Demand counts are anonymous." };

async function mount(page: Page, view: string, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, b: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (path === "/api/v1/me") return json(200, { account: { id: ID(9), roleKey: "owner", role: "owner", displayName: "Test person", email: "test@example.com", assignedCourses: [] } });
    if (path === "/api/v1/learn/tracks/copywriting") return json(200, TRACK);
    if (path === "/api/v1/learn/tracks/copywriting/library") return json(200, LIBRARY);
    if (path === "/api/v1/learn/progress") return json(200, PROGRESS);
    if (path === "/api/v1/topics") return json(200, TOPICS);
    return json(200, { ok: true });
  });
  await page.route("https://ascentra.test/", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en" data-glass="liquid" data-motion="off"><head><title>Test</title><style>${CSS}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("https://ascentra.test/");
  await page.evaluate((v) => { (window as unknown as { __view: string }).__view = v; }, view);
  await page.addScriptTag({ content: bundle });
}
async function axe(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (n: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown }[] }[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes[0]?.target)}`);
  });
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("Track view", () => {
  test("a Round selector, then sections; each step shows the short lesson, then its tasks; Round progress", async ({ page }) => {
    await mount(page, "track");
    const tabs = page.getByRole("tablist", { name: "Rounds" });
    await expect(tabs.getByRole("tab")).toHaveText(["Round 1 (complete)", "Round 2", "Round 3 (locked)"]);
    const r1 = page.getByRole("tabpanel");
    await expect(r1.getByRole("heading", { name: "Round 1: test practice" })).toBeVisible();
    await expect(r1.getByText("Round complete", { exact: true })).toBeVisible();
    await expect(page.getByText("Course complete")).toHaveCount(0);
    const sections = r1.getByRole("list", { name: "Sections of Round 1" }).locator(":scope > li");
    await expect(sections).toHaveCount(5);
    const first = sections.first();
    await expect(first.getByRole("heading", { level: 4, name: "Step 1: Test lesson 1.1" })).toBeVisible();
    await expect(first.getByText("Test summary 1.1: one idea per sentence.")).toBeVisible();
    await expect(first.getByRole("list", { name: "Tasks for Test lesson 1.1" }).getByText("Practice (simulated)")).toBeVisible();
  });

  test("keyboard: arrow keys, Home and End move between Rounds; a locked Round says which plan includes it, with no lesson text", async ({ page }) => {
    await mount(page, "track");
    await page.getByRole("tab", { name: "Round 1 (complete)" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Round 2" })).toBeFocused();
    await expect(page.getByRole("tabpanel").getByRole("heading", { name: "Round 2: test practice" })).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText("6 of 20 items done").first()).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText("The rest opens when you finish section 1.")).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Round 3 (locked)" })).toBeFocused();
    const r3 = page.getByRole("tabpanel");
    await expect(r3.getByRole("note")).toHaveText("Round 3 is part of Pro.");
    await expect(r3.getByText(/Test summary 3\./)).toHaveCount(0);
    await expect(r3.getByRole("heading", { level: 4 })).toHaveCount(0);
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Round 1 (complete)" })).toBeFocused();
  });

  for (const width of [1280, 390]) {
    test(`axe at ${width}px, every Round`, async ({ page }) => {
      await mount(page, "track", width);
      await expect(page.getByRole("tablist", { name: "Rounds" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.getByRole("tab", { name: "Round 3 (locked)" }).click();
      expect(await axe(page)).toEqual([]);
      expect(await fits(page)).toBe(true);
    });
  }
});

test.describe("Library view", () => {
  test("unlocked lessons by Round and section; search narrows them; locked Rounds named with their reason", async ({ page }) => {
    await mount(page, "library");
    await expect(page.getByRole("heading", { level: 2, name: "Round 1" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Section 1: Test section 1: plain words · Test lesson 1.1", "Section 2: Test section 2: cutting words · Test lesson 1.2", "Section 1: Test section 1: plain words · Test lesson 2.1"]);
    await expect(page.getByText("Round 3 is part of Pro.")).toBeVisible();
    // Keyboard: Tab reaches the search box; typing filters as you go.
    await page.getByRole("link", { name: /Back to the track/ }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("searchbox", { name: "Search the lessons" })).toBeFocused();
    await page.keyboard.type("aloud");
    await expect(page.getByRole("status")).toHaveText("1 of 3 lessons match.");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Section 1: Test section 1: plain words · Test lesson 2.1"]);
    // Read-only: nothing to edit or submit.
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  for (const width of [1280, 390]) {
    test(`axe at ${width}px`, async ({ page }) => {
      await mount(page, "library", width);
      await expect(page.getByRole("heading", { level: 2, name: "Round 1" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await fits(page)).toBe(true);
    });
  }
});

test.describe("Track in My progress and the topics admin", () => {
  test("My progress shows a track's Rounds, 'Round complete', and links to the track and its library", async ({ page }) => {
    await mount(page, "progress");
    const rounds = page.getByRole("list", { name: "Rounds of Copywriting" });
    await expect(rounds.getByRole("listitem")).toHaveCount(3);
    await expect(rounds.getByRole("listitem").first()).toContainText("Round complete");
    await expect(rounds.getByRole("listitem").nth(2)).toContainText("Round 3 is part of Pro.");
    await expect(page.getByText("Course complete")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Open the track\s*: Copywriting$/ })).toHaveAttribute("href", "/learn/track/copywriting");
    await expect(page.getByRole("link", { name: /^Library\s*: Copywriting$/ })).toHaveAttribute("href", "/learn/track/copywriting/library");
    expect(await axe(page)).toEqual([]);
  });

  test("topics admin: a skill row says Track (3 Rounds) instead of the size picker; a business keeps Start course", async ({ page }) => {
    await mount(page, "topics");
    await page.getByRole("button", { name: "Skills" }).click();
    await expect(page.getByText("Track (3 Rounds)")).toBeVisible();
    await expect(page.getByLabel(/Size/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Import it\s*: track for Copywriting$/ })).toHaveAttribute("href", "/admin/import");
    await page.getByRole("button", { name: "Businesses" }).click();
    await expect(page.getByRole("button", { name: /^Start course\s*: Freelance graphic design$/ })).toBeVisible();
  });
});
