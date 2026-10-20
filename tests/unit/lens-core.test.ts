/**
 * Design rebuild D2 · The liquid lens's attach/clear rules (app/ui/glass/lens-core.ts) and the pointer maths
 * (app/ui/glass/pointer.ts). The real-browser side is in e2e/components/design-primitives.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { createLensController, isChromium, lensParams, MAX_LENSES, wantsLens, type LensDeps } from "@/app/ui/glass/lens-core";
import { pointerVars } from "@/app/ui/glass/pointer";

type El = { name: string; w: number };
function fakePage() {
  const filters = new Set<string>();
  const marks = new Map<El, string>();
  const observed = new Set<El>();
  let builds = 0;
  const deps: LensDeps<El> = {
    build: (el, id) => { builds++; if (!el.w) return false; filters.add(id); return true; },
    removeFilter: (id) => { filters.delete(id); },
    mark: (el, id) => { if (id) marks.set(el, id); else marks.delete(el); },
    observe: (el) => { observed.add(el); },
    unobserve: (el) => { observed.delete(el); },
  };
  return { deps, filters, marks, observed, builds: () => builds };
}
const els = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `g${i}`, w: 200 }));

describe("D2 · lens controller", () => {
  it("attaches one filter, one mark and one observer per wanted element", () => {
    const p = fakePage(), c = createLensController(p.deps);
    const [a, b] = els(2);
    c.sync([{ el: a, kind: "ds" }, { el: b, kind: "ui" }]);
    expect(p.filters.size).toBe(2);
    expect(p.marks.get(a)).toMatch(/^ui-lens-\d+$/);
    expect(p.observed).toEqual(new Set([a, b]));
    expect(c.size).toBe(2);
  });

  it("clear() (Frosted, unmount) removes every filter, mark and observer", () => {
    const p = fakePage(), c = createLensController(p.deps);
    c.sync(els(5).map((el) => ({ el, kind: "ds" as const })));
    c.clear();
    expect(p.filters.size).toBe(0);
    expect(p.marks.size).toBe(0);
    expect(p.observed.size).toBe(0);
    expect(c.size).toBe(0);
  });

  it("an element no longer wanted loses its lens; a new one gets one; a kept one keeps its id", () => {
    const p = fakePage(), c = createLensController(p.deps);
    const [a, b, d] = els(3);
    c.sync([{ el: a, kind: "ds" }, { el: b, kind: "ds" }]);
    const idA = p.marks.get(a);
    c.sync([{ el: a, kind: "ds" }, { el: d, kind: "ds" }]);
    expect(p.marks.get(a)).toBe(idA);
    expect(p.marks.has(b)).toBe(false);
    expect(p.marks.has(d)).toBe(true);
    expect(p.filters.size).toBe(2);
    expect(p.observed.has(b)).toBe(false);
  });

  it("never more than the maximum; the rest are left alone", () => {
    const p = fakePage(), c = createLensController(p.deps);
    const list = els(MAX_LENSES + 10);
    c.sync(list.map((el) => ({ el, kind: "ds" as const })));
    expect(p.filters.size).toBe(MAX_LENSES);
    expect(c.has(list[MAX_LENSES - 1])).toBe(true);
    expect(c.has(list[MAX_LENSES])).toBe(false);
    expect(createLensController(fakePage().deps, 3).size).toBe(0);
  });

  it("an element with no size yet is watched but not marked until it has one", () => {
    const p = fakePage(), c = createLensController(p.deps);
    const el = { name: "empty", w: 0 };
    c.sync([{ el, kind: "ds" }]);
    expect(p.marks.has(el)).toBe(false);
    expect(p.observed.has(el)).toBe(true);
    el.w = 300;
    c.resize(el);
    expect(p.marks.has(el)).toBe(true);
  });

  it("changing kind rebuilds the lens under a new id", () => {
    const p = fakePage(), c = createLensController(p.deps);
    const [a] = els(1);
    c.sync([{ el: a, kind: "ui" }]);
    const first = p.marks.get(a);
    c.sync([{ el: a, kind: "ds" }]);
    expect(p.marks.get(a)).not.toBe(first);
    expect(p.filters.size).toBe(1);
  });
});

describe("D2 · who gets a lens", () => {
  const env = { glass: "liquid" as const, lite: false, chromium: true, svgBackdrop: true };
  it("the rebuild's glass: Liquid, Chromium, not Lite, and SVG backdrop filters", () => {
    expect(wantsLens("ds", env)).toBe(true);
    expect(wantsLens("ds", { ...env, glass: "frost" })).toBe(false);
    expect(wantsLens("ds", { ...env, chromium: false })).toBe(false);
    expect(wantsLens("ds", { ...env, lite: true })).toBe(false);
    expect(wantsLens("ds", { ...env, svgBackdrop: false })).toBe(false);
  });
  it("the D5 surfaces keep their rules (no Chromium check, off on a slow device)", () => {
    expect(wantsLens("ui", { ...env, chromium: false })).toBe(true);
    expect(wantsLens("ui", { ...env, motionAuto: true })).toBe(false);
    expect(wantsLens("ui", { ...env, glass: "frost" })).toBe(false);
  });
  it("detects Chromium from client hints or the user agent; never Safari, Firefox or iOS", () => {
    expect(isChromium({ userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] } })).toBe(true);
    expect(isChromium({ userAgentData: { brands: [{ brand: "Not A;Brand" }] } })).toBe(false);
    expect(isChromium({ userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" })).toBe(true);
    expect(isChromium({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" })).toBe(false);
    expect(isChromium({ userAgent: "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0" })).toBe(false);
    expect(isChromium({ userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1" })).toBe(false);
    expect(isChromium(undefined)).toBe(false);
  });
  it("the rebuild's lens shape follows the prototype: ~26px bezel, scale 32, dispersion 1/.96/.92", () => {
    expect(lensParams("ds", 400, 300, 24, false)).toEqual({ band: 26, scale: 32, dispersion: [1, 0.96, 0.92], radius: 24 });
    expect(lensParams("ds", 40, 40, 30, false).band).toBe(16);
    expect(lensParams("ui", 400, 300, 16, false).band).toBe(16);
  });
});

describe("D2 · pointer values", () => {
  const box = { left: 100, top: 100, width: 200, height: 100 };
  it("position inside the box, rim angle toward the pointer, tilt from -1 to 1", () => {
    expect(pointerVars(box, 200, 150)).toMatchObject({ x: 100, y: 50, tx: 0, ty: 0 });
    expect(pointerVars(box, 200, 100).angle).toBe(0);   // straight up
    expect(pointerVars(box, 300, 150).angle).toBe(90);  // right
    expect(pointerVars(box, 200, 200).angle).toBe(180); // down
    expect(pointerVars(box, 100, 150).angle).toBe(270); // left
    expect(pointerVars(box, 300, 200)).toMatchObject({ tx: 1, ty: 1 });
    expect(pointerVars(box, 900, -50)).toMatchObject({ tx: 1, ty: -1 });
  });
});
