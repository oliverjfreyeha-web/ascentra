"use client";

import { useEffect, useRef } from "react";

/**
 * D2c: the hero's calm depth. On a desktop pointer, the three layers (topographic texture, floating dust, sculpture)
 * shift by different amounts and the sculpture tilts a few degrees toward the cursor; a faint coordinate readout
 * follows it. Phones and reduced motion: nothing moves and the readout is hidden. Decorative only.
 */
export function HeroMotion() {
  const readout = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const hero = readout.current?.closest<HTMLElement>(".hero");
    if (!hero || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    hero.setAttribute("data-motion", "on");
    let frame = 0;
    let e: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      if (!e) return;
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      hero.style.setProperty("--px", (x * 2 - 1).toFixed(3));
      hero.style.setProperty("--py", (y * 2 - 1).toFixed(3));
      if (readout.current) {
        readout.current.style.transform = `translate(${Math.round(e.clientX - r.left + 18)}px, ${Math.round(e.clientY - r.top + 18)}px)`;
        readout.current.textContent = `X ${String(Math.round(x * 1000)).padStart(4, "0")} · Y ${String(Math.round(y * 1000)).padStart(4, "0")}`;
      }
    };
    const move = (ev: PointerEvent) => { e = ev; if (!hero.hasAttribute("data-pointer")) hero.setAttribute("data-pointer", "in"); if (!frame) frame = requestAnimationFrame(paint); };
    const leave = () => { hero.style.setProperty("--px", "0"); hero.style.setProperty("--py", "0"); hero.removeAttribute("data-pointer"); };
    const enter = () => hero.setAttribute("data-pointer", "in");
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", leave);
    hero.addEventListener("pointerenter", enter);
    return () => {
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      hero.removeEventListener("pointerenter", enter);
      if (frame) cancelAnimationFrame(frame);
      hero.removeAttribute("data-motion");
    };
  }, []);
  return <span ref={readout} className="hero__readout" aria-hidden="true" />;
}
