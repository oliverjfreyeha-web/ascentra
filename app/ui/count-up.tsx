"use client";

import { useEffect, useRef, useState } from "react";

/**
 * D3 · A number that counts up once when it scrolls into view (about 0.6 s, easing out). Assistive technology reads the
 * real value at once; the counting copy is hidden from it. With reduced motion, the number simply shows.
 */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || value <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    let frame = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 600);
        setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
        if (k < 1) frame = requestAnimationFrame(step);
      };
      setShown(0);
      frame = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);
  return <span className="ui-count"><span ref={ref} aria-hidden="true">{shown}</span><span className="sr-only">{value}</span></span>;
}
