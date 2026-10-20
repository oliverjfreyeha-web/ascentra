/**
 * Design rebuild D2 · The liquid lens's rules, without the DOM, so they can be tested. app/ui/glass-lens.tsx (mounted
 * once in the root layout) supplies the browser parts: drawing the displacement map, the SVG filters, ResizeObserver.
 *
 * Two kinds of glass get a lens:
 *   "ui"  the D4/D5 surfaces (.ui-glass, .ui-panel, .ui-auth__card): unchanged rules and numbers.
 *   "ds"  the rebuild's <Glass> (.ds-glass): the prototype's lens (design-reference/src/Lens.js) — a ~26px convex
 *         bezel, scale ~32, red/green/blue bent by 1 / .96 / .92 — Chromium only, never in Lite mode.
 * Frosted (the default) never has a lens: switching to it removes every filter and every inline value.
 * At most MAX_LENSES filters exist at once (each one is a full-size image); the rest keep the plain fallback glass.
 */

export const MAX_LENSES = 24;
export type LensKind = "ui" | "ds";
export type GlassMode = "liquid" | "frost";

type NavLike = { userAgentData?: { brands?: { brand: string }[] }; userAgent?: string } | undefined;

/** Chromium (Chrome, Edge, Opera, Brave …) on desktop or Android. Not Safari or Firefox, and not iOS (always WebKit). */
export function isChromium(nav: NavLike): boolean {
  if (!nav) return false;
  const brands = nav.userAgentData?.brands;
  if (brands?.length) return brands.some((b) => /Chromium/.test(b.brand));
  const ua = nav.userAgent ?? "";
  return /\bChrome\/\d+/.test(ua) && !/\b(CriOS|FxiOS|EdgiOS|Firefox)\b/.test(ua);
}

/**
 * Whether one element gets a lens. `glass` is the nearest data-glass (an element may override the page's, as the
 * preview does); `svgBackdrop` is CSS.supports("backdrop-filter", "url(#a)").
 */
export function wantsLens(kind: LensKind, env: { glass: GlassMode; lite: boolean; chromium: boolean; svgBackdrop: boolean; motionAuto?: boolean }): boolean {
  if (env.glass !== "liquid" || !env.svgBackdrop) return false;
  if (kind === "ds") return env.chromium && !env.lite;
  return !env.motionAuto; // "ui": the D5 rule (a slow device keeps clear glass)
}

/** The lens shape for an element of this size and corner radius. */
export function lensParams(kind: LensKind, w: number, h: number, radius: number, small: boolean) {
  if (kind === "ds") {
    const band = Math.max(6, Math.min(26, Math.min(w, h) * 0.4));
    return { band, scale: 32, dispersion: [1, 0.96, 0.92] as const, radius: Math.min(radius, w / 2, h / 2) };
  }
  const band = Math.max(6, Math.min(radius, small ? 14 : 22, Math.min(w, h) / 2 - 1));
  return { band, scale: band * 1.55, dispersion: [1, 0.93, 0.86] as const, radius };
}

/** What the controller needs from the page. Real DOM in the app, plain objects in tests. */
export type LensDeps<E> = {
  /** Builds (or rebuilds) the filter for `el` under `id`; returns false when the element has no size yet. */
  build: (el: E, id: string, kind: LensKind) => boolean;
  /** Removes the filter `id` from the page. */
  removeFilter: (id: string) => void;
  /** Sets the element's inline lens value (url(#id)), or removes it (null) together with data-lens. */
  mark: (el: E, id: string | null) => void;
  observe: (el: E) => void;
  unobserve: (el: E) => void;
};

/** Keeps the page's lenses in step with the elements that should have one. */
export function createLensController<E>(deps: LensDeps<E>, max = MAX_LENSES) {
  const live = new Map<E, { id: string; kind: LensKind }>();
  let n = 0;

  const detach = (el: E) => {
    const e = live.get(el);
    if (!e) return;
    live.delete(el);
    deps.unobserve(el);
    deps.removeFilter(e.id);
    deps.mark(el, null);
  };

  return {
    /** `wanted`: every element that should have a lens now, in page order. Anything else loses its lens. */
    sync(wanted: { el: E; kind: LensKind }[]) {
      const keep = new Set<E>();
      for (const { el, kind } of wanted) {
        if (keep.size >= max) break;
        keep.add(el);
        let e = live.get(el);
        if (e && e.kind !== kind) { detach(el); e = undefined; }
        if (!e) {
          e = { id: `ui-lens-${++n}`, kind };
          live.set(el, e);
          deps.observe(el);
        }
        if (deps.build(el, e.id, kind)) deps.mark(el, e.id);
      }
      for (const el of [...live.keys()]) if (!keep.has(el)) detach(el);
    },
    /** Rebuild one element after it resized (only if it still has a lens). */
    resize(el: E) {
      const e = live.get(el);
      if (e && deps.build(el, e.id, e.kind)) deps.mark(el, e.id);
    },
    /** Frosted, unmount: every filter and every inline value goes. */
    clear() { for (const el of [...live.keys()]) detach(el); },
    get size() { return live.size; },
    has(el: E) { return live.has(el); },
  };
}
