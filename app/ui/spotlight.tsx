"use client";

import { useEffect } from "react";
import { pointerVars } from "./glass/pointer";

const SURFACES = ".ui-card, .ui-panel, .ui-block, .ui-choice, .ui-rows, .ui-path > li, .ui-tile, .ui-auth__card, .ui-hero";
/** Design rebuild D2: the rebuild's surfaces that read the pointer (glass rim and gloss, button highlight, tilt). */
const DS_SURFACES = [".ds-glass", ".ds-btn--primary", ".ds-tilt"] as const;

/**
 * D2b: a soft spotlight that follows the cursor across cards (desktop pointers only; off with reduced motion). It only
 * sets two CSS variables on the card under the pointer; the light itself is the --spotlight background layer.
 * Design rebuild D2: the same single listener (one for the whole page, never one per panel) also feeds the rebuild's
 * glass (--mx, --my, and the rim angle --ds-ang), the primary button's highlight, and the tilt of clickable tiles and
 * section cards (--tx, --ty, -1..1). Nothing is set while html[data-reduced] is "1".
 */
export function Spotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let current: HTMLElement | null = null;
    let dsCurrent = new Set<HTMLElement>();
    let frame = 0;
    let last: PointerEvent | null = null;
    const clearDs = (el: HTMLElement) => { for (const p of ["--mx", "--my", "--ds-ang", "--tx", "--ty"]) el.style.removeProperty(p); };
    const paint = () => {
      frame = 0;
      if (!last) return;
      const target = last.target as Element | null;
      const el = target?.closest?.(SURFACES) as HTMLElement | null;
      if (current && current !== el) { current.style.removeProperty("--mx"); current.style.removeProperty("--my"); }
      current = el;
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${last.clientX - r.left}px`);
        el.style.setProperty("--my", `${last.clientY - r.top}px`);
      }
      // The rebuild's surfaces: the nearest of each kind under the pointer (a button inside a glass panel gets both).
      const next = new Set<HTMLElement>();
      if (root.getAttribute("data-reduced") !== "1") {
        for (const sel of DS_SURFACES) {
          const hit = target?.closest?.(sel) as HTMLElement | null;
          if (hit) next.add(hit);
        }
      }
      for (const old of dsCurrent) if (!next.has(old)) clearDs(old);
      dsCurrent = next;
      for (const hit of next) {
        const v = pointerVars(hit.getBoundingClientRect(), last.clientX, last.clientY);
        hit.style.setProperty("--mx", `${v.x}px`);
        hit.style.setProperty("--my", `${v.y}px`);
        if (hit.matches(".ds-glass")) hit.style.setProperty("--ds-ang", `${v.angle}deg`);
        if (hit.matches(".ds-tilt") && !hit.matches(".ds-glass--hud, .ds-widget")) {
          hit.style.setProperty("--tx", v.tx.toFixed(3));
          hit.style.setProperty("--ty", v.ty.toFixed(3));
        }
      }
    };
    const onMove = (e: PointerEvent) => { last = e; if (!frame) frame = requestAnimationFrame(paint); };
    // Leaving the window: every tilt settles back and the lights return to rest.
    const onLeave = () => { for (const el of dsCurrent) clearDs(el); dsCurrent = new Set(); };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      onLeave();
    };
  }, []);
  return null;
}
