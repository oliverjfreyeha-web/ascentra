import { expect, type Locator, type Page } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { freshTotp } from "./totp";

/**
 * Signs in through ASCENTRA's own sign-in page: "Use password and a second factor", then Clerk's form
 * (email, password, authenticator code). Clerk's testing token only bypasses bot protection.
 */
export async function signInWithPassword(page: Page, u: { email: string; password: string; totpSecret?: string }) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use password and a second factor" }).click();
  await page.locator("input[name=identifier]").fill(u.email);
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.locator("input[name=password]").fill(u.password);
  await page.getByRole("button", { name: /^Continue$/ }).click();
  if (u.totpSecret) {
    const otp = page.locator("input[autocomplete=one-time-code], input[name=code], input[data-otp-input]").first();
    await otp.waitFor({ timeout: 15_000 });
    await otp.click();
    await page.keyboard.type(await freshTotp(u.totpSecret));
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20_000 });
}

/** Waits until the device gate has checked this browser and the page itself is showing. */
export async function pageReady(page: Page) {
  await expect(page.getByText("Checking this device…")).toHaveCount(0, { timeout: 20_000 });
}

/**
 * After a sensitive action: waits until either `done` shows (no check was needed) or Clerk's
 * re-verification dialog opens, and if it opens, answers each step (password, then authenticator code)
 * until it closes. Locator.isVisible() doesn't wait, so every check here waits explicitly.
 */
export async function answerReverification(page: Page, u: { password: string; totpSecret?: string }, done: Locator) {
  const modal = page.locator(".cl-userVerification-root");
  const first = await Promise.race([
    modal.waitFor({ state: "visible", timeout: 20_000 }).then(() => "modal" as const, () => "none" as const),
    done.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => "done" as const, () => "none" as const),
  ]);
  if (first !== "modal") return;

  const password = modal.locator("input[name=password]");
  const otp = modal.locator("input[autocomplete=one-time-code], input[name=code], input[data-otp-input]").first();
  for (let step = 0; step < 3; step++) {
    const next = await Promise.race([
      password.waitFor({ state: "visible", timeout: 15_000 }).then(() => "password" as const, () => "none" as const),
      otp.waitFor({ state: "visible", timeout: 15_000 }).then(() => "otp" as const, () => "none" as const),
      modal.waitFor({ state: "detached", timeout: 15_000 }).then(() => "closed" as const, () => "none" as const),
    ]);
    if (next === "closed" || next === "none") return;
    if (next === "password") {
      await password.fill(u.password);
      await modal.getByRole("button", { name: /^Continue$/ }).click();
      await password.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    } else if (u.totpSecret) {
      await otp.click();
      await page.keyboard.type(await freshTotp(u.totpSecret));
      await otp.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    } else {
      return;
    }
  }
}

/**
 * Records every response from an API path on this page (status, error code and plain reason, never
 * headers or tokens), so a failed step can say what the server answered.
 */
export function watchApi(page: Page, pathPart: string) {
  const seen: { method: string; status: number; error?: string; reason?: string }[] = [];
  page.on("response", async (r) => {
    if (!r.url().includes(pathPart)) return;
    const body = (await r.json().catch(() => ({}))) as { error?: string; reason?: string; clerk_error?: { reason?: string } };
    seen.push({ method: r.request().method(), status: r.status(), error: body.error ?? body.clerk_error?.reason, reason: body.reason });
  });
  return { seen, describe: () => `server answered: ${JSON.stringify(seen)}` };
}
