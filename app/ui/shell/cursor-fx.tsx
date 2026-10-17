"use client";

import { useEffect } from "react";

/** What counts as a card or a button for the cursor glow and the click spark (and nothing else). */
export const FX_TARGETS = "button, .ds-btn, .ds-tilt, .ds-glass:not(.ds-glass--hud), .ui-btn, .ui-card, .ui-tile, .ui-choice, [role='button']";
const MAX_BURSTS = 4;

/**
 * Design rebuild D3 · Cursor glow and click spark, on cards and buttons only; off when html[data-reduced] is "1"
 * (Motion Reduced or Off, the device setting, or a slow device) and for touch and keyboard. The glow element is placed
 * by the one page-wide pointer listener (app/ui/spotlight.tsx); this component renders it and adds the click spark:
 * eight tiny lights that fly out and fade (transform and opacity only), removed after 0.7 s.
 */
export function CursorFx() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const os = window.matchMedia("(prefers-reduced-motion: reduce)");
    let live = 0;
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0 || os.matches || document.documentElement.getAttribute("data-reduced") === "1") return; // keyboard, or motion off
      const t = (e.target as Element | null)?.closest?.(FX_TARGETS) as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled || live >= MAX_BURSTS) return;
      const b = document.createElement("span");
      b.className = "fx-burst";
      b.setAttribute("aria-hidden", "true");
      b.style.left = `${e.clientX}px`;
      b.style.top = `${e.clientY}px`;
      for (let i = 0; i < 8; i++) {
        const p = document.createElement("i"), a = (i / 8) * Math.PI * 2 + 0.3, r = 22 + (i % 3) * 7;
        p.style.setProperty("--dx", `${(Math.cos(a) * r).toFixed(1)}px`);
        p.style.setProperty("--dy", `${(Math.sin(a) * r).toFixed(1)}px`);
        b.appendChild(p);
      }
      document.body.appendChild(b);
      live++;
      window.setTimeout(() => { b.remove(); live--; }, 700);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return <div className="fx-glow" aria-hidden="true" />;
}
