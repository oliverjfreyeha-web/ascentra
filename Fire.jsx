import React, { useEffect, useRef } from "react";
/** Gold fire explosion: additive particles (fire, embers) rising from the centre, plus a shock ring. */
export default function Fire() {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current, x = c.getContext("2d"), dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    c.width = W * dpr; c.height = H * dpr; x.scale(dpr, dpr);
    const cx = W / 2, cy = H * .48, ps = [];
    for (let i = 0; i < 480; i++) { const a = Math.random() * 6.283, sp = Math.pow(Math.random(), .8) * 8 + 1, ember = Math.random() < .18; ps.push({ x: cx + Math.cos(a) * 6, y: cy + Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, t: 0, max: ember ? 90 + Math.random() * 70 : 70 + Math.random() * 70, r: ember ? 1.4 + Math.random() * 1.8 : 20 + Math.random() * 38, ember, w: Math.random() * 6.28 }); }
    let f = 0, raf;
    const loop = () => {
      x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, W, H); x.globalCompositeOperation = "lighter";
      for (const p of ps) {
        p.t++; if (p.t > p.max) continue; const u = p.t / p.max;
        p.vx *= .955; p.vy = p.vy * .955 - (p.ember ? .03 : .11); p.w += .1; p.x += p.vx + (p.ember ? Math.sin(p.w) * .6 : 0); p.y += p.vy;
        const a = Math.pow(1 - u, 1.1);
        if (p.ember) { x.fillStyle = `rgba(255,${200 - u * 90 | 0},90,${a})`; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.283); x.fill(); continue; }
        const r = p.r * (1 - u * .55) + 4;
        const col = u < .12 ? [255, 236, 170] : u < .5 ? [255, 176, 40] : [235, 80, 14];
        const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, `rgba(${col},${.5 * a})`); g.addColorStop(.5, `rgba(${col},${.5 * a})`); g.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, r, 0, 6.283); x.fill();
      }
      if (f < 26) { const cr = 60 + f * 9, ca = 1 - f / 26, cg = x.createRadialGradient(cx, cy, 0, cx, cy, cr); cg.addColorStop(0, `rgba(255,244,205,${ca * .8})`); cg.addColorStop(.4, `rgba(255,190,70,${ca * .45})`); cg.addColorStop(1, "rgba(255,100,20,0)"); x.fillStyle = cg; x.beginPath(); x.arc(cx, cy, cr, 0, 6.283); x.fill(); }
      if (f < 36) { const rr = f * 22, a = 1 - f / 36; x.strokeStyle = `rgba(255,224,138,${a * .8})`; x.lineWidth = 6 * a + 1; x.beginPath(); x.arc(cx, cy, rr, 0, 6.283); x.stroke(); }
      f++; if (f < 230) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="fire" />;
}
