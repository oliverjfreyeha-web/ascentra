/**
 * R1: sign-up in the new order, on the real app with real Clerk sign-ins (development instance) and a real database:
 * account → date of birth and "I live in the United States" → "Choose your path" → plan → learner home. Learners have
 * no second factor here (it's optional for them now). Stripe Checkout itself isn't driven: the plan step is checked to
 * appear, and the trial is then recorded straight in the database, as the Stripe webhook would.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { createTestUser, type TestUser } from "../lib/clerk-users";
import { pageReady, signInWithPassword } from "../lib/sign-in";
import { E2E_PREFIX, STATE_FILE } from "./constants";

type State = { baseURL: string; dbUrl: string };
const state = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));
const yearsAgo = (n: number) => { const d = new Date(); return { y: String(d.getFullYear() - n), m: String(d.getMonth() + 1), d: String(Math.min(d.getDate(), 28)) }; };

let db: pg.Client;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { db = new pg.Client({ connectionString: state().dbUrl }); await db.connect(); });
test.afterAll(async () => { await db?.end(); });

async function signedIn(browser: Browser, u: TestUser) {
  const ctx = await browser.newContext({ baseURL: state().baseURL });
  const page = await ctx.newPage();
  // No second factor: Clerk only asks for the password.
  await signInWithPassword(page, { email: u.email, password: u.password });
  await pageReady(page);
  return { ctx, page };
}

async function dateOfBirth(page: Page, years: number) {
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { name: "What's your date of birth?" })).toBeVisible({ timeout: 15_000 });
  const dob = yearsAgo(years);
  await page.getByLabel("Month").selectOption(dob.m);
  await page.getByLabel("Day").fill(dob.d);
  await page.getByLabel("Year").fill(dob.y);
  // Continue without confirming the US: a clear message, and nothing is sent.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Confirm that you live in the United States to continue.")).toBeVisible();
  // The box shows it's checked (R1: it didn't before).
  const box = page.getByRole("checkbox", { name: "I live in the United States" });
  await page.getByText("I live in the United States").click();
  await expect(box).toBeChecked();
  expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(160, 189, 219)");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function interview(page: Page) {
  await page.waitForURL(/\/learn\/choose\?onboarding=1/, { timeout: 20_000 });
  await pageReady(page);
  for (const [q, a] of [["What do you want", "Start a business of my own"], ["How much time", "About 5 hours"], ["How much experience", "None yet"],
    ["Which sounds most like you", "Building things"], ["How do you feel about being on camera", "I'd rather not"]] as const) {
    await page.getByRole("group", { name: new RegExp(q) }).getByText(a).click();
  }
  await page.getByRole("button", { name: "See my matches" }).click();
  await expect(page.getByRole("heading", { name: "2. Your business" })).toBeVisible();
  await page.getByRole("button", { name: /^Pick / }).first().click();
  await expect(page.getByText("Only the Owner can change this.").first()).toBeVisible();
  await page.getByRole("button", { name: "Next: skills" }).click();
  await expect(page.getByText("0 of 3 skills used")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

test("an adult signs up in the new order: date of birth, then the interview, then the plan, then the learner home", async ({ browser }) => {
  const u = await createTestUser(`${E2E_PREFIX}r1-adult+clerk_test@example.com`, { label: "E2E R1 adult", secondFactor: false });
  const { ctx, page } = await signedIn(browser, u);
  // No second-factor step for a learner.
  await expect(page.getByText("second factor", { exact: false })).toHaveCount(0);
  await dateOfBirth(page, 30);
  await interview(page);
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible({ timeout: 20_000 });
  // The trial starts (as Stripe's webhook would record it): the learner home, and the plan step doesn't come back.
  const id = (await db.query("select id from public.accounts where email = $1", [u.email])).rows[0].id;
  await db.query("insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', 'trial', now() - interval '1 minute')", [id]);
  await page.goto("/welcome");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await page.goto("/welcome");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  // Optional, never blocking: the suggestion to add an authenticator app.
  await expect(page.getByText("Add extra protection with an authenticator app (recommended).")).toBeVisible();
  await ctx.close();
});

test("a returning learner resumes at the next unfinished step, in a fresh browser, without a device dead end", async ({ browser }) => {
  const u = await createTestUser(`${E2E_PREFIX}r1-resume+clerk_test@example.com`, { label: "E2E R1 resume", secondFactor: false });
  const first = await signedIn(browser, u);
  await dateOfBirth(first.page, 25);
  await first.page.waitForURL(/\/learn\/choose/, { timeout: 20_000 });
  await first.ctx.close();
  // A new browser (like a private window): straight back to the interview; Account works, with no device error.
  const again = await signedIn(browser, u);
  await again.page.goto("/");
  await again.page.waitForURL(/\/learn\/choose\?onboarding=1/, { timeout: 20_000 });
  await again.page.goto("/account");
  await pageReady(again.page);
  await expect(again.page.getByText("isn't one of your trusted devices")).toHaveCount(0);
  await again.ctx.close();
});

test("a teen waits for the Guardian; once active, they do the interview and land on the learner home (no plan step)", async ({ browser }) => {
  const u = await createTestUser(`${E2E_PREFIX}r1-teen+clerk_test@example.com`, { label: "E2E R1 teen", secondFactor: false });
  const { ctx, page } = await signedIn(browser, u);
  await dateOfBirth(page, 15);
  await expect(page.getByRole("heading", { name: "A parent or guardian sets this up with you" })).toBeVisible({ timeout: 20_000 });
  // The Guardian's steps (B3) are covered by their own tests; here the account is activated as they would leave it.
  const id = (await db.query("select id from public.accounts where email = $1", [u.email])).rows[0].id;
  await db.query("set session_replication_role = replica");
  await db.query("update public.accounts set status = 'active' where id = $1", [id]);
  await db.query("set session_replication_role = default");
  await page.goto("/welcome");
  await interview(page);
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await ctx.close();
});

test("Create account while signed in says so, with a way on and a way out", async ({ browser }) => {
  const u = await createTestUser(`${E2E_PREFIX}r1-signedin+clerk_test@example.com`, { label: "E2E R1 signed in", secondFactor: false });
  const { ctx, page } = await signedIn(browser, u);
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: `You're already signed in as ${u.email}.` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Go to my account" })).toHaveAttribute("href", "/account");
  await page.getByRole("button", { name: "Sign out to create a different account" }).click();
  await page.waitForURL(/\/sign-up/);
  await expect(page.getByRole("heading", { name: "Create an ASCENTRA account" })).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});
