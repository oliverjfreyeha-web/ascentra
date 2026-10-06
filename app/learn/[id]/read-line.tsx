"use client";

import { useEffect, useRef } from "react";

/**
 * D2: a quiet reading-progress line at the very top of the lesson: how far down the page you are. Decoration only
 * (hidden from assistive tech); nothing is saved or counted.
 */
export function ReadLine() {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.current?.style.setProperty("--read", String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <div className="ui-readline" aria-hidden="true"><span ref={bar} /></div>;
}
