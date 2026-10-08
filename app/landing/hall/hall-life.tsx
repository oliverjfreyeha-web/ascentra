"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { cycleT, hallVars, K, PHASE_T, phaseFromQuery, phaseName, type Phase } from "./cycle";
import FIREFLIES from "./fireflies.json";

type Firefly = { s: number[]; big: boolean; x: number; y: number; vx: number; vy: number; ph: number; wob: number; wait: number; fl: number; pulses: number; dur: number };

/**
 * D4 · The Hall, alive. Keeps the sky on the visitor's clock, lets the windows settle after they light up, gives the
 * rooms some life (a light dims, goes off, someone walks past), and draws the fireflies. Everything stops while the
 * Hall is off-screen or the tab is hidden; with reduced motion only the clock-driven sky remains (changing without
 * animation). It never touches the ambient sound player. Also tells the page whether to show Home (signed in) or
 * the Hall: Clerk decides; the inline boot script only guessed from a cookie to avoid a flash.
 */
export function HallLife({ allowQuery }: { allowQuery: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    const landing = document.querySelector<HTMLElement>("[data-landing]");
    if (isSignedIn) landing?.setAttribute("data-auth", "in"); else landing?.removeAttribute("data-auth");
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    const hall = document.getElementById("hall");
    const wins = hall?.querySelector<HTMLElement>(".hall__wins");
    const canvas = hall?.querySelector<HTMLCanvasElement>(".hall__fireflies");
    if (!hall || !wins || !canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const forced = phaseFromQuery(window.location.search, allowQuery);
    let inView = true, ff = 0, win = 0, phase = "night" as Phase;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => { const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    const live = () => inView && !document.hidden;

    // ── the sky, on the clock (writes only values that changed; the real clock moves slowly) ──
    const written: Record<string, string> = {};
    const tick = () => {
      const d = new Date(), h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      phase = forced ?? phaseName(h);
      const v = hallVars(forced ? PHASE_T[forced] : cycleT(h), K);
      ff = v.ff; win = v.win;
      for (const [k, val] of Object.entries(v.vars)) if (written[k] !== val) { hall.style.setProperty(k, val); written[k] = val; }
      if (hall.getAttribute("data-phase") !== phase) hall.setAttribute("data-phase", phase);
    };
    tick();
    const clock = window.setInterval(() => { if (live()) tick(); }, 5000);

    // ── the windows: lit after their turn-on (dusk and night only), then a little life ──
    const lights = [...wins.querySelectorAll<HTMLElement>(".hall__win")];
    const lastOn = Math.max(...lights.map((w) => parseFloat(w.style.getPropertyValue("--d")) || 0)) + 1.6;
    const turningOn = !reduce && (phase === "dusk" || phase === "night");
    if (turningOn) later(() => wins.setAttribute("data-lit", ""), lastOn * 1000); else wins.setAttribute("data-lit", "");
    const life = () => {
      if (live() && win > 0.5 && wins.hasAttribute("data-lit")) {
        const w = lights[Math.floor(Math.random() * lights.length)], r = Math.random();
        const kind = r < 0.45 ? "is-dim" : r < 0.8 ? "is-off" : "is-passing";
        if (!w.classList.contains("is-dim") && !w.classList.contains("is-off") && !w.classList.contains("is-passing")) {
          w.classList.add(kind);
          later(() => w.classList.remove(kind), kind === "is-off" ? 4000 + Math.random() * 9000 : kind === "is-dim" ? 2500 + Math.random() * 5000 : 3600);
        }
      }
      later(life, 2200 + Math.random() * 4200);
    };
    if (!reduce) later(life, Math.max(9000, lastOn * 1000 + 1500));

    // ── fireflies: real photographed glows, drawn on one canvas; skipped on Save-Data, ≤ 4 cores and reduced motion ──
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const fireflies = !reduce && !nav.connection?.saveData && (navigator.hardwareConcurrency ?? 8) > 4;
    let frame = 0, ready = false, started = 0, last = 0;
    const sheet = new Image();
    const ctx = fireflies ? canvas.getContext("2d") : null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr); };
    const place = (f: Firefly, first: boolean) => {
      f.x = Math.random(); f.y = 0.62 + Math.random() * 0.36; f.vx = (Math.random() - 0.5) * 0.01; f.vy = -0.0015 - Math.random() * 0.003;
      f.ph = Math.random() * 6.28; f.wob = 0.15 + Math.random() * 0.3; f.wait = first ? Math.random() * 8 : 2 + Math.random() * 7;
      f.fl = -1; f.pulses = Math.random() < 0.4 ? 2 : 1; f.dur = 1.1 + Math.random() * 0.9; // each pulse > 1 s: never more than 1 a second
      if (f.big) f.y = 0.82 + Math.random() * 0.15;
    };
    const flies: Firefly[] = FIREFLIES.boxes.map((s) => {
      const f = { s, big: s[2] >= 60 && s[3] >= 60 } as Firefly;
      place(f, true);
      return f;
    });
    const draw = (now: number) => {
      frame = 0;
      if (!ctx || !ready || !live() || ff < 0.01) { ctx?.clearRect(0, 0, canvas.width, canvas.height); last = 0; return; } // stop; resumes on wake()
      const dt = last ? Math.min(0.08, (now - last) / 1000) : 0;
      last = now;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const base = Math.min(1, (now - started) / 5000) * ff;
      ctx.globalCompositeOperation = "lighter";
      for (const f of flies) {
        f.ph += dt * f.wob;
        f.x += (f.vx + Math.sin(f.ph * 1.7) * 0.003) * dt;
        f.y += (f.vy + Math.cos(f.ph * 1.3) * 0.002) * dt;
        if (f.y < 0.56 || f.x < -0.06 || f.x > 1.06) { place(f, false); f.y = f.big ? f.y : 0.78 + Math.random() * 0.2; }
        if (f.fl < 0) { f.wait -= dt; if (f.wait <= 0) f.fl = 0; }
        let env = 0;
        if (f.fl >= 0) {
          f.fl += dt;
          const k = f.fl / f.dur, n = Math.floor(k);
          if (n >= f.pulses) { f.fl = -1; f.wait = 2 + Math.random() * 7; f.pulses = Math.random() < 0.4 ? 2 : 1; }
          else { const p = k - n; env = p < 0.22 ? p / 0.22 : Math.pow(1 - (p - 0.22) / 0.78, 1.8); }
        }
        if (env < 0.02) continue;
        const depth = (f.y - 0.6) / 0.4;
        const sc = (f.big ? 0.55 : 0.45 + depth * 0.55) * (W / 1344) * 1.1, w = f.s[2] * sc, h = f.s[3] * sc;
        ctx.globalAlpha = Math.min(1, base * env * (f.big ? 0.32 : 1));
        ctx.drawImage(sheet, f.s[0], f.s[1], f.s[2], f.s[3], f.x * W - w / 2, f.y * H - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      frame = requestAnimationFrame(draw);
    };
    const wake = () => { if (fireflies && ready && !frame && live() && ff >= 0.01) frame = requestAnimationFrame(draw); };
    let idle = 0;
    if (fireflies) {
      size();
      window.addEventListener("resize", size);
      sheet.onload = () => { ready = true; started = performance.now(); hall.setAttribute("data-fireflies", ""); wake(); };
      const load = () => { sheet.src = FIREFLIES.sheet; };
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) idle = w.requestIdleCallback(load, { timeout: 3000 }); else later(load, 1200);
    }

    // ── pause when off-screen or hidden ──
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) { tick(); wake(); } });
    io.observe(hall);
    const vis = () => { if (!document.hidden) { tick(); wake(); } };
    document.addEventListener("visibilitychange", vis);
    const clockTick = window.setInterval(wake, 5000); // the clock can bring fireflies back at dusk

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("resize", size);
      window.clearInterval(clock);
      window.clearInterval(clockTick);
      timers.forEach((id) => window.clearTimeout(id));
      if (idle) (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [allowQuery]);

  return null;
}
