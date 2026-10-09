/**
 * C1: the course studio, the Owner's review checklist and the learner's lesson videos, as real React components in a real
 * browser with the app's real stylesheets (no server: the API is answered here with the shapes the real routes return).
 * Checks what a person does with them: reorder modules and lessons with the keyboard (and the mouse), approve a ready
 * module or send one back with a note, copy a video brief, get a plain message for a file that isn't a video, see the
 * empty-slot warning and the income-claims findings, read the checklist; a learner's video never plays by itself and
 * "Video coming" is plain text. Then axe on each screen at desktop and phone width.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css", "app/ui/neo.css"]
  .map((f) => readFileSync(f, "utf8")).join("\n");
const AXE = readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8");
let bundle = "";

test.beforeAll(async () => {
  const out = await build({
    entryPoints: ["e2e/components/fixtures/studio-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty" },
    alias: { "@clerk/nextjs": resolve("e2e/components/fixtures/stubs.tsx"), "next/link": resolve("e2e/components/fixtures/stubs.tsx") },
  });
  bundle = out.outputFiles[0].text;
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const brief = { purpose: "Test purpose", points: [{ text: "Test point", sources: [{ sourceId: ID(900), title: "Test outreach study" }] }], targetMinutes: 5, tone: "Plain", onScreen: [], avoid: [] };
const slot = (n: number, status: "waiting" | "uploaded" | "approved") => ({
  id: ID(300 + n), position: 1, title: `Test video ${n}`, lessonId: null, status, brief, briefText: `Video: Test video ${n}\n\nCover these points, in this order:\n1. Test point (source: Test outreach study)`,
  briefBy: "ai", briefEditedAt: null, transcript: status === "waiting" ? "" : "Test transcript: what a good first line looks like.", approvedAt: status === "approved" ? "2026-10-01T10:00:00.000Z" : null,
  file: status === "waiting" ? null : { name: "intro.mp4", size: 5_000_000, mime: "video/mp4", uploadedAt: "2026-10-01T09:00:00.000Z" },
  history: status === "waiting" ? [] : [{ id: ID(400 + n), name: "intro.mp4", size: 5_000_000, status: "accepted", reason: null, uploadedAt: "2026-10-01T09:00:00.000Z", replacedAt: null }],
});
const coverage = (ok: boolean) => ({ counts: { videos: 1, quizzes: ok ? 1 : 0, assignments: 1, sandboxes: 1, sequences: 1, boosters: 0 }, missing: ok ? [] : ["quizzes"], short: [], boostersMissing: [], types: ok ? 4 : 3, varietyOk: true });
const mod = (n: number, ready: boolean, review: unknown = null) => ({
  id: ID(100 + n), position: n, title: `Test module ${n}`, stage: "Foundations", recipe: { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 1, boosters: [] }, recommendedPace: "About 1 week",
  state: { coverage: coverage(ready), findings: [], blockers: ready ? [] : ["No reviewed quiz item yet."], ready, candidates: [], itemIds: [], review },
  lessons: [1, 2].map((k) => ({
    id: ID(200 + n * 10 + k), position: k, title: `Test lesson ${n}.${k}`, minutes: 10, open: { id: ID(500 + n * 10 + k), version: 1, status: "draft", verified: false, returnedNote: null }, published: null,
    text: { versionId: ID(500 + n * 10 + k), version: 1, status: "draft", body: { summary: "Test summary.", sections: [{ heading: "Test", paragraphs: [{ text: "Test paragraph.", refs: [1] }] }], takeaways: [] } },
  })),
  items: [{ id: ID(600 + n), lessonId: ID(200 + n * 10 + 1), type: "spot_the_mistake", part: "sandbox", partSet: true, booster: null, status: "draft", prompt: "Test prompt?" }],
  slots: [slot(n, n === 1 ? "approved" : n === 2 ? "uploaded" : "waiting")],
});
const STUDIO = {
  course: { id: ID(1), slug: "cold-outreach", name: "Cold outreach (test)" },
  version: { id: ID(2), version: 1, status: "draft", ownerReviewRequired: true, isDraft: true, publishedAt: null, unpublishedAt: null },
  live: null,
  modules: [mod(1, true, { decision: "approved", note: null, decidedAt: "2026-10-02T10:00:00.000Z", current: true }), mod(2, true), mod(3, false), mod(4, false), mod(5, false, { decision: "sent_back", note: "Test: add an example", decidedAt: "2026-10-02T11:00:00.000Z", current: false })],
  findings: [{ where: 'Module 3 "Test module 3" › lesson "Test lesson 3.1" v1 › section 1 "Test" › paragraph 1', text: "earn $5,000", claim: "a promise to make or earn money", excerpt: "…you will earn $5,000 a month…" }],
  emptySlots: 4,
  boosters: [{ key: "teach-it-back", name: "Teach it back", description: "Explain it in your own words.", itemTypes: ["teach_back"] }],
  canPublish: false,
  publishBlockers: ['Module 2 "Test module 2" needs the Owner\'s approval.'],
};
const CHECKLIST = { courses: [{
  slug: "cold-outreach", name: "Cold outreach (test)", version: 1, status: "draft", unpublished: false, approved: 1, modules: 5,
  waiting: [{ id: ID(102), position: 2, title: "Test module 2" }], notReady: [{ id: ID(103), position: 3, title: "Test module 3", blockers: ["No reviewed quiz item yet."] }],
  sentBack: [{ id: ID(105), position: 5, title: "Test module 5", note: "Test: add an example", at: "2026-10-02T11:00:00.000Z" }],
  emptySlots: [{ id: ID(302), title: "Test video 2", status: "uploaded", module: 2 }], income: { ok: false, findings: STUDIO.findings },
}] };
const BOOSTERS = { boosters: [{ id: ID(700), key: "teach-it-back", name: "Teach it back", description: "Explain it in your own words.", itemTypes: ["teach_back"], active: true, inUse: 2 }], types: [{ type: "teach_back", label: "Teach it back" }, { type: "short_answer", label: "Short answer" }] };

type Sent = { method: string; path: string; body: unknown };
async function mount(page: Page, view: "studio" | "review" | "videos", width = 1280) {
  const sent: Sent[] = [];
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    sent.push({ method: req.method(), path, body: req.postData() ? JSON.parse(req.postData()!) : null });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/me") return json(200, { account: { id: ID(9), roleKey: "owner", role: "owner", displayName: "Test owner", email: "owner@example.com" }, roleKey: "owner" });
    if (path.endsWith("/studio")) return json(200, STUDIO);
    if (path === "/api/v1/review/checklist") return json(200, CHECKLIST);
    if (path === "/api/v1/boosters") return json(200, BOOSTERS);
    if (path.startsWith("/api/v1/learn/videos/")) return json(200, { id: ID(301), title: "Test video 1", url: "data:video/mp4;base64,", mime: "video/mp4", expiresIn: 600, transcript: "Test transcript." });
    if (path.endsWith("/upload")) return json(415, { error: "failed", reason: "Upload an mp4 or webm video." });
    return json(200, { ok: true });
  });
  // A real origin, so the components' relative /api/v1 calls resolve (and are answered above).
  await page.route("https://ascentra.test/", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en" data-glass="liquid" data-motion="off"><head><title>Test</title><style>${CSS}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("https://ascentra.test/");
  await page.evaluate((v) => { (window as unknown as { __view: string }).__view = v; }, view);
  await page.addScriptTag({ content: bundle });
  return sent;
}
const meFix = async (page: Page) => {
  // The page reads its role from /api/v1/me through meFrom; wait until the Owner's controls are there.
  await expect(page.getByRole("heading", { name: "Course studio" })).toBeVisible();
};
async function axe(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (n: Document, o: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
}

test.describe("course studio", () => {
  test("shows the income-claims findings, the empty-slot warning and why it can't publish yet", async ({ page }) => {
    await mount(page, "studio");
    await meFix(page);
    await expect(page.getByText("Income-claims check: 1 place to reword.")).toBeVisible();
    await expect(page.getByText('"earn $5,000"', { exact: false })).toBeVisible();
    await expect(page.getByText("4 video slots have no approved video.", { exact: false })).toBeVisible();
    await expect(page.getByText('Module 2 "Test module 2" needs the Owner\'s approval.')).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish course" })).toBeDisabled();
    await expect(page.getByText("Approved by the Owner on", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Sent back by the Owner", { exact: false })).toBeVisible();
  });

  test("keyboard: Tab to a module's Move down and press Enter; the new order is sent", async ({ page }) => {
    const sent = await mount(page, "studio");
    await meFix(page);
    const down = page.getByRole("button", { name: "Move module 1 down" });
    await down.focus();
    await expect(down).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent.find((s) => s.path.endsWith("/modules/order"))?.body).toEqual({ ids: [ID(102), ID(101), ID(103), ID(104), ID(105)] });
    await expect(page.getByRole("button", { name: "Move module 1 up" })).toBeDisabled();
    // Lessons, with the mouse this time.
    await page.getByRole("button", { name: 'Move lesson "Test lesson 2.2" up' }).click();
    await expect.poll(() => sent.find((s) => s.path.endsWith("/lessons/order"))).toMatchObject({ method: "PUT", body: { ids: [ID(222), ID(221)] } });
  });

  test("the Owner approves a ready module; Approve stays off until a module is ready; a send-back needs a note", async ({ page }) => {
    const sent = await mount(page, "studio");
    await meFix(page);
    const m2 = page.getByRole("article", { name: "Module 2: Test module 2 · Foundations" });
    await m2.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => sent.find((s) => s.path.endsWith(`/modules/${ID(102)}/review`))?.body).toEqual({ decision: "approve" });
    const m3 = page.getByRole("article", { name: "Module 3: Test module 3 · Foundations" });
    await expect(m3.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    const back = m3.getByRole("button", { name: "Send back with a note" });
    await expect(back).toBeDisabled();
    await m3.getByLabel("Note for the builders").fill("Test: needs a quiz");
    await back.click();
    await expect.poll(() => sent.find((s) => s.path.endsWith(`/modules/${ID(103)}/review`))?.body).toEqual({ decision: "send_back", note: "Test: needs a quiz" });
  });

  test("copies a video brief; a file that isn't a video gets a plain message; Approve video needs the transcript", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mount(page, "studio");
    await meFix(page);
    const s3 = page.getByRole("region", { name: /Test video 3/ });
    await s3.getByText("Brief", { exact: false }).first().click();
    await s3.getByRole("button", { name: "Copy brief" }).click();
    await expect(s3.getByText("Brief copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Cover these points, in this order:");
    await s3.getByLabel(/Upload the video/).setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
    await expect(s3.getByRole("alert")).toHaveText("Upload an mp4 or webm video.");
    const s2 = page.getByRole("region", { name: /Test video 2/ });
    await expect(s2.getByRole("button", { name: "Approve video" })).toBeEnabled();
    await expect(s2.getByText("Uploaded", { exact: true })).toBeVisible();
  });

  for (const width of [1280, 390]) {
    test(`axe: no WCAG A/AA violations at ${width}px, nothing wider than the screen`, async ({ page }) => {
      await mount(page, "studio", width);
      await meFix(page);
      expect(await axe(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
});

test.describe("Owner review checklist and boosters", () => {
  test("lists what waits, what was sent back, empty slots and the income check", async ({ page }) => {
    await mount(page, "review");
    await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
    await expect(page.getByText("Module 2: Test module 2").first()).toBeVisible();
    await expect(page.getByText("Test: add an example", { exact: false })).toBeVisible();
    await expect(page.getByText("Module 2: Test video 2", { exact: false })).toBeVisible();
    await expect(page.getByText('"earn $5,000"', { exact: false })).toBeVisible();
    await expect(page.getByText("Teach it back").first()).toBeVisible();
  });
  test("keyboard: turn a booster off from the keyboard", async ({ page }) => {
    const sent = await mount(page, "review");
    const off = page.getByRole("button", { name: /^Turn off\s*: Teach it back$/ });
    await off.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent.find((s) => s.path === `/api/v1/boosters/${ID(700)}`)).toMatchObject({ method: "PATCH", body: { active: false } });
  });
  for (const width of [1280, 390]) {
    test(`axe at ${width}px`, async ({ page }) => {
      await mount(page, "review", width);
      await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
});

test.describe("a learner's lesson videos", () => {
  test("an approved video loads only when pressed and never plays by itself; an empty slot says Video coming", async ({ page }) => {
    const sent = await mount(page, "videos");
    await expect(page.getByText("Test video 2: Video coming.", { exact: false })).toBeVisible();
    expect(await page.locator("video").count()).toBe(0);
    expect(sent.filter((s) => s.path.startsWith("/api/v1/learn/videos/"))).toHaveLength(0);
    const play = page.getByRole("button", { name: "Play: Test video 1" });
    await play.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("video")).toHaveCount(1);
    expect(await page.locator("video").evaluate((v: HTMLVideoElement) => ({ autoplay: v.autoplay, paused: v.paused, controls: v.controls }))).toEqual({ autoplay: false, paused: true, controls: true });
    await page.getByText("Transcript", { exact: true }).click();
    await expect(page.getByText("Test transcript: what a good first line looks like.")).toBeVisible();
  });
  for (const width of [1280, 390]) {
    test(`axe at ${width}px`, async ({ page }) => {
      await mount(page, "videos", width);
      expect(await axe(page)).toEqual([]);
    });
  }
});
