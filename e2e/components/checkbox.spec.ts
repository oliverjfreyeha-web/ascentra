/**
 * R1: the "I live in the United States" checkbox showed no checked state. This loads the app's real stylesheets (in
 * the order app/layout.tsx imports them) around the same markup as the date-of-birth step, on the auth card's glass,
 * in both glass materials, and checks what a person sees: the tick appears when checked (click, label click or the
 * Space key), the box changes colour, keyboard focus shows a ring, hover changes the edge, and disabled looks disabled.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css"]
  .map((f) => readFileSync(f, "utf8")).join("\n");

const html = (glass: "liquid" | "frost") => `<!doctype html><html data-glass="${glass}" data-scene="lake" data-motion="off"><head><style>${CSS}</style></head>
<body><main><div class="ui-auth"><div class="ui-auth__card">
  <form class="ui-form">
    <p><label class="ui-consent"><input id="us" type="checkbox"> I live in the United States</label></p>
    <p><label><input id="plain" type="checkbox"> A plain checkbox</label></p>
    <p><label class="ui-pill"><input id="radio" type="radio" name="r"> A radio</label></p>
    <p><label><input id="off" type="checkbox" disabled> Disabled</label></p>
    <button type="submit" class="primary">Continue</button>
  </form>
</div></div></main></body></html>`;

const look = (page: Page, id: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel)!;
  const box = getComputedStyle(el);
  const tick = getComputedStyle(el, "::after");
  return { bg: box.backgroundColor, border: box.borderTopColor, tick: tick.transform, outline: box.outlineStyle + " " + box.outlineWidth, opacity: box.opacity };
}, `#${id}`);
// "none" or a matrix with scale 0 means no visible tick.
const tickShown = (t: string) => t !== "none" && !/^matrix\(0, 0, 0, 0/.test(t);

for (const glass of ["liquid", "frost"] as const) {
  test.describe(`${glass} glass`, () => {
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); await page.setContent(html(glass)); });

    test("clicking the label checks the box and shows the tick and the accent fill", async ({ page }) => {
      const before = await look(page, "us");
      expect(tickShown(before.tick)).toBe(false);
      await page.getByText("I live in the United States").click();
      await expect(page.locator("#us")).toBeChecked();
      await page.waitForTimeout(250);
      const after = await look(page, "us");
      expect(tickShown(after.tick)).toBe(true);
      expect(after.bg).not.toBe(before.bg);
      expect(after.bg).toBe("rgb(160, 189, 219)"); // Frozen
      await page.locator("#plain").click();
      await page.waitForTimeout(250);
      expect(tickShown((await look(page, "plain")).tick)).toBe(true);
    });

    test("keyboard: Tab shows a focus ring; Space toggles it on and off", async ({ page }) => {
      await page.keyboard.press("Tab");
      await expect(page.locator("#us")).toBeFocused();
      expect((await look(page, "us")).outline).toBe("solid 2px");
      await page.keyboard.press("Space");
      await expect(page.locator("#us")).toBeChecked();
      await page.waitForTimeout(250);
      expect(tickShown((await look(page, "us")).tick)).toBe(true);
      await page.keyboard.press("Space");
      await expect(page.locator("#us")).not.toBeChecked();
    });

    test("hover changes the edge; a radio shows its dot; disabled is dimmed", async ({ page }) => {
      const rest = await look(page, "plain");
      await page.locator("#plain").hover();
      await page.waitForTimeout(250);
      expect((await look(page, "plain")).border).not.toBe(rest.border);
      await page.locator("#radio").check();
      await page.waitForTimeout(250);
      expect(tickShown((await look(page, "radio")).tick)).toBe(true);
      expect(Number((await look(page, "off")).opacity)).toBeLessThan(1);
    });
  });
}
