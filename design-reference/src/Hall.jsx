import React, { useEffect, useMemo, useRef, useState } from "react";
import { K, PHASE_T, cycleT, hallVars } from "./cycle.js";
import photo from "../tex/hall.webp";
import mask from "../tex/hall-mask.png";
import foliage from "../tex/hall-foliage.webp";
const W = [[431,360,23,46],[431,451,23,52],[483,360,24,46],[483,451,24,52],[570,360,23,46],[570,451,23,52],[623,360,23,46],[623,451,23,52],[702,360,16,46],[702,451,16,52],[752,360,23,46],[752,451,23,52],[820,360,23,46],[820,451,23,52],[891,360,22,46],[891,451,22,52],[947,360,16,46],[947,451,16,52],[1025,360,22,46],[1025,451,22,52],[1082,360,23,46],[1082,451,23,52],[1174,353,23,52],[1174,451,23,52],[1231,353,25,52],[1231,451,25,52]];
const PW = 1344, PH = 752, pct = (v, of) => (v / of * 100).toFixed(3) + "%";
const RANK = (() => { const idx = W.map((w, i) => [i, Math.abs(w[0] + w[2] / 2 - 835) + (w[1] < 400 ? 40 : 0)]).sort((a, b) => a[1] - b[1]); const r = []; idx.forEach(([i], k) => r[i] = k); return r; })();
const STARS = (() => { let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); return [0, 1, 2].map(() => Array.from({ length: 30 }, () => `radial-gradient(${(.6 + r() * 1.1).toFixed(2)}px ${(.6 + r() * 1.1).toFixed(2)}px at ${(r() * 100).toFixed(1)}% ${(r() * 70).toFixed(1)}%, rgb(232 241 255 / ${(.35 + r() * .6).toFixed(2)}) 50%, transparent 100%)`).join(",")); })();

function Fireflies({ on }) {
  const ref = useRef();
  useEffect(() => {
    if (!on) return; const c = ref.current, x = c.getContext("2d"); let raf, w, h;
    const fit = () => { w = c.width = c.clientWidth; h = c.height = c.clientHeight; }; fit();
    const P = Array.from({ length: 34 }, () => ({ x: Math.random(), y: .62 + Math.random() * .3, p: Math.random() * 6.28, s: .0004 + Math.random() * .0006, r: 1 + Math.random() * 1.6 }));
    const loop = (t) => { x.clearRect(0, 0, w, h); for (const q of P) { const a = (Math.sin(t * .001 * (1 + q.s * 900) + q.p) + 1) / 2; const px = (q.x + Math.sin(t * q.s + q.p) * .02) * w, py = (q.y + Math.cos(t * q.s * 1.3 + q.p) * .015) * h; const g = x.createRadialGradient(px, py, 0, px, py, q.r * 5); g.addColorStop(0, `rgba(255,226,150,${.9 * a})`); g.addColorStop(1, "rgba(255,200,90,0)"); x.fillStyle = g; x.fillRect(px - 10, py - 10, 20, 20); } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [on]);
  return <canvas ref={ref} className="hall__ff" />;
}

const BIRD = <svg viewBox="0 0 24 10" width="22" height="9"><path d="M1 6c4-6 8-6 11 0 3-6 7-6 11 0" fill="none" stroke="#0a0f24" strokeWidth="1.6" strokeLinecap="round" /></svg>;
/** The ASCENTRA hall (the Higgsfield picture used on the landing page) with the landing's day cycle. `phase` is "auto" (visitor's clock) or dawn/day/dusk/night. `progress` 0..1 lights the windows from the middle outward. */
export default function Hall({ progress = .2, still, phase = "auto" }) {
  const lit = Math.round(progress * W.length), root = useRef();
  const [clock, setClock] = useState(() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; });
  useEffect(() => { const id = setInterval(() => { const d = new Date(); setClock(d.getHours() + d.getMinutes() / 60); }, 60000); return () => clearInterval(id); }, []);
  const t = phase === "auto" ? cycleT(clock) : PHASE_T[phase];
  const { vars, ff, win } = useMemo(() => hallVars(t, K), [t]);
  const sun = Math.max(0, 1 - win) * .85, night = Math.min(1, +vars["--stars"]);
  useEffect(() => {
    if (still) return; const el = root.current; let raf;
    const mv = (e) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { el.style.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3)); el.style.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3)); }); };
    addEventListener("pointermove", mv, { passive: true }); return () => { removeEventListener("pointermove", mv); cancelAnimationFrame(raf); };
  }, [still]);
  return <div className="hall" ref={root} style={{ ...vars, "--p": progress, "--sun": sun, "--night": night }}>
    <div className="hall__par"><div className="hall__stage">
      <img className="hall__photo" src={photo} alt="" width={PW} height={PH} />
      <div className="hall__sky"><div className="hall__skyfill" />
        <div className="hall__sunglow" /><div className="hall__rays" />
        <div className="hall__stars">{STARS.map((b, i) => <i key={i} style={{ backgroundImage: b }} />)}</div>
        <div className="hall__moon" /><i className="hall__shoot" /><i className="hall__shoot s2" />
        <div className="hall__cloud c1" /><div className="hall__cloud c2" /><div className="hall__cloud c3" />
        <div className="hall__birds"><b>{BIRD}</b><b>{BIRD}</b><b>{BIRD}</b></div></div>
      <div className="hall__tint" />
      <div className="hall__uplight" />
      <div className="hall__wins">
        {W.map(([x, y, w, h], i) => <i key={i} className={"hall__win" + (RANK[i] < lit ? " on" : "")} style={{ left: pct(x, PW), top: pct(y, PH), width: pct(w, PW), height: pct(h, PH), "--i": RANK[i] }} />)}
        <i className={"hall__door" + (lit > 0 ? " on" : "")} /><i className={"hall__spill" + (lit > 2 ? " on" : "")} />
      </div>
      <img className="hall__foliage" src={foliage} alt="" />
      <div className="hall__crown" />
    </div></div>
    <div className="hall__mist m1" /><div className="hall__mist m2" />
    {!still && <Fireflies on={ff > .15} />}
    <div className="hall__grain" />
  </div>;
}
