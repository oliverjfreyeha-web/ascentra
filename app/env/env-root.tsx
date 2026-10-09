"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { readPrefs, type Prefs } from "./prefs";
import type { EnvHandle, EnvScene } from "./env-gl";
import "./env.css";

/**
 * D5 · The wallpaper behind every page (mounted once, in the root layout). The scene's photo shows first (a CSS
 * background chosen by html[data-scene] and the window width, so only the active scene's file loads and small windows
 * get the 1080 px file); once the page is idle, the live wallpaper (app/env/env-gl.ts, a separate chunk) takes over.
 * Live motion only with Motion "Full", without reduced motion, and on capable devices; otherwise the photo stays,
 * drifting slowly ("Simple") or still ("Off" and reduced motion). Not on admin screens, which stay plain.
 * The Hall (D4) is the fifth scene: it lives on the landing page, so other pages show the plain background with it.
 */
export const AUTO_KEY = "ascentra.motionAuto";

function lowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (navigator.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || !!nav.connection?.saveData;
}

export function EnvRoot() {
  const path = usePathname() ?? "/";
  if (path.startsWith("/admin")) return null;
  return <EnvLayer landing={path === "/"} />;
}

function EnvLayer({ landing }: { landing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this browser's saved choice after hydration
    setPrefs(readPrefs());
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener("ascentra:prefs", on);
    return () => window.removeEventListener("ascentra:prefs", on);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !prefs) return;
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let auto: string | null = null;
    try { auto = sessionStorage.getItem(AUTO_KEY); } catch { /* storage blocked */ }
    if (!auto && lowPower()) auto = "device";
    if (auto) root.setAttribute("data-motion-auto", "simple"); else root.removeAttribute("data-motion-auto");
    if (prefs.scene === "hall" || prefs.motion !== "full" || reduce || auto) return;
    let handle: EnvHandle | null = null, cancelled = false, idle = 0;
    const start = () => {
      import("./env-gl")
        .then(({ mountEnv }) => {
          if (cancelled) return;
          try {
            handle = mountEnv(el, {
              scene: prefs.scene as EnvScene, reduce,
              onReady: () => el.setAttribute("data-on", ""),
              onSlow: () => {
                try { sessionStorage.setItem(AUTO_KEY, "slow"); } catch { /* storage blocked */ }
                root.setAttribute("data-motion-auto", "simple");
                el.removeAttribute("data-on");
                handle?.destroy(); handle = null;
              },
            });
          } catch { /* no WebGL: the photo stays */ }
        })
        .catch(() => { /* the photo stays */ });
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const later = () => { idle = w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 3000 }) : window.setTimeout(start, 1200); };
    if (document.readyState === "complete") later(); else window.addEventListener("load", later, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", later);
      if (idle) (w.cancelIdleCallback ?? window.clearTimeout)(idle);
      el.removeAttribute("data-on");
      handle?.destroy();
    };
  }, [prefs]);

  return (
    <div className="env" data-landing={landing ? "" : undefined} aria-hidden="true">
      <div className="env__poster" />
      <div className="env__live" ref={host} />
      <div className="env__shade" />
    </div>
  );
}
