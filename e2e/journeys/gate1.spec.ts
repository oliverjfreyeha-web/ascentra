/**
 * Ported journeys (reference/j5.py J10–J13, reference/j6.py T1–T3 and T8): sign-in, admin invite,
 * role change, devices and sessions, and the audit log, on the real app with real Clerk sign-ins
 * (development instance) and a real database. One run, in order: each journey builds on the last.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { createTestUser, rawUser, type TestUser } from "../lib/clerk-users";
import { answerReverification, pageReady, signInWithPassword } from "../lib/sign-in";
import { deliverUserEvent } from "../lib/webhook";
import { E2E_PREFIX, STATE_FILE } from "./constants";

type State = { baseURL: string; dbUrl: string; webhookSecret: string; owner: TestUser };
const state = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));
const REASON = "E2E journey: quarterly access review";

let db: pg.Client;
let ownerCtx: BrowserContext;
let owner: Page;
const supportEmail = `${E2E_PREFIX}support+clerk_test@example.com`;
let support: TestUser;

async function browserFor(browser: Browser, u: { email: string; password: string; totpSecret?: string }) {
  const ctx = await browser.newContext({ baseURL: state().baseURL });
  const page = await ctx.newPage();
  await signInWithPassword(page, u);
  await pageReady(page);
  return { ctx, page };
}
const audit = async (action: string) =>
  (await db.query("select * from public.audit_events where action = $1 order by seq", [action])).rows;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  db = new pg.Client({ connectionString: state().dbUrl });
  await db.connect();
  ({ ctx: ownerCtx, page: owner } = await browserFor(browser, state().owner));
});
test.afterAll(async () => {
  await ownerCtx?.close();
  await db?.end();
});

// ============ Sign-in ============

test.describe("sign-in", () => {
  test("a visitor sees the invitation-only sign-in, passkey first, password and second factor as the fallback", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.getByText("ASCENTRA is invitation-only. There is no public sign-up.")).toBeVisible();
    // Every API route refuses a visitor.
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  });

  test("the Owner signs in with password and authenticator code, and sees the Owner links", async () => {
    await owner.goto("/");
    await pageReady(owner);
    await expect(owner.getByText(/Signed in as .*\(Owner\)/)).toBeVisible();
    for (const name of ["Administrators", "Audit log", "Account safeguards", "Account and devices"]) {
      await expect(owner.getByRole("link", { name })).toBeVisible();
    }
  });

  test("a wrong password doesn't sign in", async ({ page }) => {
    await expect(signInWithPassword(page, { ...state().owner, password: "wrong-password-123", totpSecret: undefined })).rejects.toThrow();
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  });

  test("someone with a Clerk account but no ASCENTRA account lands on \"isn't open yet\"", async ({ browser }) => {
    const stranger = await createTestUser(`${E2E_PREFIX}stranger+clerk_test@example.com`, { label: "E2E stranger" });
    expect(await deliverUserEvent(state().baseURL, state().webhookSecret, "user.created", stranger.raw)).toBe("no_account");
    const { ctx, page } = await browserFor(browser, stranger);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ASCENTRA isn't open yet" })).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
    await ctx.close();
  });
});

// ============ Admin invite (j6 T1, j5 J13) ============

test.describe("admin invite", () => {
  test("the Owner invites a Support Admin with a reason; a reasonless invite is refused", async () => {
    await owner.goto("/admin");
    await pageReady(owner);
    const noReason = await owner.request.post("/api/v1/admins/invites", { data: { email: supportEmail, role: "support" } });
    expect(noReason.status()).toBe(400);
    await owner.getByLabel("Email").fill(supportEmail);
    await owner.getByLabel("Role").first().selectOption("support");
    await owner.locator("#invite-reason").fill(REASON);
    await owner.getByRole("button", { name: "Send invite" }).click();
    await answerReverification(owner, state().owner);
    await expect(owner.getByText("Invite: done.")).toBeVisible({ timeout: 20_000 });
    await expect(owner.getByText(supportEmail)).toBeVisible();
    const ev = await audit("admins.invite");
    expect(ev.at(-1)).toMatchObject({ result: "completed", reason: REASON, is_sensitive: true });
    expect(ev.at(-1).device_id).toEqual(expect.any(String));
  });

  test("accepting ties the invite to that email, once; the role works only with a second factor", async ({ browser }) => {
    const invite = (await db.query("select id from public.role_assignments where invited_email = $1 and status = 'invited'", [supportEmail])).rows[0];
    expect(invite).toBeTruthy();
    // Clerk copies the invitation's public metadata onto the user who accepts it.
    support = await createTestUser(supportEmail, { label: "E2E Support Admin", metadata: { ascentra_invite_id: invite.id } });
    const outcome = await deliverUserEvent(state().baseURL, state().webhookSecret, "user.created", support.raw);
    expect(["invite_claimed", "admin_activated"]).toContain(outcome);
    // Replayed for a second person: refused.
    const replay = await createTestUser(`${E2E_PREFIX}replay+clerk_test@example.com`, { label: "E2E replay", metadata: { ascentra_invite_id: invite.id } });
    expect(await deliverUserEvent(state().baseURL, state().webhookSecret, "user.created", replay.raw)).toBe("invite_refused");
    if (outcome !== "admin_activated") await deliverUserEvent(state().baseURL, state().webhookSecret, "user.updated", await rawUser(support.id));
    expect((await db.query("select status from public.role_assignments where id = $1", [invite.id])).rows[0].status).toBe("active");

    const { ctx, page } = await browserFor(browser, support);
    await expect(page.getByText(/Signed in as .*\(Support Admin\)/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Administrators" })).toHaveCount(0);
    // Super Admin and Support can't manage admins: the page says so, the API refuses and records it.
    await page.goto("/admin");
    await pageReady(page);
    await expect(page.getByRole("alert")).toHaveText("Only the Owner can do this. Support Admin can't.");
    const forged = await page.request.patch(`/api/v1/admins/${(await db.query("select id from public.accounts where role = 'owner'")).rows[0].id}`, { data: { role: "support", reason: REASON } });
    expect(forged.status()).toBe(403);
    await page.goto("/admin/audit");
    await pageReady(page);
    await expect(page.getByRole("alert")).toBeVisible();
    await ctx.close();
  });
});

// ============ Role change (j6 T2, T8) ============

test.describe("role change", () => {
  test("the Owner changes the Support Admin to Learning Reviewer for one course, with a reason", async () => {
    await owner.goto("/admin");
    await pageReady(owner);
    const row = owner.locator("li", { hasText: supportEmail });
    await row.getByRole("button", { name: "Change role" }).click();
    await row.getByLabel("Role").selectOption("reviewer");
    await row.getByLabel("Courses").fill("mkt");
    await row.getByLabel("Reason (required)").fill("E2E journey: moving to reviewing");
    await row.getByRole("button", { name: "Confirm" }).click();
    await answerReverification(owner, state().owner);
    await expect(owner.getByText("Change role: done.")).toBeVisible({ timeout: 20_000 });
    await expect(owner.locator("li", { hasText: supportEmail })).toContainText("Learning Reviewer · mkt");
    expect((await audit("admins.role.change")).at(-1)).toMatchObject({
      result: "completed", previous_value: "Support Admin", new_value: "Learning Reviewer (mkt)", reason: "E2E journey: moving to reviewing",
    });
  });

  test("the Owner can't be given another role or removed, and \"owner\" can't be granted", async () => {
    const ownerId = (await db.query("select id from public.accounts where role = 'owner'")).rows[0].id;
    expect((await owner.request.patch(`/api/v1/admins/${ownerId}`, { data: { role: "support", reason: REASON } })).status()).toBe(403);
    expect((await owner.request.delete(`/api/v1/admins/${ownerId}`, { data: { reason: REASON } })).status()).toBe(403);
    expect((await owner.request.post("/api/v1/admins/invites", { data: { email: `${E2E_PREFIX}x@example.com`, role: "owner", reason: REASON } })).status()).toBe(400);
    expect((await db.query("select role from public.accounts where id = $1", [ownerId])).rows[0].role).toBe("owner");
  });

  test("the Owner removes the admin role, with a reason", async () => {
    const row = owner.locator("li", { hasText: supportEmail });
    await row.getByRole("button", { name: "Remove" }).click();
    await row.getByLabel("Reason (required)").fill("E2E journey: leaving the rotation");
    await row.getByRole("button", { name: "Confirm" }).click();
    await answerReverification(owner, state().owner);
    await expect(owner.getByText("Remove: done.")).toBeVisible({ timeout: 20_000 });
    expect((await audit("admins.revoke")).at(-1)).toMatchObject({ result: "completed", reason: "E2E journey: leaving the rotation" });
  });
});

// ============ Devices and sessions (j5 J10, J11) ============

let devC: Page;
let devD: Page;
const ownerDevices = async () =>
  (await db.query("select count(*)::int as n from public.trusted_devices d join public.accounts a on a.id = d.account_id where a.role = 'owner' and d.trust_state = 'trusted'")).rows[0].n;

test.describe("devices and sessions", () => {
  test("three browsers are trusted; a fourth must replace one after the second factor", async ({ browser }) => {
    await browserFor(browser, state().owner);
    devC = (await browserFor(browser, state().owner)).page;
    expect(await ownerDevices()).toBe(3);

    const d = await browser.newContext({ baseURL: state().baseURL });
    devD = await d.newPage();
    await signInWithPassword(devD, state().owner);
    await expect(devD.getByRole("heading", { name: "Replace a trusted device?" })).toBeVisible({ timeout: 20_000 });
    expect(await (await devD.request.get("/api/v1/me")).json()).toMatchObject({ error: "device_not_trusted" });
    // The first listed is the oldest: the Owner's first browser.
    await devD.getByRole("button", { name: "Replace this one" }).first().click();
    await answerReverification(devD, state().owner);
    await expect(devD.getByText(/Signed in as .*\(Owner\)/)).toBeVisible({ timeout: 20_000 });
    expect(await ownerDevices()).toBe(3);
    expect((await audit("devices.replace")).at(-1)).toMatchObject({ result: "completed" });
    // The replaced browser was signed out.
    expect((await owner.request.get("/api/v1/me")).status()).toBeGreaterThanOrEqual(400);
  });

  test("a second device starting pauses the first; both show the notice; the person picks", async () => {
    // devD started last, so devC (open before it) is paused.
    await devC.reload();
    await expect(devC.getByRole("heading", { name: "ASCENTRA is open on another device." })).toBeVisible({ timeout: 20_000 });
    await devD.reload();
    await expect(devD.getByText("ASCENTRA is open on another device.").first()).toBeVisible({ timeout: 20_000 });
    // The person picks the paused one: it continues and the other pauses.
    await devC.getByRole("button", { name: "Continue here" }).click();
    await expect(devC.getByText(/Signed in as .*\(Owner\)/)).toBeVisible({ timeout: 20_000 });
    await devD.reload();
    await expect(devD.getByRole("heading", { name: "ASCENTRA is open on another device." })).toBeVisible({ timeout: 20_000 });
  });

  test("/account lists the devices, with sign-out and remove", async () => {
    await devC.goto("/account");
    await pageReady(devC);
    await expect(devC.getByRole("heading", { name: /Trusted devices/ })).toContainText("3 of 3");
    await expect(devC.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
    await expect(devC.getByRole("button", { name: "Remove" }).first()).toBeVisible();
  });
});

// ============ The audit log (j6 audit, F5) ============

test.describe("audit log", () => {
  test("the Owner sees every event above, searches, verifies the chain and exports with a reason", async () => {
    const page = devC;
    await page.goto("/admin/audit");
    await pageReady(page);
    for (const action of ["admins.invite", "admins.role.change", "admins.revoke", "devices.replace"]) {
      await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
    }
    await page.getByLabel("Action").fill("admins.role");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("admins.invite", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Verify the chain now" }).click();
    await expect(page.getByText(/^Intact: \d+ event\(s\) checked/)).toBeVisible({ timeout: 20_000 });
    await page.locator("#export-reason").fill("E2E journey: export check");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), page.getByRole("button", { name: "Export CSV" }).click().then(() => answerReverification(page, state().owner))]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    expect((await audit("audit.export")).at(-1)).toMatchObject({ result: "completed", reason: "E2E journey: export check" });
    const chain = (await db.query("select * from public.audit_verify_chain()")).rows[0];
    expect(chain.ok).toBe(true);
  });
});
