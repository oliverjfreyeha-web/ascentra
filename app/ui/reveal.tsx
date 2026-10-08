"use client";

import { useEffect } from "react";

/**
 * D2b/D3: scroll reveals (transitions.dev "texts reveal": a short rise and fade, staggered, easing out). Content is
 * visible without this script; it only hides what is below the fold once it runs, then shows each piece as it comes
 * into view, once (it never hides again). With `selector`, it also picks up matching blocks that arrive later (screens
 * that load their content from the API). Nothing waits on it: clicks and typing work throughout. Off with reduced
 * motion. Never used on the lesson or admin screens.
 */
export function Reveal({ selector }: { selector?: string }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).setAttribute("data-reveal", "shown");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    const seen = new WeakSet<Element>();
    const scan = () => {
      const found = selector ? [...document.querySelectorAll<HTMLElement>(selector)] : [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
      let n = 0;
      for (const el of found) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (el.getBoundingClientRect().top <= window.innerHeight * 0.9) continue; // already in view: never hidden
        el.setAttribute("data-reveal", "wait");
        if (selector) el.style.setProperty("--i", String(n++ % 3));
        io.observe(el);
      }
    };
    scan();
    const mo = selector ? new MutationObserver(scan) : null;
    mo?.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
    // Keyboard users never land on something still hidden.
    const onFocus = (e: FocusEvent) => (e.target as Element | null)?.closest?.('[data-reveal="wait"]')?.setAttribute("data-reveal", "shown");
    document.addEventListener("focusin", onFocus);
    return () => { io.disconnect(); mo?.disconnect(); document.removeEventListener("focusin", onFocus); };
  }, [selector]);
  return null;
}
