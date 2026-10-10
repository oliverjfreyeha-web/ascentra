/**
 * C2: the new and changed screens as real React components in a real browser with the app's real stylesheets (no
 * server: the API is answered here with the shapes the real routes return, taken from
 * tests/integration/progress-paths.test.ts). What a person does on each, with the keyboard where it matters, then axe
 * at desktop and phone width with nothing wider than the screen.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css", "app/ui/neo.css",
  "app/learn/c2.css", "app/learn/choose/choose.css"].map((f) => readFileSync(f, "utf8")).join("\n");
const AXE = readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8");
let bundle = "";

test.beforeAll(async () => {
  const stubs = resolve("e2e/components/fixtures/c2-stubs.tsx");
  const out = await build({
    entryPoints: ["e2e/components/fixtures/c2-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty" },
    alias: { "@clerk/nextjs": stubs, "next/link": stubs, "next/navigation": stubs },
  });
  bundle = out.outputFiles[0].text;
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SRC = [{ title: "Test pricing page", url: "https://example.org/pricing" }];
const FACTS = { cost: { range: "$50 to $400", items: ["Domain", "Website builder"], checkedOn: "2026-10-01", sources: SRC }, outlook: { label: "Steady", checkedOn: "2026-09-30", sources: [{ title: "Test survey", url: "https://example.org/survey" }] }, difficulty: 3, riskNotes: "Some months bring few orders.", empty: "Estimate coming", note: "Estimate, not a promise." };
const EMPTY = { cost: null, outlook: null, difficulty: null, riskNotes: null, empty: "Estimate coming", note: "Estimate, not a promise." };
const topic = (slug: string, name: string, extra: Record<string, unknown> = {}) => ({ slug, name, blurb: `Test blurb for ${name}.`, hasCourse: false, courseHref: null, sortOrder: 10, picked: false, paused: false, locked: false, ...extra });
const Q = (label: string, options: Record<string, string>) => ({ label, options });
const CHOOSER = {
  plan: "basic",
  questions: {
    goal: Q("What do you want from this?", { start: "Start a business of my own", skills: "Build skills" }), hours: Q("How much time?", { 2: "About 2 hours", 5: "About 5 hours" }),
    experience: Q("Experience?", { none: "None yet", some: "A little" }), style: Q("Which sounds most like you?", { build: "Building", sell: "Selling" }), camera: Q("On camera?", { yes: "Yes", no: "No" }),
  },
  answers: { goal: "start", hours: 5, experience: "none", style: "build", camera: "no" },
  businesses: [topic("seo-services", "SEO services", { best: true, why: ["Mostly building."], facts: FACTS, picked: true, locked: true }), topic("graphic-design", "Freelance graphic design", { best: true, why: [], facts: EMPTY })],
  sideHustles: [topic("newsletter", "Newsletter business", { best: true, why: [], facts: FACTS }), topic("faceless-content", "Faceless content", { best: true, why: [], facts: EMPTY })],
  skills: [topic("copywriting", "Copywriting", { overlapNote: "Your business course already teaches this. Picking it adds extra practice in other settings." }), topic("negotiation", "Negotiation", { overlapNote: null })],
  business: { slug: "seo-services", name: "SEO services", locked: true, lockNote: "Locked on your plan. Only the Owner can change it." },
  sideHustle: null, skillsUsed: 0, skillLimit: 3, skillCounter: "0 of 3 skills used", note: "Everything here is online and remote.", planNote: "Basic: 3 skills, 1 business and, if you like, 1 side hustle.",
};
const PROGRESS = {
  rank: { index: 2, name: "Explorer", points: 16, next: { name: "Builder", needs: 9 } }, streak: { current: 3, longest: 5 }, plan: "basic",
  courses: [{
    courseId: ID(50), slug: "seo-services", name: "Search services (test)", kind: "business", pickStatus: "active", tier: "Standard", plan: "basic", percent: 40, done: 8, items: 20,
    complete: false, bonus: true, capstone: { id: ID(51), title: "Test capstone", done: false }, points: 16, skillRank: null,
    modules: [
      { position: 1, title: "Test module 1", state: "open", reason: null, gated: false, done: true, doneCount: 4, itemCount: 4 },
      { position: 2, title: "Test module 2", state: "open", reason: null, gated: false, done: true, doneCount: 4, itemCount: 4 },
      { position: 3, title: "Test module 3", state: "half", reason: "Trial bonus: the first half of this module is open.", gated: true, done: false, doneCount: 0, itemCount: 4 },
      { position: 4, title: "Test module 4", state: "locked", reason: "Opens when module 3 is done and you reach the rank Builder.", gated: true, done: false, doneCount: 0, itemCount: 4 },
    ],
  }],
  pastCourses: [], skills: [{ slug: "copywriting", name: "Copywriting", percent: 20, rank: { index: 1, name: "Initiate" } }],
  scores: [{ day: "2026-10-09", average: 90, attempts: 2 }], pointsByDay: [{ day: "2026-10-08", points: 5 }, { day: "2026-10-09", points: 11 }],
  timeZone: "America/New_York", note: "Ranks and streaks come from items you finish. Results vary. Nothing here promises income.",
  weights: { should_know: 1, important: 2, very_important: 3 }, pointsFor: { shouldKnow: 1, important: 2, veryImportant: 3 },
};
const NOTEBOOK = (ideas: { id: string; body: string }[] = [], on = false) => ({
  categories: [
    { key: "videos", label: "Videos", entries: [] },
    { key: "quizzes", label: "Quizzes", entries: [{ id: ID(70), title: "Test quiz 1?", note: "Test note: the title tag is the first thing a search result shows.", importance: "very_important", importanceLabel: "Very important", course: "Search services (test)", at: "2026-10-09T10:00:00.000Z" }] },
    { key: "assignments", label: "Assignments", entries: [] }, { key: "tasks", label: "Tasks", entries: [] }, { key: "key_terms", label: "Key terms", entries: [] },
  ],
  ideas: ideas.map((i) => ({ ...i, at: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z" })),
  ai: { on, available: false, dailyLimit: 3 }, note: "Your Notebook is private. Auto-notes come from \"Very important\" items you finish. \"My ideas\" is yours alone.",
});
const BOARD = {
  kind: "public", note: "Shows nicknames, ranks and streaks only. Never a real name.",
  rows: [{ nickname: "Comet_Rider", rank: "Builder", rankIndex: 3, points: 40, streak: 4, you: false }, { nickname: "Swift_Otter", rank: "Explorer", rankIndex: 2, points: 16, streak: 3, you: true }],
  you: { nickname: "Swift_Otter", rank: "Explorer", rankIndex: 2, points: 16, streak: 3, you: true }, settings: { nickname: "Swift_Otter", removed: false, optOut: false, shown: true },
};
const TEEN_BOARD = {
  kind: "practice", settings: null, note: "Your board shows practice rivals. They're simulated, not real people, so you can compare your progress safely.",
  rows: [
    { nickname: "BrightFalcon42", rank: "Builder", rankIndex: 3, points: 30, streak: 6, simulated: true, label: "Practice rival (simulated)" },
    { nickname: "You", rank: "Explorer", rankIndex: 2, points: 16, streak: 3, you: true, simulated: false },
    { nickname: "CalmMaple17", rank: "Initiate", rankIndex: 1, points: 4, streak: 1, simulated: true, label: "Practice rival (simulated)" },
  ],
};
const COMMUNITY = { links: [{ label: "Discord", url: "https://example.org/discord" }], hidden: false, note: "These are outside links: they open other websites in a new tab. ASCENTRA doesn't run them.",
  settings: { discordUrl: "https://example.org/discord", socialLinks: [], hideFromTeens: false } };
const CAPSTONE = {
  id: ID(52), title: "Test capstone", brief: "Put the course together in one plan.", deliverables: [{ key: "d0", text: "A one-page test plan", checked: false }], checklist: [{ key: "c0", text: "I checked my plan", checked: false }],
  automation: { what: "Drafting test replies", prompts: ["Test prompt: draft a reply to this customer email."], plans: [], paidPlanNote: "A paid plan may be needed for some of these tools. ASCENTRA doesn't recommend a specific plan here." },
  completedAt: null, courseComplete: false, modulesDone: false,
};
const LIMITS = ["No messaging private individuals.", "No meeting anyone in person.", "No sharing personal details (yours or anyone else's).", "No handling real client money or accounts."];
const GUARDIAN = { requests: [{ id: ID(80), teen: "Test", course: "Search services (test)", scope: "course", requestedAt: "2026-10-09T10:00:00.000Z", mission: null }], limits: LIMITS };
const ALLOW = {
  types: [{ key: "public_post", label: "Post something publicly", contacts: false, allowedStates: [] }, { key: "contact_business", label: "Contact a business (email or form)", contacts: true, allowedStates: ["OR"] }],
  states: [{ code: "OR", name: "Oregon" }, { code: "TX", name: "Texas" }], limits: LIMITS, note: "Off for teens in every state until you turn a mission type on for a state. Decide with your lawyer. Adults don't need this.",
};
const adminTopic = (n: number, kind: string, name: string) => ({
  id: ID(90 + n), kind, slug: name.toLowerCase().replace(/ /g, "-"), name, blurb: `Test blurb for ${name}.`, published: true, teenHidden: false, hasCourse: false, sortOrder: n * 10,
  catalogSlug: null, course: { status: "none", label: "None", firstLessonId: null }, demand30: 1, demandAll: 2, activePicks: 1,
  ...(kind === "skill" ? {} : {
    facts: { costLow: null, costHigh: null, costItems: [], costSources: [], costCheckedOn: null, outlookLabel: null, outlookSources: [], outlookCheckedOn: null, difficulty: null, riskNotes: null, teachesSkills: [] },
    card: EMPTY,
  }),
});
const TOPICS = { topics: [adminTopic(1, "business", "SEO services"), adminTopic(2, "side_hustle", "Newsletter business"), adminTopic(3, "skill", "Copywriting")], note: "Demand counts are anonymous." };

const brief = { purpose: "Test purpose", points: [{ text: "Test point" }], targetMinutes: 5, tone: "Plain", onScreen: [], avoid: [] };
const STUDIO = {
  course: { id: ID(1), slug: "seo-services", name: "Search services (test)" },
  version: { id: ID(2), version: 1, status: "draft", ownerReviewRequired: true, isDraft: true, publishedAt: null, unpublishedAt: null, sizeTier: "compact" },
  live: null, capstone: null, business: true, notices: { license: null, software: null },
  modules: [1, 2, 3].map((n) => ({
    id: ID(100 + n), position: n, title: `Test module ${n}`, stage: "Foundations", recipe: { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 0, boosters: [] }, recommendedPace: "About 1 week",
    state: { coverage: { counts: { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 0, boosters: 0 }, missing: [], short: [], boostersMissing: [], types: 3, varietyOk: true }, findings: [],
      blockers: ["1 video(s) or practice item(s) need an importance label (and \"Very important\" ones a Notebook note)."], ready: false, candidates: [], itemIds: [], review: null },
    lessons: [{ id: ID(200 + n), position: 1, title: `Test lesson ${n}`, minutes: 10, open: { id: ID(500 + n), version: 1, status: "draft", verified: false, returnedNote: null }, published: null,
      text: { versionId: ID(500 + n), version: 1, status: "draft", body: { summary: "Test summary.", sections: [{ heading: "Test", paragraphs: [{ text: "Test paragraph.", refs: [1] }] }], takeaways: [] } } }],
    items: [{ id: ID(600 + n), lessonId: ID(200 + n), type: "multiple_choice", part: "quiz", partSet: true, booster: null, status: "draft", prompt: `Test quiz ${n}?`, importance: null, notebookNote: null, missionType: null }],
    slots: [{ id: ID(300 + n), position: 1, title: `Test video ${n}`, lessonId: null, status: "waiting", brief, briefText: "Video: test", briefBy: "ai", briefEditedAt: null, transcript: "", approvedAt: null, file: null, history: [], importance: "important", notebookNote: null }],
  })),
  findings: [], emptySlots: 3, boosters: [], canPublish: false, publishBlockers: ["Add the course's capstone (every course has one)."],
};
const LESSON = {
  lesson: { id: ID(60), title: "Test lesson 1", course: { slug: "seo-services", name: "Search services (test)" }, review: null,
    version: { id: ID(61), number: 1, publishedAt: "2026-10-01T10:00:00.000Z", lastVerifiedOn: "2026-10-01", body: { summary: "Test summary.", sections: [{ heading: "Test", paragraphs: [{ text: "Test paragraph.", refs: [] }] }], takeaways: [] }, citations: [], uncited: 0 } },
  progress: null, update: null,
  activities: [
    { id: ID(62), type: "multiple_choice", typeLabel: "Multiple choice", graded: true, label: "Graded", level: "beginner", goal: "Test goal", prompt: "Test quiz 1?", content: { options: ["A", "B"] }, result: null, why: null },
    { id: ID(63), type: "short_answer", typeLabel: "Short answer", graded: false, label: "Practice, not graded", level: "beginner", goal: "Test goal", prompt: "Test assignment 1?", content: {}, result: { attempts: 1 }, why: null },
  ],
  selection: { mode: "default", personalized: false, canPersonalize: false, note: null }, score: { graded: 0, correct: 0 },
  videos: [{ id: ID(64), title: "Test video 1", state: "ready", transcript: "Test transcript." }],
  progress2: {
    module: { position: 1, title: "Test module 1", state: "open", reason: null, doneCount: 1, itemCount: 4 },
    items: [
      { kind: "video", id: ID(64), importance: "important", importanceLabel: "Important", done: false, open: true, missionType: null, mission: null },
      { kind: "activity", id: ID(62), importance: "very_important", importanceLabel: "Very important", done: true, open: true, missionType: null, mission: null },
      { kind: "activity", id: ID(63), importance: "should_know", importanceLabel: "Should know", done: false, open: true, missionType: "contact_business", mission: { label: "Contact a business (email or form)", contacts: true } },
    ],
    notices: [{ kind: "license", text: "Test: some places need a business license. General information only." }], rank: { name: "Explorer", index: 2 }, teen: true, missionLimits: LIMITS,
  },
};

type Sent = { method: string; path: string; body: unknown };
async function mount(page: Page, view: string, width = 1280, variant = "") {
  const sent: Sent[] = [];
  let lessonLoads = 0;
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
    sent.push({ method: req.method(), path, body });
    const json = (status: number, b: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    const m = req.method();
    if (path === "/api/v1/me") return json(200, { account: { id: ID(9), roleKey: "owner", role: "owner", displayName: "Test owner", email: "owner@example.com" }, roleKey: "owner" });
    if (path === "/api/v1/learn/picks") return json(m === "POST" ? 201 : 200, CHOOSER);
    if (path === "/api/v1/learn/progress") return json(200, PROGRESS);
    if (path === "/api/v1/learn/notebook") return json(200, NOTEBOOK());
    if (path === "/api/v1/learn/notebook/ideas") return json(201, NOTEBOOK([{ id: ID(71), body: body.body }]));
    if (path === "/api/v1/learn/notebook/ai") return json(200, NOTEBOOK([], body.on));
    if (path === "/api/v1/leaderboard") return json(200, variant === "teen" ? TEEN_BOARD : BOARD);
    if (path.startsWith("/api/v1/leaderboard/")) return json(200, BOARD);
    if (path === "/api/v1/community") return json(200, COMMUNITY);
    if (path.startsWith("/api/v1/learn/capstones/")) return json(200, m === "PUT" ? { ...CAPSTONE, deliverables: [{ ...CAPSTONE.deliverables[0], checked: true }], checklist: [{ ...CAPSTONE.checklist[0], checked: true }], completedAt: "2026-10-10T10:00:00.000Z" } : CAPSTONE);
    if (path === "/api/v1/account/state") return json(200, { state: m === "PUT" ? body.state : null });
    if (path === "/api/v1/learn/time-zone") return json(200, { timeZone: body.timeZone });
    if (path === "/api/v1/guardian/missions") return json(200, GUARDIAN);
    if (path.startsWith("/api/v1/guardian/missions/")) return json(200, { ...GUARDIAN, requests: [] });
    if (path === "/api/v1/missions/allowlist") return json(200, ALLOW);
    if (path === "/api/v1/topics") return json(200, TOPICS);
    if (path.startsWith("/api/v1/topics/")) return json(200, TOPICS);
    if (path.endsWith("/studio")) return json(200, STUDIO);
    if (path === `/api/v1/learn/lessons/${ID(60)}`) { lessonLoads++; return json(200, lessonLoads > 1 ? { ...LESSON, progress2: { ...LESSON.progress2, notices: [] } } : LESSON); }
    if (path.endsWith("/complete")) return json(200, { done: true, new: true, points: 1 });
    if (path === "/api/v1/learn/missions/request") return json(201, { requested: true });
    if (path.startsWith("/api/v1/learn/videos/") && path.endsWith("/watched")) return json(200, { done: true, new: true, points: 2 });
    if (path.startsWith("/api/v1/learn/videos/")) return json(200, { id: ID(64), title: "Test video 1", url: "data:video/mp4;base64,", mime: "video/mp4", expiresIn: 600, transcript: "Test transcript." });
    if (path === "/api/registration") return json(200, { state: "dob" });
    if (path.startsWith("/api/v1/learn/mentor")) return json(200, { allowance: null, messages: [] });
    return json(200, { ok: true });
  });
  await page.route("https://ascentra.test/", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en" data-glass="liquid" data-motion="off"><head><title>Test</title><style>${CSS}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("https://ascentra.test/");
  await page.evaluate((v) => { (window as unknown as { __view: string }).__view = v; }, view);
  await page.addScriptTag({ content: bundle });
  return sent;
}
async function axe(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (n: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown }[] }[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes[0]?.target)}`);
  });
}
const fits = async (page: Page) => {
  const r = await page.evaluate(() => {
    const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}.${e.className}`);
    return { ok: document.documentElement.scrollWidth <= window.innerWidth + 1, wide };
  });
  if (!r.ok) console.log("too wide:", r.wide.join(" | "));
  return r.ok;
};

test.describe("Choose your path: side hustles, estimates and the overlap note", () => {
  test("the side hustle step is optional; cards show sourced estimates or Estimate coming; no promise of income", async ({ page }) => {
    const sent = await mount(page, "choose");
    await page.getByRole("button", { name: /Your side hustle/ }).click();
    await expect(page.getByRole("heading", { name: "3. Your side hustle" })).toBeFocused();
    await expect(page.getByText("0 of 1 side hustle picked")).toBeVisible();
    await expect(page.getByText("Results vary. Nothing here promises income.", { exact: false })).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: "Newsletter business" });
    await expect(card.getByText("$50 to $400")).toBeVisible();
    await expect(card.getByText(/Estimate, not a promise\. Checked 2026-09-30\./)).toBeVisible();
    await expect(card.getByRole("link", { name: /Test pricing page/ })).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("listitem").filter({ hasText: "Faceless content" }).getByText("Estimate coming").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
    // Keyboard: pick it.
    await page.getByRole("button", { name: "Pick Newsletter business" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent.find((s) => s.method === "POST" && s.path === "/api/v1/learn/picks")?.body).toEqual({ slug: "newsletter" });
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { name: "4. Your skills" })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "Your business course already teaches this." })).toBeVisible();
  });
  for (const width of [1280, 390]) {
    test(`axe at ${width}px (side hustle step)`, async ({ page }) => {
      await mount(page, "choose", width);
      await page.getByRole("button", { name: /Your side hustle/ }).click();
      await expect(page.getByText("$50 to $400")).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await fits(page)).toBe(true);
    });
  }
});

const SCREENS: { view: string; ready: string | RegExp; variant?: string }[] = [
  { view: "progress", ready: "Rank and streak" }, { view: "notebook", ready: "Auto-notes" }, { view: "leaderboard", ready: "Swift_Otter" },
  { view: "leaderboard", ready: "BrightFalcon42", variant: "teen" }, { view: "community", ready: "Outside links" }, { view: "capstone", ready: "Test capstone" },
  { view: "account", ready: "Progress and leaderboard" }, { view: "guardian", ready: "Real-world mission requests" }, { view: "missions", ready: "Teen missions by state" },
  { view: "topics", ready: "SEO services" }, { view: "studio", ready: "Course studio" }, { view: "lesson", ready: "Test lesson 1" }, { view: "dob", ready: "What's your date of birth?" },
];
for (const s of SCREENS) {
  for (const width of [1280, 390]) {
    test(`axe: ${s.view}${s.variant ? ` (${s.variant})` : ""} at ${width}px`, async ({ page }) => {
      await mount(page, s.view, width, s.variant);
      await expect(page.getByText(s.ready).first()).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await fits(page)).toBe(true);
    });
  }
}

test("My progress: rank, streak, locked and gated modules with reasons, the trial bonus, the capstone link", async ({ page }) => {
  await mount(page, "progress");
  await expect(page.getByText("Explorer").first()).toBeVisible();
  await expect(page.getByText("3 days")).toBeVisible();
  await expect(page.getByText("Next rank: Builder, 9 more points.")).toBeVisible();
  await expect(page.getByText("Opens when module 3 is done and you reach the rank Builder.")).toBeVisible();
  await expect(page.getByText("Trial bonus: half of module 3", { exact: false })).toBeVisible();
  await expect(page.getByText("Rank gate").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Open the capstone/ })).toHaveAttribute("href", `/learn/capstone/${ID(50)}`);
});

test("Notebook: auto-notes by category; a new idea from the keyboard; AI summaries off until turned on; copy as text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const sent = await mount(page, "notebook");
  await expect(page.getByRole("heading", { name: "Quizzes" })).toBeVisible();
  await expect(page.getByText("Test note: the title tag", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "New idea" }).fill("Test idea: a checklist for local shops.");
  await page.getByRole("button", { name: "Save idea" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.find((s) => s.path === "/api/v1/learn/notebook/ideas")?.body).toEqual({ body: "Test idea: a checklist for local shops." });
  await expect(page.getByLabel("Use AI summaries")).not.toBeChecked();
  await page.getByLabel("Use AI summaries").click();
  await expect.poll(() => sent.find((s) => s.path === "/api/v1/learn/notebook/ai")?.body).toEqual({ on: true });
  await page.getByRole("button", { name: "Copy as text" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("== Quizzes ==");
});

test("Leaderboard: an adult sees nicknames, ranks and streaks; a teen sees only labelled practice rivals and themself", async ({ page }) => {
  await mount(page, "leaderboard");
  await expect(page.getByRole("columnheader")).toHaveText(["Place", "Nickname", "Rank", "Streak"]);
  await expect(page.getByText("Practice rival (simulated)")).toHaveCount(0);
  const teen = await page.context().newPage();
  await mount(teen, "leaderboard", 1280, "teen");
  await expect(teen.getByText("Practice rival (simulated)")).toHaveCount(2);
  await expect(teen.getByText("not real people", { exact: false })).toBeVisible();
  await expect(teen.getByRole("link")).toHaveCount(0);
});

test("Community: outside links open in a new tab and say so; the Owner's change needs a reason", async ({ page }) => {
  const sent = await mount(page, "community");
  const link = page.getByRole("link", { name: /Discord/ });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toContainText("outside link, opens in a new tab");
  const save = page.getByRole("button", { name: "Save links" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Hide these links from teens (14 to 17)").check();
  await page.getByLabel("Reason (recorded)").fill("Test: checked with counsel");
  await save.click();
  await expect.poll(() => sent.find((s) => s.method === "PUT" && s.path === "/api/v1/community")?.body).toEqual({ discordUrl: "https://example.org/discord", socialLinks: [], hideFromTeens: true, reason: "Test: checked with counsel" });
});

test("Capstone: tick every deliverable and check, save; no plan listed says a paid plan may be needed", async ({ page }) => {
  const sent = await mount(page, "capstone");
  await expect(page.getByText("A paid plan may be needed", { exact: false })).toBeVisible();
  await page.getByLabel("A one-page test plan").check();
  await page.getByLabel("I checked my plan").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => sent.find((s) => s.method === "PUT")?.body).toEqual({ checked: { d0: true, c0: true } });
  await expect(page.getByText("Capstone done. Finish every module to complete the course.")).toBeVisible();
});

test("Account: nickname, opt-out and the private state", async ({ page }) => {
  const sent = await mount(page, "account");
  await page.getByRole("textbox", { name: "Nickname" }).fill("Comet_Two");
  await page.getByRole("button", { name: "Save nickname" }).click();
  await expect.poll(() => sent.find((s) => s.path === "/api/v1/leaderboard/nickname")?.body).toEqual({ nickname: "Comet_Two" });
  await page.getByLabel("Show me on the leaderboard").click();
  await expect.poll(() => sent.find((s) => s.path === "/api/v1/leaderboard/visibility")?.body).toEqual({ optOut: true });
  await page.getByLabel("Your state (private)").selectOption("OR");
  await page.getByRole("button", { name: "Save state" }).click();
  await expect.poll(() => sent.find((s) => s.method === "PUT" && s.path === "/api/v1/account/state")?.body).toEqual({ state: "OR" });
});

test("Guardian Center: approve a teen's mission request from the keyboard; the limits are listed", async ({ page }) => {
  const sent = await mount(page, "guardian");
  await expect(page.getByText("No meeting anyone in person.")).toBeVisible();
  await page.getByRole("button", { name: /^Approve/ }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.find((s) => s.path === `/api/v1/guardian/missions/${ID(80)}`)?.body).toEqual({ decision: "approve" });
  await expect(page.getByText("No requests waiting.")).toBeVisible();
});

test("Owner: turn a mission kind on for teens in a state, with a reason", async ({ page }) => {
  const sent = await mount(page, "missions");
  await expect(page.getByRole("cell", { name: "Oregon" })).toBeVisible();
  await page.getByLabel("Kind of mission").selectOption("public_post");
  await page.getByRole("combobox", { name: "State", exact: true }).selectOption("TX");
  await page.getByLabel("Reason (recorded)").first().fill("Test: checked with counsel");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => sent.find((s) => s.method === "PUT")?.body).toEqual({ missionType: "public_post", state: "TX", teensAllowed: true, reason: "Test: checked with counsel" });
});

test("Topics admin: a Side hustles tab and the estimates editor", async ({ page }) => {
  const sent = await mount(page, "topics");
  await page.getByRole("button", { name: "Side hustles" }).click();
  await expect(page.getByText("Newsletter business", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("SEO services", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Edit estimates/ }).click();
  await page.getByLabel("Lowest").fill("0");
  await page.getByLabel("Highest").fill("50");
  await page.getByLabel("Sources (one per line: title | https link)").first().fill("Test pricing page | https://example.org/pricing");
  await page.getByLabel("Checked on").first().fill("2026-10-01");
  await page.getByRole("button", { name: "Save estimates" }).click();
  await expect.poll(() => sent.find((s) => s.method === "PATCH")?.body).toMatchObject({ costLow: 0, costHigh: 50, costSources: [{ title: "Test pricing page", url: "https://example.org/pricing" }], costCheckedOn: "2026-10-01" });
});

test("Studio: the size tier, and a Very important label needs its Notebook note", async ({ page }) => {
  const sent = await mount(page, "studio");
  await expect(page.getByLabel("Course size")).toHaveValue("compact");
  const form = page.getByRole("form", { name: "Label for Test quiz 1?" });
  await form.getByLabel("Importance").selectOption("very_important");
  const save = form.getByRole("button", { name: /Save label/ });
  await expect(save).toBeDisabled();
  await form.getByLabel(/Notebook note/).fill("Test note: the title tag is the first thing a result shows.");
  await save.click();
  await expect.poll(() => sent.find((s) => s.path.endsWith(`/activities/${ID(601)}/labels`))?.body).toEqual({ importance: "very_important", notebookNote: "Test note: the title tag is the first thing a result shows.", missionType: null });
});

test("Lesson: labels, done, a notice shown once, Mark as done, a teen asks their Guardian, a finished video counts", async ({ page }) => {
  const sent = await mount(page, "lesson");
  await expect(page.getByText("Test: some places need a business license.", { exact: false })).toBeVisible();
  await expect(page.getByText("Very important").first()).toBeVisible();
  await expect(page.getByText("Should know").first()).toBeVisible();
  await expect(page.getByText("Real-world mission:", { exact: false })).toBeVisible();
  await expect(page.getByText("No messaging private individuals.")).toBeVisible();
  await page.getByRole("button", { name: "Ask my Guardian to approve missions in this course" }).click();
  await expect.poll(() => sent.find((s) => s.path === "/api/v1/learn/missions/request")?.body).toEqual({ itemId: ID(63), scope: "course" });
  await page.locator("fieldset").filter({ hasText: "Test assignment 1?" }).getByRole("button", { name: "Mark as done" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.some((s) => s.path === `/api/v1/learn/activities/${ID(63)}/complete`)).toBe(true);
  // The notice stays on this page (it was shown once) even after the lesson reloads.
  await expect(page.getByText("Test: some places need a business license.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Play: Test video 1" }).click();
  await page.locator("video").evaluate((v) => v.dispatchEvent(new Event("ended")));
  await expect.poll(() => sent.some((s) => s.path === `/api/v1/learn/videos/${ID(64)}/watched`)).toBe(true);
});

test("Sign-up: the private state question after the date of birth is sent with the time zone", async ({ page }) => {
  const sent = await mount(page, "dob");
  await page.getByLabel("Month").selectOption("3");
  await page.getByLabel("Day").fill("4");
  await page.getByLabel("Year").fill("2001");
  await page.getByLabel("I live in the United States").check();
  await page.getByLabel("Your state (private)").selectOption("OR");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => sent.find((s) => s.method === "POST" && s.path === "/api/registration")?.body).toMatchObject({ dateOfBirth: "2001-03-04", usResident: true, usState: "OR", timeZone: expect.any(String) });
});
