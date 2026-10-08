"use client";

import { useEffect } from "react";

/**
 * D3 · Pauses the ambient animations (the landing's glow drift, dust and breathing call-to-action) while their
 * section is off-screen or the tab is hidden. Animations only: it never touches the ambient sound player.
 */
export function AmbientPause() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-ambient]")];
    if (!els.length || !("IntersectionObserver" in window)) return;
    const seen = new Map<HTMLElement, boolean>();
    const apply = () => els.forEach((el) => el.toggleAttribute("data-paused", document.hidden || !seen.get(el)));
    const io = new IntersectionObserver((entries) => { entries.forEach((e) => seen.set(e.target as HTMLElement, e.isIntersecting)); apply(); });
    els.forEach((el) => io.observe(el));
    document.addEventListener("visibilitychange", apply);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", apply); };
  }, []);
  return null;
}
