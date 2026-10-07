"use client";

import { useEffect } from "react";

/**
 * D2d: a small 3D tilt with a light glare that follows the cursor, on landing cards marked data-tilt. Desktop pointers
 * only, off with reduced motion. It only sets CSS variables; the card stays a normal element (links, focus, text).
 * It also switches the frost texture on once the page has loaded, so the frost map never competes with the hero image.
 */
export function TiltCards() {
  useEffect(() => {
    const root = document.documentElement;
    const frost = () => root.setAttribute("data-frost", "on");
    if (document.readyState === "complete") frost(); else window.addEventListener("load", frost, { once: true });
    return () => { window.removeEventListener("load", frost); root.removeAttribute("data-frost"); };
  }, []);
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = [...document.querySelectorAll<HTMLElement>("[data-tilt]")];
    const cleanups = cards.map((card) => {
      let frame = 0, e: PointerEvent | null = null;
      const paint = () => {
        frame = 0;
        if (!e) return;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--ry", `${((x - 0.5) * 9).toFixed(2)}deg`);
        card.style.setProperty("--rx", `${((0.5 - y) * 7).toFixed(2)}deg`);
        card.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
      };
      const move = (ev: PointerEvent) => { e = ev; if (!frame) frame = requestAnimationFrame(paint); };
      const enter = () => card.setAttribute("data-tilting", "");
      const leave = () => { card.removeAttribute("data-tilting"); ["--rx", "--ry"].forEach((p) => card.style.removeProperty(p)); };
      card.addEventListener("pointermove", move, { passive: true });
      card.addEventListener("pointerenter", enter);
      card.addEventListener("pointerleave", leave);
      return () => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerenter", enter);
        card.removeEventListener("pointerleave", leave);
        if (frame) cancelAnimationFrame(frame);
      };
    });
    return () => cleanups.forEach((c) => c());
  }, []);
  return null;
}
