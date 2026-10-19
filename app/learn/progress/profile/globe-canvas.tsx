"use client";

import { useEffect, useRef } from "react";
import createGlobe from "cobe";

/** Theme colours for the globe (cobe takes 0..1 RGB). Iris: cool blue-violet; Mono: graphite with a warm glow. */
const COLORS = {
  iris: { base: [0.22, 0.24, 0.48], glow: [0.42, 0.46, 1], marker: [0.65, 0.78, 1] },
  mono: { base: [0.3, 0.3, 0.32], glow: [1, 0.86, 0.68], marker: [1, 0.9, 0.75] },
} as const;

/**
 * Design rebuild D5 · The progress globe's WebGL part (cobe, MIT; no textures, no images). Loaded only by
 * next/dynamic with ssr: false from ./globe-widget.tsx, so it is its own chunk and never on the server. Decorative:
 * the progress it stands for is written beside it. Turns slowly while motion is on; still when Reduced or Off; paused
 * while hidden or off screen; destroyed on unmount.
 */
export default function GlobeCanvas({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const root = document.documentElement;
    const theme = root.getAttribute("data-theme") === "mono" ? "mono" : "iris";
    const still = () => root.getAttribute("data-reduced") === "1";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = COLORS[theme];
    let globe: ReturnType<typeof createGlobe> | null = null;
    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr, width: size * dpr, height: size * dpr, phi: 0.6, theta: 0.28, dark: 1, diffuse: 1.2,
        mapSamples: 12000, mapBrightness: 5.5, baseColor: [...c.base], markerColor: [...c.marker], glowColor: [...c.glow], markers: [], opacity: 0.92,
      });
    } catch { return; } // no WebGL: the poster behind stays
    canvas.setAttribute("data-on", "");
    let phi = 0.6, frame = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (still() || !visible || document.hidden) return;
      phi += 0.0035;
      globe?.update({ phi });
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); io.disconnect(); globe?.destroy(); };
  }, [size]);
  return <canvas ref={ref} className="pf-globe__canvas" width={size} height={size} style={{ width: size, height: size }} aria-hidden="true" />;
}
