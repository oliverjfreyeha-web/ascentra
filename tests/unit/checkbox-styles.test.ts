/**
 * R1: the checkbox that didn't look checked. The shared checkbox and radio styles in app/globals.css draw the native
 * control themselves (appearance: none). Every state rule (checked, hover, focus, disabled) must be at least as
 * specific as the base rule it changes, or the base rule wins and the state never shows. The bug was a bare
 * :not(.ui-check input) on the base rule, which made it more specific than input[type="checkbox"]:checked.
 * The real rendering (both glass materials, Space key, focus ring) is checked in a browser: e2e/components.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Spec = [number, number, number];

/** Selector specificity (Selectors 4): :where() adds nothing; :not()/:is()/:has() add their most specific argument. */
export function specificity(selector: string): Spec {
  let s = selector.trim();
  const out: Spec = [0, 0, 0];
  const add = (x: Spec) => { out[0] += x[0]; out[1] += x[1]; out[2] += x[2]; };
  // Functional pseudo-classes, innermost first.
  const fn = /:(where|not|is|has)\(([^()]*)\)/;
  for (let m = s.match(fn); m; m = s.match(fn)) {
    if (m[1] !== "where") {
      const best = m[2].split(",").map(specificity).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
      add(best);
    }
    s = s.replace(m[0], " ");
  }
  out[0] += (s.match(/#[\w-]+/g) ?? []).length;
  out[1] += (s.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  out[2] += (s.match(/::[\w-]+/g) ?? []).length;
  out[2] += (s.replace(/\[[^\]]+\]/g, "").replace(/[.#:]{1,2}[\w-]+/g, "").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return out;
}
const cmp = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Every selector in a stylesheet with the declarations it sets. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of m[1].split(/,(?![^(]*\))/)) out.push({ selector: sel.trim(), body: m[2] });
  }
  return out;
}

describe("specificity()", () => {
  it("counts the way browsers do", () => {
    expect(specificity('input[type="checkbox"]')).toEqual([0, 1, 1]);
    expect(specificity('input[type="checkbox"]:checked')).toEqual([0, 2, 1]);
    expect(specificity('input[type="checkbox"]:not(.ui-check input)')).toEqual([0, 2, 2]);
    expect(specificity('input[type="checkbox"]:not(:where(.ui-check input))')).toEqual([0, 1, 1]);
    expect(specificity('input[type="checkbox"]:checked::after')).toEqual([0, 2, 2]);
  });
});

describe("the shared checkbox and radio styles (app/globals.css)", () => {
  const all = rules(readFileSync("app/globals.css", "utf8"));
  const forType = (type: "checkbox" | "radio") => all.filter((r) => r.selector.startsWith(`input[type="${type}"]`));

  for (const type of ["checkbox", "radio"] as const) {
    it(`${type}: every state rule outweighs the base rule it changes`, () => {
      const list = forType(type);
      const base = list.filter((r) => !/:(checked|hover|focus-visible|disabled|active)/.test(r.selector));
      const states = list.filter((r) => /:(checked|hover|focus-visible|disabled)/.test(r.selector));
      expect(base.length).toBeGreaterThan(0);
      expect(states.some((r) => r.selector.includes(":checked") && r.selector.endsWith("::after"))).toBe(true);
      for (const st of states) {
        const pseudo = st.selector.endsWith("::after");
        for (const b of base.filter((x) => x.selector.endsWith("::after") === pseudo)) {
          expect(cmp(specificity(st.selector), specificity(b.selector)), `${st.selector} vs ${b.selector}`).toBeGreaterThanOrEqual(0);
        }
      }
    });
  }

  it("draws a visible checked state: an accent fill and a tick that scales in", () => {
    const checked = all.find((r) => r.selector === 'input[type="checkbox"]:checked')!;
    expect(checked.body).toMatch(/background:\s*var\(--color-accent\)/);
    expect(all.find((r) => r.selector === 'input[type="checkbox"]:checked::after')!.body).toMatch(/transform:\s*scale\(1\)/);
    expect(all.find((r) => r.selector === 'input[type="checkbox"]:focus-visible')!.body).toMatch(/outline:\s*2px solid/);
  });
});
