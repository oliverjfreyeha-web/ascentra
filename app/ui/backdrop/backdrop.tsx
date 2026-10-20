"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncReduced } from "../../env/prefs";
import "./backdrop.css";

/** sessionStorage key: this tab found the device slow (kept from D5, app/env/env-root.tsx, so the rule is unchanged). */
export const AUTO_KEY = "ascentra.motionAuto";

function lowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (navigator.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || !!nav.connection?.saveData;
}

/** Dust motes: fixed positions and timings (no randomness, so server and browser render the same). */
const DUST = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  d: `${14 + ((i * 7) % 16)}s`,
  w: `${-(i * 3.1).toFixed(1)}s`,
  s: `${2 + (i % 3)}px`,
  x: `${((i % 5) - 2) * 14}px`,
}));

/**
 * Design rebuild D3 · The one backdrop behind every page (Owner decision 1: Iris and Mono replace the five scenes).
 * Fixed, behind the content, decorative only (aria-hidden, no pointer events), drawn in CSS: soft orbs, rising dust, a
 * vignette, and faint floor lines in Iris; in Mono, black to graphite with one warm-white light (core, champagne and
 * amber falloff, rays, bloom) about 68% across and 13vh down. The orbs lean slightly toward the pointer (set by the one
 * page-wide pointer listener, app/ui/spotlight.tsx). Motion Reduced or Off, the device setting, or a slow device: no
 * drift, no dust, no parallax. Lite mode: fewer layers. Not on admin screens, which stay plain (as in D5).
 * It also keeps the two motion attributes the D5 wallpaper used to keep: data-motion-auto (a slow device) and
 * data-reduced (when the device's reduced-motion setting changes). The D5 wallpaper code (app/env) is no longer loaded.
 */
export function Backdrop() {
  const path = usePathname() ?? "/";
  useEffect(() => {
    const root = document.documentElement;
    let auto: string | null = null;
    try { auto = sessionStorage.getItem(AUTO_KEY); } catch { /* storage blocked */ }
    if (!auto && lowPower()) auto = "device";
    if (auto) root.setAttribute("data-motion-auto", "simple"); else root.removeAttribute("data-motion-auto");
    syncReduced();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", syncReduced);
    return () => mq.removeEventListener("change", syncReduced);
  }, []);
  if (path.startsWith("/admin")) return null;
  return (
    <div className="bd" aria-hidden="true">
      <div className="bd__wall" />
      <div className="bd__orbs">
        <i className="bd__orb bd__orb--1" />
        <i className="bd__orb bd__orb--2" />
        <i className="bd__orb bd__orb--3" />
      </div>
      <div className="bd__light">
        <i className="bd__bloom" />
        <i className="bd__rays" />
        <i className="bd__falloff" />
        <i className="bd__core" />
      </div>
      <div className="bd__floor"><i /></div>
      <div className="bd__dust">
        {DUST.map((p, i) => (
          <i key={i} style={{ left: p.left, ["--d" as string]: p.d, ["--w" as string]: p.w, ["--s" as string]: p.s, ["--x" as string]: p.x }} />
        ))}
      </div>
      <div className="bd__vignette" />
    </div>
  );
}
