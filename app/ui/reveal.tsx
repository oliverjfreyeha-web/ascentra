"use client";

import { useEffect } from "react";

/**
 * D2b: scroll reveals (transitions.dev "texts reveal": a short rise and fade, staggered, easing out). Content is visible
 * without this script; it only hides what is below the fold once it runs, then shows each piece as it comes into view.
 * Nothing waits on it: clicks and typing work throughout. Off with reduced motion.
 */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.9);
    if (!els.length) return;
    els.forEach((el) => el.setAttribute("data-reveal", "wait"));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).setAttribute("data-reveal", "shown");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    // Keyboard users never land on something still hidden.
    const onFocus = (e: FocusEvent) => (e.target as Element | null)?.closest?.('[data-reveal="wait"]')?.setAttribute("data-reveal", "shown");
    document.addEventListener("focusin", onFocus);
    return () => { io.disconnect(); document.removeEventListener("focusin", onFocus); };
  }, []);
  return null;
}
