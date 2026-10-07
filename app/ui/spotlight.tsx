"use client";

import { useEffect } from "react";

const SURFACES = ".ui-card, .ui-panel, .ui-block, .ui-choice, .ui-rows, .ui-path > li, .ui-tile, .ui-auth__card, .ui-hero";

/**
 * D2b: a soft spotlight that follows the cursor across cards (desktop pointers only; off with reduced motion). It only
 * sets two CSS variables on the card under the pointer; the light itself is the --spotlight background layer.
 */
export function Spotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      if (!last) return;
      const el = (last.target as Element | null)?.closest?.(SURFACES) as HTMLElement | null;
      if (current && current !== el) { current.style.removeProperty("--mx"); current.style.removeProperty("--my"); }
      current = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${last.clientX - r.left}px`);
      el.style.setProperty("--my", `${last.clientY - r.top}px`);
    };
    const onMove = (e: PointerEvent) => { last = e; if (!frame) frame = requestAnimationFrame(paint); };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
