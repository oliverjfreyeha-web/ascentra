import { expect, type Page } from "@playwright/test";
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
 * If Clerk asks to re-verify (a sensitive action more than 10 minutes after the last check), answers it
 * with the password and authenticator code. Otherwise does nothing.
 */
export async function answerReverification(page: Page, u: { password: string; totpSecret?: string }) {
  const dialog = page.locator(".cl-userVerification-root, [role=dialog]:has-text('Verification required')").first();
  if (!(await dialog.isVisible({ timeout: 3_000 }).catch(() => false))) return;
  const password = dialog.locator("input[name=password]");
  if (await password.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await password.fill(u.password);
    await dialog.getByRole("button", { name: /^Continue$/ }).click();
  }
  const otp = dialog.locator("input[autocomplete=one-time-code], input[name=code]").first();
  if (u.totpSecret && (await otp.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await otp.click();
    await page.keyboard.type(await freshTotp(u.totpSecret));
  }
}
