/**
 * Bug stage: the Owner, signed in, saw no Admin link on / and /account, the public landing (Sign in, Start trial) on /,
 * and "No admin pages for this account." with "Sign in to continue." on /admin. Each of those asked "who is signed in"
 * once, as soon as it mounted, with a bare fetch, and showed any early refusal as final. These tests replay that:
 * the first answers are a 401 (Clerk's session cookie not yet refreshed) and "device not trusted" (the device check
 * still running), then the real answer. Real pages, under the root layout's staff navigation (as app/layout.tsx).
 *   Owner: the Admin link is on / and /account; / shows the signed-in Home, not the landing; /admin lists the pages.
 *   Learner and Guardian: never an Admin link.
 *   Owner without a second factor: /admin says so, with the link to set it up (the rule itself is unchanged).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css",
  "app/landing/hall/hall.css", "app/landing/world/world.css"].map((f) => readFileSync(f, "utf8")).join("\n");
let bundle = "";
test.beforeAll(async () => {
  const stubs = resolve("e2e/components/fixtures/c2-stubs.tsx");
  const out = await build({
    entryPoints: ["e2e/components/fixtures/nav-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty", ".webp": "empty", ".avif": "empty", ".png": "empty", ".jpg": "empty" },
    alias: { "@clerk/nextjs": stubs, "next/link": stubs, "next/navigation": stubs },
  });
  bundle = out.outputFiles[0].text;
});

type Opts = { role?: string; clerkSignedIn?: boolean; early?: ("stale" | "device")[]; secondFactorMissing?: boolean };
async function mount(page: Page, view: string, o: Opts = {}) {
  const { role = "owner", clerkSignedIn = true, early = ["stale", "device"], secondFactorMissing = false } = o;
  const queue = [...early];
  const meCalls: number[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, b: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (path === "/api/v1/me") {
      meCalls.push(Date.now());
      if (secondFactorMissing) return json(401, { error: "unauthorized" });
      const next = queue.shift();
      if (next === "stale") return json(401, { error: "unauthorized" });
      if (next === "device") return json(403, { error: "device_not_trusted", reason: "This browser isn't one of your trusted devices yet." });
      return json(200, { account: { id: "00000000-0000-4000-8000-000000000009", roleKey: role, role, displayName: "Test person", email: "test@example.com", assignedCourses: [] } });
    }
    if (path === "/api/registration") return json(200, secondFactorMissing ? { state: "second_factor" } : { state: "ready" });
    if (path === "/api/v1/session") return json(200, { device: { trusted: true }, heartbeatSeconds: 60, deviceLimit: 3, enforcement: {}, session: null });
    if (path === "/api/v1/admins") return json(200, { admins: [], invites: [] });
    return json(404, { error: "not_found", reason: "Not in this test." });
  });
  await page.route("https://ascentra.test/", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en" data-glass="liquid" data-motion="off"><head><title>Test</title><style>${CSS}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("https://ascentra.test/");
  await page.evaluate(([v, s]) => { const w = window as unknown as { __view: string; __clerkSignedIn: boolean }; w.__view = v as string; w.__clerkSignedIn = s as boolean; }, [view, clerkSignedIn]);
  await page.addScriptTag({ content: bundle });
  return meCalls;
}
const adminLink = (page: Page) => page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Admin", exact: true });

test.describe("Owner signed in, first answers refused while the session and device settle", () => {
  test("/: the Admin link shows, and the page is the signed-in Home, not the landing (no Sign in, no Start trial)", async ({ page }) => {
    await mount(page, "home");
    await expect(adminLink(page)).toHaveAttribute("href", "/admin");
    await expect(page.locator("[data-landing]")).toHaveAttribute("data-auth", "in");
    await expect(page.getByText(/Signed in as Test person \(Owner\)/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Start 14-day trial/ })).toBeHidden();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeHidden();
    // Exactly one Admin link (the duplicate "Administrators" is gone).
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Administrators" })).toHaveCount(0);
    // The session token was refreshed before asking the API.
    expect(await page.evaluate(() => (window as unknown as { __tokens?: number }).__tokens ?? 0)).toBeGreaterThan(0);
  });

  test("/: even when Clerk's browser state lags (signed out there), the server's answer shows the signed-in Home", async ({ page }) => {
    await mount(page, "home", { clerkSignedIn: false, early: [] });
    await expect(page.locator("[data-landing]")).toHaveAttribute("data-auth", "in");
    await expect(adminLink(page)).toHaveAttribute("href", "/admin");
  });

  test("/account: the Admin link shows", async ({ page }) => {
    await mount(page, "account");
    await expect(page.getByRole("heading", { name: "Account and devices" })).toBeVisible();
    await expect(adminLink(page)).toHaveAttribute("href", "/admin");
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(1);
  });

  test("/admin: lists the Owner's admin pages; never 'No admin pages' or 'Sign in to continue.'", async ({ page }) => {
    await mount(page, "admin");
    const nav = page.getByRole("navigation", { name: "Admin pages" });
    await expect(nav.getByRole("link", { name: "Import course" })).toHaveAttribute("href", "/admin/import");
    await expect(nav.getByRole("link", { name: "Owner review" })).toBeVisible();
    await expect(page.getByText("No admin pages for this account.")).toHaveCount(0);
    await expect(page.getByText("Sign in to continue.")).toHaveCount(0);
  });
});

test.describe("never for a learner or a Guardian", () => {
  for (const role of ["learner", "guardian"]) {
    for (const view of ["home", "account"]) {
      test(`${role} on ${view === "home" ? "/" : "/account"}: no Admin link`, async ({ page }) => {
        const calls = await mount(page, view, { role });
        await expect.poll(() => calls.length).toBeGreaterThanOrEqual(3);
        await expect(page.getByRole("navigation", { name: "Staff" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
      });
    }
  }
});

test("Owner without a second factor: /admin says so, with the link to set it up (nothing is opened)", async ({ page }) => {
  await mount(page, "admin", { secondFactorMissing: true });
  await expect(page.getByRole("link", { name: "Set up your authenticator to open Admin" })).toHaveAttribute("href", "/account#sign-in-methods");
  await expect(page.getByRole("navigation", { name: "Admin pages" })).toHaveCount(0);
  await expect(adminLink(page)).toHaveCount(0);
});
