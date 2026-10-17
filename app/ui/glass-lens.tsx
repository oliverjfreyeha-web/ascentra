"use client";

import { useEffect } from "react";
import { createLensController, isChromium, lensParams, wantsLens, type GlassMode, type LensKind } from "./glass/lens-core";

/**
 * D5 · Liquid glass lens. For each glass surface, builds an SVG filter whose displacement map pushes the scene behind
 * the rim inward like the edge of a thick lens, with a slight red/green/blue split. The map is drawn at the device
 * pixel ratio from the element's real size and corner radius, and rebuilt when it resizes (debounced) or the pixel
 * ratio changes. Only with Liquid glass, and only where backdrop-filter accepts SVG filters (feature-detected);
 * everywhere else the glass is clear with the same rim and reflection. Mounted once, in the root layout.
 * Design rebuild D2: the same lens also serves the rebuild's <Glass> (.ds-glass), with the prototype's shape and only in
 * Chromium and outside Lite mode; the rules live in ./glass/lens-core.ts. Frosted removes every filter and inline
 * value; at most MAX_LENSES exist at once; each element's lens follows its nearest data-glass.
 */
const SELECTOR = ":is(.ui-glass, .ui-panel, .ui-auth__card):not(main.ui-admin *)";
const DS_SELECTOR = ".ds-glass:not(.ds-btn)";
const NS = "http://www.w3.org/2000/svg";

export function lensSupported(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "url(#a)");
}

/** The refraction map: red/green encode the push direction, strongest at the rim, nothing in the middle. */
export function lensMap(w: number, h: number, radius: number, band: number, dpr: number): string {
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  if (!x) return "";
  const im = x.createImageData(W, H), d = im.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 128; d[i + 3] = 255; }
  const hx = w / 2, hy = h / 2, r = Math.min(radius, hx, hy), edge = Math.ceil((band + 1) * dpr);
  const px1 = (py: number, px: number) => {
    const cx = (px + 0.5) / dpr, cy = (py + 0.5) / dpr;
    const dx = cx - hx, dy = cy - hy, qx = Math.abs(dx) - (hx - r), qy = Math.abs(dy) - (hy - r);
    let ox: number, oy: number, sdf: number;
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); sdf = l - r; ox = (Math.sign(dx) * qx) / l; oy = (Math.sign(dy) * qy) / l; }
    else if (qx > qy) { sdf = qx - r; ox = Math.sign(dx); oy = 0; }
    else { sdf = qy - r; ox = 0; oy = Math.sign(dy); }
    const t = Math.max(0, Math.min(1, 1 - -sdf / band));
    let m = t * t * (3 - 2 * t);
    m = m * m * (3 - 2 * m) * 0.85 + m * 0.15;
    const i = (py * W + px) * 4;
    d[i] = 128 - 127 * m * ox; d[i + 1] = 128 - 127 * m * oy;
  };
  // Only the rim band changes; the middle stays neutral (128), so skip it.
  for (let py = 0; py < H; py++) {
    const nearY = py < edge || py >= H - edge;
    if (nearY) { for (let px = 0; px < W; px++) px1(py, px); continue; }
    for (let px = 0; px < Math.min(edge, W); px++) px1(py, px);
    for (let px = Math.max(edge, W - edge); px < W; px++) px1(py, px);
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL();
}

export function GlassLens() {
  useEffect(() => {
    const svgBackdrop = lensSupported();
    if (!svgBackdrop) return;
    const chromium = isChromium(navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } });
    const root = document.documentElement;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
    const defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    document.body.appendChild(svg);
    const sizes = new WeakMap<Element, string>();
    let timer = 0, resizeTimer = 0;

    const build = (el: HTMLElement, id: string, kind: LensKind): boolean => {
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (!w || !h) return false;
      const dpr = window.devicePixelRatio || 1;
      const key = `${kind}:${w}x${h}@${dpr}`;
      if (sizes.get(el) === key && document.getElementById(id)) return true;
      sizes.set(el, key);
      document.getElementById(id)?.remove();
      const p = lensParams(kind, w, h, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16, window.innerWidth < 700);
      const f = document.createElementNS(NS, "filter");
      f.id = id;
      for (const [k, v] of [["filterUnits", "userSpaceOnUse"], ["x", "0"], ["y", "0"], ["width", String(w)], ["height", String(h)], ["color-interpolation-filters", "sRGB"]]) f.setAttribute(k, v);
      const img = document.createElementNS(NS, "feImage");
      for (const [k, v] of [["href", lensMap(w, h, p.radius, p.band, dpr)], ["x", "0"], ["y", "0"], ["width", String(w)], ["height", String(h)], ["result", "m"], ["preserveAspectRatio", "none"]]) img.setAttribute(k, v);
      f.appendChild(img);
      // Red, green and blue bend by slightly different amounts: a faint colour split at the rim.
      const channels = [["r", "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"], ["g", "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"], ["b", "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"]] as const;
      channels.forEach(([c, m], i) => {
        const dm = document.createElementNS(NS, "feDisplacementMap");
        for (const [a, v] of [["in", "SourceGraphic"], ["in2", "m"], ["scale", (p.scale * p.dispersion[i]).toFixed(1)], ["xChannelSelector", "R"], ["yChannelSelector", "G"], ["result", `d${c}`]]) dm.setAttribute(a, v);
        const cm = document.createElementNS(NS, "feColorMatrix");
        for (const [a, v] of [["in", `d${c}`], ["type", "matrix"], ["values", m], ["result", `c${c}`]]) cm.setAttribute(a, v);
        f.append(dm, cm);
      });
      const b1 = document.createElementNS(NS, "feBlend");
      for (const [a, v] of [["in", "cr"], ["in2", "cg"], ["mode", "screen"], ["result", "rg"]]) b1.setAttribute(a, v);
      const b2 = document.createElementNS(NS, "feBlend");
      for (const [a, v] of [["in", "rg"], ["in2", "cb"], ["mode", "screen"]]) b2.setAttribute(a, v);
      f.append(b1, b2);
      defs.appendChild(f);
      return true;
    };

    const ro = new ResizeObserver((entries) => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => entries.forEach((e) => lenses.resize(e.target as HTMLElement)), 120);
    });
    const lenses = createLensController<HTMLElement>({
      build,
      removeFilter: (id) => document.getElementById(id)?.remove(),
      mark: (el, id) => {
        if (id) { el.style.setProperty("--lg", `url(#${id})`); el.setAttribute("data-lens", ""); }
        else { el.style.removeProperty("--lg"); el.removeAttribute("data-lens"); sizes.delete(el); }
      },
      observe: (el) => ro.observe(el),
      unobserve: (el) => ro.unobserve(el),
    });

    const scan = () => {
      const lite = root.getAttribute("data-lite") === "1";
      const motionAuto = root.hasAttribute("data-motion-auto");
      const wanted: { el: HTMLElement; kind: LensKind }[] = [];
      document.querySelectorAll<HTMLElement>(`${SELECTOR}, ${DS_SELECTOR}`).forEach((el) => {
        const kind: LensKind = el.matches(DS_SELECTOR) ? "ds" : "ui";
        const glass: GlassMode = el.closest("[data-glass]")?.getAttribute("data-glass") === "liquid" ? "liquid" : "frost";
        if (wantsLens(kind, { glass, lite, chromium, svgBackdrop, motionAuto })) wanted.push({ el, kind });
      });
      lenses.sync(wanted);
    };
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(scan, 120); };
    const rebuildAll = () => { document.querySelectorAll(`${SELECTOR}, ${DS_SELECTOR}`).forEach((el) => sizes.delete(el)); scan(); };
    scan();
    document.fonts?.ready.then(rebuildAll).catch(() => {});
    // New glass on the page, and any change of glass, Lite or motion (on <html> or on a region of the page).
    const mo = new MutationObserver((records) => {
      if (records.some((r) => r.type === "attributes" && r.target === root)) scan(); else later();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-glass"] });
    mo.observe(root, { attributes: true, attributeFilter: ["data-glass", "data-lite", "data-motion-auto"] });
    // Device pixel ratio changes (zoom, moving to another screen): rebuild every map at the new ratio.
    let dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDpr = () => { dprQuery.removeEventListener("change", onDpr); dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); dprQuery.addEventListener("change", onDpr); rebuildAll(); };
    dprQuery.addEventListener("change", onDpr);
    window.addEventListener("ascentra:prefs", rebuildAll);
    return () => {
      ro.disconnect(); mo.disconnect();
      dprQuery.removeEventListener("change", onDpr);
      window.removeEventListener("ascentra:prefs", rebuildAll);
      window.clearTimeout(timer); window.clearTimeout(resizeTimer);
      lenses.clear();
      svg.remove();
    };
  }, []);
  return null;
}
