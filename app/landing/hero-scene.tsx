"use client";

import { useEffect, useRef } from "react";

/**
 * D2d: decides whether the hero gets its live 3D stage, then loads it after first paint. The still sculpture image is
 * always rendered first and stays the LCP element; the canvas fades in over it once it
 * has run smoothly for about 2 seconds.
 * Still image only when: reduced motion, Save-Data, a screen under 768 px, a low-power device, no WebGL2 (or only a
 * software one), or the first seconds run slowly. Rendering pauses off-screen and in hidden tabs.
 */
export function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current, hero = el?.closest<HTMLElement>(".hero");
    if (!el || !hero || !wants3D()) return;
    let stop: (() => void) | null = null, cancelled = false, idle = 0;
    const off = () => { hero.removeAttribute("data-scene"); stop?.(); stop = null; };
    const start = () => {
      import("./hero-3d")
        .then(({ mountHeroScene }) => {
          if (cancelled || !wants3D()) return;
          stop = mountHeroScene(el, { onReady: () => hero.setAttribute("data-scene", "on"), onFail: () => hero.removeAttribute("data-scene") });
        })
        .catch(() => { /* the still image stays */ });
    };
    const later = () => { idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 2500 }) : window.setTimeout(start, 600); };
    if (document.readyState === "complete") later(); else window.addEventListener("load", later, { once: true });
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    rm.addEventListener("change", off);
    return () => {
      cancelled = true;
      window.removeEventListener("load", later);
      if (idle) (window.cancelIdleCallback ?? window.clearTimeout)(idle);
      rm.removeEventListener("change", off);
      off();
    };
  }, []);
  return <div ref={host} className="hero__stage" aria-hidden="true" />;
}

function wants3D(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.innerWidth < 768) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 8) < 4 || (nav.deviceMemory ?? 8) < 4) return false;
  return typeof WebGL2RenderingContext !== "undefined";
}
