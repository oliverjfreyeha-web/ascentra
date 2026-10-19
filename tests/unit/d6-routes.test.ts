/**
 * Design rebuild D6 · Every remaining route is restyled (main.ds-page) or listed as skipped with a reason; legal, safety,
 * billing, admin, Guardian and sign-in screens are calm (main.ds-page--calm); the new rules are scoped to restyled pages,
 * so a page without the class keeps its old look; calm pages switch off the pointer effects.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pages = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? pages(p) : n === "page.tsx" ? [p] : [];
});
const MAINS = [...pages("app"), "app/error.tsx", "app/not-found.tsx", "app/device-gate.tsx"];
// Internal showcases of the old components and the design preview: restyling them would misrepresent what they show.
const SKIPPED = ["app/admin/style-guide/page.tsx", "app/dev/course-ui/page.tsx", "app/dev/design/page.tsx"];
const CALM = /^app\/(admin\/|account\/|guardian\/|pro\/|sign-in\/|sign-up\/|welcome\/|not-available\/|not-open\/|credits\/|error\.tsx|not-found\.tsx|device-gate\.tsx)/;
// Splits a selector list on its top-level commas (not those inside :is(), :not() or :has()).
const splitList = (list: string) => {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  return [...out, cur];
};
const mainsOf = (f: string) => [...readFileSync(f, "utf8").matchAll(/<main(?: className="([^"]*)")?/g)].map((m) => m[1] ?? "");

describe("D6 · every route is restyled or skipped with a reason", () => {
  it("each page's <main> carries ds-page, except the listed internal showcases", () => {
    for (const f of MAINS) {
      const classes = mainsOf(f);
      if (SKIPPED.includes(f)) { expect(classes.every((c) => !c.includes("ds-page")), f).toBe(true); continue; }
      if (f === "app/dev/design/page.tsx") continue;
      expect(classes.length, f).toBeGreaterThan(0);
      for (const c of classes) expect(c.split(" "), f).toContain("ds-page");
    }
  });
  it("admin, billing, safety, audit, Guardian, sign-in, onboarding, legal and state pages are calm; learner pages are not", () => {
    for (const f of MAINS.filter((x) => !SKIPPED.includes(x) && x !== "app/learn/page.tsx" && x !== "app/learn/progress/page.tsx" && x !== "app/page.tsx")) {
      for (const c of mainsOf(f)) expect(c.split(" ").includes("ds-page--calm"), f).toBe(CALM.test(f));
    }
  });
});

describe("D6 · the new rules are scoped and the calm pages stay still", () => {
  const css = readFileSync("app/styles/pages.css", "utf8");
  const d6 = css.slice(css.lastIndexOf("/*", css.indexOf("Design rebuild D6"))).replace(/\/\*[\s\S]*?\*\//g, "");
  it("every D6 selector targets a restyled page (main.ds-page), never the whole app", () => {
    const selectors = [...d6.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@media"));
    expect(selectors.length).toBeGreaterThan(30);
    for (const group of selectors) for (const s of splitList(group)) expect(s.trim(), s).toMatch(/^(main\.ds-page|:root(:not\()?(\[data-reduced="1"\]\)?)? main\.ds-page|:root:has\(main\.ds-page)/);
  });
  it("calm pages: no tilt, no pointer light, no reveal, no gloss or drift, no backdrop motion, no glow; the primary stays still", () => {
    expect(d6).toMatch(/main\.ds-page--calm \{ --tilt-max: 0deg; --spotlight: linear-gradient\(transparent, transparent\); \}/);
    expect(d6).toMatch(/main\.ds-page--calm \[data-reveal\] \{ opacity: 1 !important; transform: none !important; \}/);
    expect(d6).toMatch(/:root:has\(main\.ds-page--calm\) :is\(\.bd__orb, \.bd__dust i, \.bd__rays, \.bd__core\) \{ animation: none !important; \}/);
    expect(d6).toMatch(/:root:has\(main\.ds-page--calm\) \.fx-glow \{ display: none; \}/);
    expect(d6).toMatch(/main\.ds-page:not\(\.landing\):not\(\.ds-page--calm\) :is\(\.ui-btn--primary, button\.primary\) \{ animation: ds-irid/);
  });
  it("the one pointer listener and the click spark skip calm pages", () => {
    expect(readFileSync("app/ui/shell/cursor-fx.tsx", "utf8")).toMatch(/isCalmPage = \(\) => !!document\.querySelector\("main\.ds-page--calm"\)/);
    const spot = readFileSync("app/ui/spotlight.tsx", "utf8");
    expect(spot).toMatch(/const calm = isCalmPage\(\);/);
    expect(spot).toMatch(/const moving = root\.getAttribute\("data-reduced"\) !== "1" && !calm;/);
  });
  it("the shared entrance follows the Motion setting on restyled pages", () => {
    expect(d6).toMatch(/:root\[data-reduced="1"\] main\.ds-page:not\(\.landing\) \{ animation: none; \}/);
  });
});
