/**
 * I1: the Import course page and the C2 live-check fixes, as real React components in a real browser with the app's real
 * stylesheets (no server: the API is answered here with the real routes' shapes, from tests/integration/course-import.test.ts).
 *   Import: paste or choose a file; Check file lists problems grouped, with paths; Create Draft is off until a clean check
 *   of exactly that text; creating shows the editor and checklist links; anyone but the Owner is refused.
 *   Fixes: a refused topics save says why next to its Save button and keeps what was typed; the sources boxes show the
 *   line format; the Admin link is shown to the Owner and staff only; the Topics intro names side hustles; the topics
 *   table stays readable at phone width.
 * Then axe at desktop and phone width.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { sampleCourse } from "../../tests/fixtures/course-import";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css",
  "app/admin/import/import.css", "app/admin/topics/topics.css"].map((f) => readFileSync(f, "utf8")).join("\n");
const AXE = readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8");
let bundle = "";
test.beforeAll(async () => {
  const stubs = resolve("e2e/components/fixtures/c2-stubs.tsx");
  const out = await build({
    entryPoints: ["e2e/components/fixtures/i1-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty" },
    alias: { "@clerk/nextjs": stubs, "next/link": stubs, "next/navigation": stubs },
  });
  bundle = out.outputFiles[0].text;
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SUMMARY = { topic: "Freelance graphic design", title: "Test import course (fake example)", sizeTier: "compact", modules: 3, lessons: 3, items: { video: 3, quiz: 3, assignment: 3, sandbox: 3, sequence: 3 },
  videoSlots: 3, sources: 1, resources: 2, resourcesHidden: 1, capstone: true, notices: 1, newDraftVersion: false };
const CLEAN = { ok: true, problems: [], warnings: [{ path: "resources[1]", message: "\"Test unchecked resource\": terms not checked, so it is stored but not shown to learners." }], summary: SUMMARY, bytes: 16000, sha256: "a".repeat(64) };
const BAD = { ...CLEAN, ok: false, warnings: [], problems: [
  { path: "modules[2].items[4].sourceIds[0]", message: "unknown source \"s9\"", group: "sources" },
  { path: "modules[1].lessons[0].sections[0].paragraphs[0].text", message: "reads as a promise to make or earn money: \"earn $5,000\". Reword it.", group: "income" },
  { path: "modules[1].items", message: "needs at least 3 different task types (has 2)", group: "items" },
] };
const CREATED = { ...CLEAN, created: { courseId: ID(5), version: 1, academySlug: "graphic-design", counts: { modules: 3 }, editor: "/admin/courses/graphic-design", checklist: "/admin/review" } };
const topic = (n: number, kind: string, name: string) => ({
  id: ID(90 + n), kind, slug: name.toLowerCase().replace(/ /g, "-"), name, blurb: `Test blurb for ${name}, long enough to wrap onto more than one line in a narrow column.`, published: true, teenHidden: false, hasCourse: false, sortOrder: n * 10,
  catalogSlug: null, course: { status: "none", label: "None", firstLessonId: null }, demand30: 1, demandAll: 2, activePicks: 1,
  ...(kind === "skill" ? {} : { facts: { costLow: null, costHigh: null, costItems: [], costSources: [], costCheckedOn: null, outlookLabel: null, outlookSources: [], outlookCheckedOn: null, difficulty: null, riskNotes: null, teachesSkills: [] },
    card: { cost: null, outlook: null, difficulty: null, riskNotes: null, empty: "Estimate coming", note: "Estimate, not a promise." } }),
});
const TOPICS = { topics: [topic(1, "business", "Freelance graphic design"), topic(2, "side_hustle", "Newsletter business"), topic(3, "skill", "Copywriting")], note: "Demand counts are anonymous." };

type Sent = { method: string; path: string; body: unknown };
async function mount(page: Page, view: string, width = 1280, role = "owner") {
  const sent: Sent[] = [];
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()!) as Record<string, unknown> : null;
    sent.push({ method: req.method(), path, body });
    const json = (status: number, b: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (path === "/api/v1/me") return json(200, { account: { id: ID(9), roleKey: role, role, displayName: "Test person", email: "test@example.com", assignedCourses: [] } });
    if (path === "/api/registration") return json(200, { state: "ready" });
    if (path === "/api/v1/courses/import/check") return json(200, String(body?.content).includes("s9") ? BAD : CLEAN);
    if (path === "/api/v1/courses/import") return json(201, CREATED);
    if (path === "/api/v1/topics" && req.method() === "GET") return json(200, TOPICS);
    if (path === "/api/v1/topics") return json(400, { error: "invalid_request", reason: "Give the topic a name of 2 to 80 characters." });
    if (path.startsWith("/api/v1/topics/")) return json(400, { error: "invalid_request", reason: "Each source needs a title and an https link." });
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
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const good = JSON.stringify(sampleCourse(), null, 2);

test.describe("Import course", () => {
  test("Check file lists every problem, grouped and counted, with its path; Create Draft stays off", async ({ page }) => {
    const sent = await mount(page, "import");
    const bad = good.replace('"sourceIds": [\n            "s1"\n          ],\n          "prompt": "Test task: put', '"sourceIds": [\n            "s9"\n          ],\n          "prompt": "Test task: put');
    await page.getByLabel("Or paste it here").fill(bad.includes("s9") ? bad : good + " s9");
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByRole("heading", { name: "3 problems" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sources (1)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Income claims and attorney wording (1)" })).toBeVisible();
    await expect(page.getByText("modules[2].items[4].sourceIds[0]")).toBeVisible();
    await expect(page.getByText('unknown source "s9"', { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Draft" })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("3 problems to fix. Nothing was created.");
    expect(sent.filter((s) => s.path === "/api/v1/courses/import")).toHaveLength(0);
  });

  test("keyboard: a clean check turns Create Draft on; editing the text turns it off again; creating shows the editor and checklist links", async ({ page }) => {
    const sent = await mount(page, "import");
    await page.getByLabel("Or paste it here").fill(good);
    const check = page.getByRole("button", { name: "Check file" });
    await check.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("3 modules, 3 lessons (Draft lesson versions)")).toBeVisible();
    await expect(page.getByText("3 video slots, each “Waiting for video”")).toBeVisible();
    await expect(page.getByText("2 resources (1 not shown to learners until their terms are checked)")).toBeVisible();
    const create = page.getByRole("button", { name: "Create Draft" });
    await expect(create).toBeEnabled();
    await page.getByLabel("Or paste it here").press("End");
    await page.keyboard.type(" ");
    await expect(create).toBeDisabled();
    await check.click();
    await expect(create).toBeEnabled();
    await create.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent.find((s) => s.path === "/api/v1/courses/import")?.body).toEqual({ fileName: "pasted.json", content: good + " " });
    await expect(page.getByRole("status")).toHaveText("Created a Draft: version 1. Nothing was published or approved.");
    await expect(page.getByRole("link", { name: "Open in the course editor" })).toHaveAttribute("href", "/admin/courses/graphic-design");
    await expect(page.getByRole("link", { name: "Owner review checklist" })).toHaveAttribute("href", "/admin/review");
  });

  test("choosing a file loads it with its name; a file over 2 MB is refused before sending", async ({ page }) => {
    const sent = await mount(page, "import");
    await page.getByLabel(/Choose a file/).setInputFiles({ name: "my-course.json", mimeType: "application/json", buffer: Buffer.from(good) });
    await expect(page.getByRole("status")).toHaveText('Loaded "my-course.json". Check it next.');
    await page.getByRole("button", { name: "Check file" }).click();
    await expect.poll(() => sent.find((s) => s.path === "/api/v1/courses/import/check")?.body).toMatchObject({ fileName: "my-course.json" });
    await page.getByLabel(/Choose a file/).setInputFiles({ name: "big.json", mimeType: "application/json", buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 32) });
    await expect(page.getByRole("status")).toHaveText('"big.json" is 2.0 MB; 2 MB at most.');
  });

  test("the file's text is shown as plain text, never as HTML", async ({ page }) => {
    await mount(page, "import");
    await page.getByLabel("Or paste it here").fill('<img src=x onerror="window.__pwned=1">' + good);
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("3 modules, 3 lessons (Draft lesson versions)")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  for (const role of ["superAdmin", "courseAdmin", "learner"]) {
    test(`a ${role} is told only the Owner imports`, async ({ page }) => {
      await mount(page, "importOnly", 1280, role);
      await expect(page.getByText("Only the Owner imports a course.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Check file" })).toHaveCount(0);
    });
  }

  for (const width of [1280, 390]) {
    test(`axe at ${width}px (with problems listed)`, async ({ page }) => {
      await mount(page, "import", width);
      await page.getByLabel("Or paste it here").fill(good + " s9");
      await page.getByRole("button", { name: "Check file" }).click();
      await expect(page.getByRole("heading", { name: "3 problems" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await fits(page)).toBe(true);
    });
  }
});

test.describe("C2 live-check fixes", () => {
  test("topics: a refused save says why next to Save, keeps what was typed, and the sources boxes show the line format", async ({ page }) => {
    await mount(page, "topics");
    await page.getByRole("button", { name: /Edit estimates.*Freelance graphic design/ }).click();
    const form = page.getByRole("form", { name: "Estimates for Freelance graphic design" });
    const sources = form.getByLabel("Sources (one per line: title | https link)").first();
    await expect(sources).toHaveAttribute("placeholder", "Title | https://link");
    await form.getByLabel("Lowest").fill("10");
    await sources.fill("No link here");
    await form.getByRole("button", { name: "Save estimates" }).click();
    await expect(form.getByRole("alert")).toHaveText("Each source needs a title and an https link.");
    // The page-top message stays too.
    await expect(page.getByRole("status").first()).toHaveText("Each source needs a title and an https link.");
    await expect(form.getByLabel("Lowest")).toHaveValue("10");
    await expect(sources).toHaveValue("No link here");
    // The add form keeps its text on a refusal too.
    await page.getByLabel("Name").last().fill("Test new business");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("form", { name: "Add a business" }).getByRole("alert")).toHaveText("Give the topic a name of 2 to 80 characters.");
    await expect(page.getByLabel("Name").last()).toHaveValue("Test new business");
  });

  test("topics: the intro names businesses, side hustles and skills", async ({ page }) => {
    await mount(page, "topics");
    await expect(page.getByText("The businesses, side hustles and skills learners pick", { exact: false })).toBeVisible();
  });

  test("topics: at phone width the topic name keeps a readable column; the table scrolls inside its box", async ({ page }) => {
    await mount(page, "topics", 390);
    const cell = page.getByRole("cell", { name: /Freelance graphic design/ }).first();
    await expect(cell).toBeVisible();
    expect((await cell.boundingBox())!.width).toBeGreaterThanOrEqual(240);
    expect(await fits(page)).toBe(true);
  });

  for (const [role, shown] of [["owner", true], ["superAdmin", true], ["courseAdmin", true], ["reviewer", true], ["support", true], ["learner", false], ["guardian", false]] as const) {
    test(`main navigation: the Admin link is ${shown ? "shown" : "not shown"} to ${role}`, async ({ page }) => {
      await mount(page, "home", 1280, role);
      await expect(page.getByText(/Signed in as/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(shown ? 1 : 0);
      if (shown) await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveAttribute("href", "/admin");
    });
  }

  test("the admin home lists the Owner's pages, including Import course", async ({ page }) => {
    await mount(page, "adminHome");
    const nav = page.getByRole("navigation", { name: "Admin pages" });
    await expect(nav.getByRole("link", { name: "Import course" })).toHaveAttribute("href", "/admin/import");
    await expect(nav.getByRole("link", { name: "Topics" })).toBeVisible();
  });

  test("the admin home lists only a Support Admin's pages", async ({ page }) => {
    await mount(page, "adminHome", 1280, "support");
    const nav = page.getByRole("navigation", { name: "Admin pages" });
    await expect(nav.getByRole("link")).toHaveText(["Account safeguards"]);
  });

  for (const width of [1280, 390]) {
    test(`axe: topics at ${width}px`, async ({ page }) => {
      await mount(page, "topics", width);
      await expect(page.getByText("Freelance graphic design").first()).toBeVisible();
      expect(await axe(page)).toEqual([]);
      expect(await fits(page)).toBe(true);
    });
    test(`axe: admin home at ${width}px`, async ({ page }) => {
      await mount(page, "adminHome", width);
      await expect(page.getByRole("navigation", { name: "Admin pages" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }
});
