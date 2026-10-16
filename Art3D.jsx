import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* One shared WebGL canvas draws every coin, trophy and badge into the rectangle of its placeholder element. */
let R = null; const items = new Set(); let raf = 0, topCount = 0; const ptr = { x: -9999, y: -9999 };
function boot() {
  if (R) return R;
  const canvas = document.createElement("canvas"); canvas.className = "art3d-canvas"; document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromScene(new RoomEnvironment(), .035).texture;
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.25, "rgba(255,255,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(c);
  addEventListener("resize", () => renderer.setSize(innerWidth, innerHeight, false));
  addEventListener("pointermove", (e) => { ptr.x = e.clientX; ptr.y = e.clientY; }, { passive: true });
  R = { canvas, renderer, env, sprite }; return R;
}
function frame(t) {
  raf = requestAnimationFrame(frame); const { renderer, canvas } = R; const time = t / 1000;
  const W = innerWidth, H = innerHeight; renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.clear();
  renderer.setScissorTest(true); canvas.style.zIndex = topCount ? 90 : 20;
  for (const it of items) {
    if (topCount && !it.top) continue; const r = it.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W || r.width < 4) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    it.hx += ((Math.max(-1, Math.min(1, (ptr.x - cx) / 160))) - it.hx) * .08; it.hy += ((Math.max(-1, Math.min(1, (ptr.y - cy) / 160))) - it.hy) * .08;
    it.update(time, it.hx, it.hy);
    const x = Math.max(0, r.left), y = Math.max(0, H - r.bottom); const w = Math.min(W, r.right) - x, h = Math.min(H, H - r.top) - y;
    it.cam.aspect = r.width / r.height; it.cam.updateProjectionMatrix();
    renderer.setViewport(r.left, H - r.bottom, r.width, r.height); renderer.setScissor(x, y, w, h); renderer.render(it.scene, it.cam);
  }
}
function register(it) { boot(); items.add(it); if (it.top) topCount++; if (!raf) raf = requestAnimationFrame(frame); R.canvas.style.display = ""; }
function unregister(it) { items.delete(it); if (it.top) topCount--; if (!items.size) { cancelAnimationFrame(raf); raf = 0; if (R) R.canvas.style.display = "none"; } }

const C = (h) => new THREE.Color(h);
const dull = (h, locked) => locked ? C(h).lerp(C(0x3a3f58), .72).multiplyScalar(.8) : C(h);
function std(color, o = {}) { return new THREE.MeshStandardMaterial({ color, metalness: o.metal ?? 1, roughness: o.rough ?? .22, envMapIntensity: o.env ?? 1.15, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1, vertexColors: !!o.vc, envMap: o.envMap }); }
/* ---------- icon / logo shapes (placeholders until the ASCENTRA logo exists) ---------- */
const rr = (s, x, y, w, h) => { s.moveTo(x, y); s.lineTo(x + w, y); s.lineTo(x + w, y + h); s.lineTo(x, y + h); s.closePath(); return s; };
const S = {
  star() { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? .22 : .5, a = Math.PI / 2 + i * Math.PI / 5; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r - .03) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r - .03); } s.closePath(); return [s]; },
  flame() { const s = new THREE.Shape(); s.moveTo(0, .52); s.bezierCurveTo(.1, .3, .38, .22, .38, -.12); s.bezierCurveTo(.38, -.38, .2, -.5, 0, -.5); s.bezierCurveTo(-.2, -.5, -.38, -.38, -.38, -.12); s.bezierCurveTo(-.38, .06, -.24, .12, -.16, .22); s.bezierCurveTo(-.14, .1, -.06, .02, -.02, -.02); s.bezierCurveTo(.1, .16, .02, .34, 0, .52); return [s]; },
  mail() { const s = rr(new THREE.Shape(), -.5, -.32, 1, .64); const h = new THREE.Path(); h.moveTo(-.4, .22); h.lineTo(-.4, -.22); h.lineTo(.4, -.22); h.lineTo(.4, .22); h.closePath(); s.holes.push(h); const v = new THREE.Shape(); v.moveTo(-.44, .27); v.lineTo(0, -.06); v.lineTo(.44, .27); v.lineTo(.44, .17); v.lineTo(0, -.18); v.lineTo(-.44, .17); v.closePath(); return [s, v]; },
  shield() { const s = new THREE.Shape(); s.moveTo(0, .52); s.lineTo(.42, .36); s.lineTo(.42, 0); s.bezierCurveTo(.42, -.28, .2, -.44, 0, -.54); s.bezierCurveTo(-.2, -.44, -.42, -.28, -.42, 0); s.lineTo(-.42, .36); s.closePath(); return [s]; },
  note() { const s = new THREE.Shape(); s.moveTo(-.32, .5); s.lineTo(.14, .5); s.lineTo(.36, .28); s.lineTo(.36, -.5); s.lineTo(-.32, -.5); s.closePath(); [-.1, -.26].forEach((y) => { const p = new THREE.Path(); p.moveTo(-.2, y + .05); p.lineTo(.24, y + .05); p.lineTo(.24, y - .05); p.lineTo(-.2, y - .05); p.closePath(); s.holes.push(p); }); return [s]; },
  film() { const s = rr(new THREE.Shape(), -.46, -.38, .92, .76); const h = new THREE.Path(); h.moveTo(-.18, .22); h.lineTo(.3, 0); h.lineTo(-.18, -.22); h.closePath(); s.holes.push(h); return [s]; },
  bolt() { const s = new THREE.Shape(); s.moveTo(.1, .55); s.lineTo(-.34, -.06); s.lineTo(-.04, -.06); s.lineTo(-.12, -.55); s.lineTo(.34, .08); s.lineTo(.04, .08); s.closePath(); return [s]; },
  crown() { const s = new THREE.Shape(); s.moveTo(-.5, -.3); s.lineTo(-.5, .26); s.lineTo(-.22, -.02); s.lineTo(0, .36); s.lineTo(.22, -.02); s.lineTo(.5, .26); s.lineTo(.5, -.3); s.closePath(); return [s]; },
  chat() { const s = new THREE.Shape(); s.moveTo(-.5, .34); s.lineTo(.5, .34); s.lineTo(.5, -.2); s.lineTo(-.04, -.2); s.lineTo(-.28, -.48); s.lineTo(-.24, -.2); s.lineTo(-.5, -.2); s.closePath(); return [s]; },
  chart() { return [[-.42, -.4, .22, .5], [-.11, -.4, .22, .85], [.2, -.4, .22, .65]].map(([x, y, w, h]) => rr(new THREE.Shape(), x, y, w, h)); },
  target() { const a = new THREE.Shape(); a.absarc(0, 0, .5, 0, 6.283); const h = new THREE.Path(); h.absarc(0, 0, .37, 0, 6.283, true); a.holes.push(h); const d = new THREE.Shape(); d.absarc(0, 0, .2, 0, 6.283); return [a, d]; },
  globe() { const a = new THREE.Shape(); a.absarc(0, 0, .5, 0, 6.283); const h = new THREE.Path(); h.absarc(0, 0, .42, 0, 6.283, true); a.holes.push(h); return [a, rr(new THREE.Shape(), -.42, -.04, .84, .08), rr(new THREE.Shape(), -.04, -.42, .08, .84)]; },
  heart() { const s = new THREE.Shape(); s.moveTo(0, -.46); s.bezierCurveTo(-.6, -.04, -.5, .4, -.2, .38); s.bezierCurveTo(-.08, .37, 0, .28, 0, .2); s.bezierCurveTo(0, .28, .08, .37, .2, .38); s.bezierCurveTo(.5, .4, .6, -.04, 0, -.46); return [s]; },
};
const relief = (shapes, mat, depth = .07, scale = 1) => { const g = new THREE.Group(); shapes.forEach((sh) => g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: .018, bevelThickness: .02, bevelSegments: 3, curveSegments: 18 }), mat))); g.scale.setScalar(scale); return g; };
/* ---------- trophy designs: every #1 trophy is different ---------- */
const TV = {
  "1a": { cA: 0xfff0a0, cB: 0xf0a020, prof: "classic", h: "ring", em: "crown", top: "gem", gem: 0x7be2ff, glow: 0xffc54a },
  "1b": { cA: 0x45e7ff, cB: 0x8b5cff, prof: "bowl", h: "ear", em: "bolt", top: "orb", gem: 0xff6bd6, glow: 0x7ad4ff },
  "1c": { cA: 0xffd6c8, cB: 0xe58a7c, prof: "chalice", h: "ring", em: "heart", top: "ring", gem: 0xffffff, glow: 0xff9aa8 },
  "1d": { cA: 0x35e2a0, cB: 0xf3c64a, prof: "flute", h: "none", em: "shield", top: "gem", gem: 0xb6ffe0, glow: 0x4af0b0 },
  "1e": { cA: 0x2b2f4a, cB: 0xf0b83a, prof: "classic", h: "ear", em: "star", top: "star", gem: 0xb08cff, glow: 0xb08cff },
  "3": { cA: 0xf4f8ff, cB: 0xa9b8d4, prof: "classic", h: "ring", em: "star3", top: "none", gem: 0xffffff, glow: 0xcfe0ff },
  "10": { cA: 0xf2b27a, cB: 0xa8643a, prof: "bowl", h: "ring", em: "star3", top: "none", gem: 0xffffff, glow: 0xffa860 },
};
const PROF = {
  classic: [[0, .8], [.16, .82], [.3, .95], [.5, 1.2], [.68, 1.55], [.78, 1.95], [.8, 2.3]],
  bowl: [[0, .85], [.2, .88], [.5, .98], [.8, 1.2], [.96, 1.55], [1, 2.0], [.96, 2.2]],
  chalice: [[0, .8], [.12, .84], [.2, 1.0], [.5, 1.3], [.82, 1.7], [.88, 2.1], [.82, 2.32]],
  flute: [[0, .8], [.14, .85], [.28, 1.1], [.4, 1.75], [.48, 2.4], [.5, 2.7]],
};
/* ---------- badge palettes: each skill has its own colour ---------- */
const BP = { mail: [0x7f8cff, 0x3a42c8, 0x6fa0ff], note: [0x57e6a8, 0x0f7a55, 0x7bffd0], film: [0xff7a9c, 0xa3123f, 0xffa0bd], chat: [0x55e0ff, 0x0a6f95, 0x9aefff], bolt: [0xffc14a, 0xb35a00, 0xffe08a], star: [0xc58cff, 0x5a1fa8, 0xe0b8ff], chart: [0x3ee0d0, 0x0b6b66, 0x8ff7ee], target: [0xff9a4a, 0xa3410a, 0xffc08a] };

function particles(count, sprite, color, o) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = Array.from({ length: count }, () => ({ a: Math.random() * 6.283, r: o.r0 + Math.random() * o.r1, y: (Math.random() - .5) * o.h, s: (.2 + Math.random() * .6) * (Math.random() < .5 ? 1 : -1), p: Math.random() * 6.283, rise: o.rise ? .1 + Math.random() * .25 : 0 }));
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: o.size, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  const c = C(color);
  pts.userData.step = (t) => { for (let i = 0; i < count; i++) { const q = seed[i], a = q.a + t * q.s; let y = q.y + (q.rise ? ((t * q.rise + q.p) % 1) * o.h - o.h / 2 : Math.sin(t * .8 + q.p) * .12); pos[i * 3] = Math.cos(a) * q.r; pos[i * 3 + 2] = Math.sin(a) * q.r * (o.flat ?? 1); pos[i * 3 + 1] = y + (o.cy || 0); const tw = .35 + .65 * Math.max(0, Math.sin(t * 2.2 + q.p * 3)); const fade = q.rise ? Math.sin(((t * q.rise + q.p) % 1) * 3.14159) : 1; col[i * 3] = c.r * tw * fade; col[i * 3 + 1] = c.g * tw * fade; col[i * 3 + 2] = c.b * tw * fade; } geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; };
  return pts;
}
function glow(sprite, color, size, z = -.5, cy = 0) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color, transparent: true, opacity: .4, depthWrite: false, blending: THREE.AdditiveBlending })); m.scale.set(size, size, 1); m.position.set(0, cy, z); return m; }

function makeScene(kind, variant, locked, env, sprite) {
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(30, 1, .1, 50); const grp = new THREE.Group(); scene.add(grp); scene.environment = env;
  const key = new THREE.DirectionalLight(0xfff1d0, locked ? .9 : 1.7); key.position.set(2, 3, 4); scene.add(key); const rim = new THREE.DirectionalLight(0x9fb8ff, 2); rim.position.set(-3, 1, -3); scene.add(rim);
  const moving = new THREE.PointLight(0xffffff, locked ? 0 : 5, 8); moving.position.set(0, 1, 2.5); scene.add(moving);
  const mk = (c, o) => std(dull(c, locked), { envMap: env, ...o });
  let update, parts, halo;
  if (kind === "coin") {
    const gold = mk(0xeeb02a, { rough: .22 }), bright = mk(0xffe39a, { rough: .12, env: 1.4 }), deep = mk(0xa8700b, { rough: .38 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .2, 96), gold); body.rotation.x = Math.PI / 2; grp.add(body);
    grp.add(new THREE.Mesh(new THREE.TorusGeometry(.96, .085, 24, 128), bright));
    for (const z of [.101, -.101]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.76, .028, 12, 96), deep); ring.position.z = z; grp.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(.62, .012, 8, 96), bright); ring2.position.z = z; grp.add(ring2);
      const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.022, 6, 6), bright, 36), dm = new THREE.Object3D(); for (let i = 0; i < 36; i++) { const an = i / 36 * 6.283; dm.position.set(Math.cos(an) * .87, Math.sin(an) * .87, z); dm.updateMatrix(); dots.setMatrixAt(i, dm.matrix); } grp.add(dots);
      const rays = new THREE.InstancedMesh(new THREE.BoxGeometry(.012, .09, .01), deep, 48), rm = new THREE.Object3D(); for (let i = 0; i < 48; i++) { const an = i / 48 * 6.283; rm.position.set(Math.cos(an) * .52, Math.sin(an) * .52, z); rm.rotation.z = an + Math.PI / 2; rm.updateMatrix(); rays.setMatrixAt(i, rm.matrix); } grp.add(rays);
    }
    const ic = std(dull(0xfff4c8, locked), { rough: .12, env: 1.6, emissive: locked ? 0 : 0xffb830, ei: .25, envMap: env }); const f = relief((S[variant] || S.star)(), ic, .08, .95); f.position.z = .1; grp.add(f);
    const b = relief((S[variant] || S.star)(), ic, .08, .95); b.position.z = -.1; b.rotation.y = Math.PI; grp.add(b);
    cam.position.set(0, 0, 4.1);
    if (!locked) { parts = particles(34, sprite, 0xffd97a, { r0: 1.15, r1: .5, h: .7, size: .09, flat: .6 }); scene.add(parts); halo = glow(sprite, 0xffc54a, 2.3); scene.add(halo); }
    update = (t, hx, hy) => { grp.rotation.y = locked ? -.35 + hx * .3 : t * .9 + hx * .5; grp.rotation.x = Math.sin(t * .8) * .09 + hy * .25; grp.position.y = Math.sin(t * 1.3) * .03; moving.position.x = Math.sin(t * 1.4) * 2.4; if (parts) parts.userData.step(t); if (halo) halo.material.opacity = .45 + Math.sin(t * 2) * .12; };
  } else if (kind === "trophy") {
    const v = TV[variant] || TV["1a"];
    const cup = (() => { const o = PROF[v.prof], pts = o.map(([x, y]) => [x, y]).concat(o.slice().reverse().map(([x, y]) => [Math.max(0, x - .07), y])); const vs = pts.map(([x, y]) => new THREE.Vector2(x, y)); const geo = new THREE.LatheGeometry(vs, 96); const ys = o.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys); const cA = dull(v.cA, locked), cB = dull(v.cB, locked), colr = []; const P = geo.attributes.position; for (let i = 0; i < P.count; i++) { const k = (P.getY(i) - y0) / (y1 - y0); const c = cA.clone().lerp(cB, Math.min(1, Math.max(0, k))); colr.push(c.r, c.g, c.b); } geo.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3)); const m = std(0xffffff, { vc: true, rough: .2, env: 1.2, envMap: env }); m.side = THREE.DoubleSide; return { mesh: new THREE.Mesh(geo, m), o, y0, y1 }; })();
    grp.add(cup.mesh); const O = cup.o; const xAt = (y) => { for (let i = 1; i < O.length; i++) if (O[i][1] >= y) { const a = O[i - 1], b = O[i], k = (y - a[1]) / (b[1] - a[1] || 1); return a[0] + (b[0] - a[0]) * k; } return O[O.length - 1][0]; };
    const bright = mk(v.cA, { rough: .12, env: 1.3 }), mid = mk(v.cB, { rough: .2 }), dark = std(dull(0x0f1024, locked), { metal: .5, rough: .16, env: 1.3, envMap: env }), gem = std(dull(v.gem, locked), { metal: .2, rough: .08, env: 2, emissive: locked ? 0 : v.gem, ei: .55, envMap: env });
    grp.add(new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [.34, 0], [.38, .06], [.2, .14], [.1, .3], [.16, .46], [.12, .58], [.26, .66], [.2, .8], [0, .82]].map(([x, y]) => new THREE.Vector2(x, y + .22)), 64), mid));
    for (const [rt, rb, hh, yy] of [[.62, .7, .22, .11], [.46, .56, .16, .3]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hh, 6), dark); b.position.y = yy; b.rotation.y = Math.PI / 6; grp.add(b); }
    const trim = new THREE.Mesh(new THREE.TorusGeometry(.5, .02, 8, 6), mid); trim.rotation.x = Math.PI / 2; trim.position.y = .39; trim.rotation.z = Math.PI / 6; grp.add(trim);
    const hy0 = cup.y1 - .45, hx0 = xAt(hy0);
    if (v.h !== "none") for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(.4, .06, 20, 64, Math.PI), bright); h.position.set(sx * (hx0 + .02), hy0, 0); h.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2; if (v.h === "ear") h.scale.set(.6, 1.15, 1); grp.add(h); }
    const lid = new THREE.Mesh(new THREE.TorusGeometry(O[O.length - 1][0] - .02, .05, 16, 96), bright); lid.rotation.x = Math.PI / 2; lid.position.y = cup.y1; grp.add(lid);
    const ey = (cup.y0 + cup.y1) / 2 + .1, ez = xAt(ey) - .07;
    if (v.em === "star3") { for (let i = 0; i < 3; i++) { const st = relief(S.star(), bright, .05, .27); st.position.set((i - 1) * .3, ey + (i === 1 ? .1 : 0), ez - Math.abs(i - 1) * .05); grp.add(st); } }
    else { const em = relief(S[v.em](), bright, .05, Math.min(.6, xAt(ey) * .8)); em.position.set(0, ey, ez); grp.add(em); }
    if (v.top === "gem") { const g = new THREE.Mesh(new THREE.OctahedronGeometry(.17, 0), gem); g.position.y = cup.y1 + .38; g.scale.y = 1.4; grp.add(g); grp.userData.spin = g; }
    if (v.top === "orb") { const g = new THREE.Mesh(new THREE.SphereGeometry(.19, 32, 32), gem); g.position.y = cup.y1 + .38; grp.add(g); grp.userData.spin = g; }
    if (v.top === "ring") { const g = new THREE.Mesh(new THREE.TorusGeometry(.22, .035, 12, 48), bright); g.position.y = cup.y1 + .4; grp.add(g); grp.userData.spin = g; }
    if (v.top === "star") { const g = relief(S.star(), gem, .06, .42); g.position.set(0, cup.y1 + .4, 0); grp.add(g); grp.userData.spin = g; }
    grp.position.y = -1.4; const wrap = new THREE.Group(); wrap.add(grp); scene.remove(grp); scene.add(wrap);
    cam.position.set(0, .1, 6.5);
    if (!locked) { parts = particles(40, sprite, v.glow, { r0: .55, r1: 1, h: 3.4, size: .1, rise: true, flat: .6, cy: 0 }); wrap.add(parts); halo = glow(sprite, v.glow, 3.6, -.8, 0); scene.add(halo); }
    update = (t, hx, hy) => { wrap.rotation.y = Math.sin(t * .6) * .55 + hx * .5; wrap.rotation.x = hy * .12; wrap.position.y = Math.sin(t * 1.2) * .06; if (grp.userData.spin) grp.userData.spin.rotation.y = t * 1.6; moving.position.x = Math.sin(t * 1.2) * 2.6; if (parts) parts.userData.step(t); if (halo) halo.material.opacity = .4 + Math.sin(t * 1.6) * .12; };
  } else { // badge
    const [pm, pd, pg] = BP[variant] || BP.mail;
    const outerM = mk(pm, { rough: .14, env: 1.4 }), innerM = mk(pd, { rough: .32 }), gemM = std(dull(pg, locked), { metal: .2, rough: .08, env: 2, emissive: locked ? 0 : pg, ei: .6, envMap: env });
    const hexS = (r) => { const s = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 3; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); return s; };
    const outer = new THREE.Mesh(new THREE.ExtrudeGeometry(hexS(1), { depth: .16, bevelEnabled: true, bevelSize: .07, bevelThickness: .08, bevelSegments: 5 }), outerM); outer.position.z = -.08; grp.add(outer);
    const mid = new THREE.Mesh(new THREE.ExtrudeGeometry(hexS(.86), { depth: .04, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 2 }), mk(pg, { rough: .1, env: 1.6 })); mid.position.z = .1; grp.add(mid);
    const inner = new THREE.Mesh(new THREE.ExtrudeGeometry(hexS(.76), { depth: .05, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 3 }), innerM); inner.position.z = .13; grp.add(inner);
    const ico = relief((S[variant] || S.mail)(), std(locked ? 0x6b7390 : 0xf4f8ff, { metal: .5, rough: .15, emissive: locked ? 0 : pm, ei: .5, envMap: env }), .06, .8); ico.position.z = .22; grp.add(ico);
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; const st = new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 12), gemM); st.position.set(Math.cos(a) * .93, Math.sin(a) * .93, .1); grp.add(st); }
    grp.position.y = .05; cam.position.set(0, 0, 4.5);
    if (!locked) { parts = particles(26, sprite, pg, { r0: 1.1, r1: .45, h: .9, size: .08, flat: .6 }); scene.add(parts); halo = glow(sprite, pm, 2.2); scene.add(halo); }
    update = (t, hx, hy) => { grp.rotation.y = Math.sin(t * .7) * .5 + hx * .55; grp.rotation.x = Math.sin(t * .9) * .08 + hy * .25; grp.position.y = .05 + Math.sin(t * 1.2) * .05; moving.position.x = Math.sin(t * 1.3) * 2.4; if (parts) parts.userData.step(t); if (halo) halo.material.opacity = .4 + Math.sin(t * 1.8) * .1; };
  }
  return { scene, cam, update };
}
/** kind: coin | trophy | badge. variant: icon (coin/badge) or a trophy id ("1a".."1e", "3", "10"). */
export default function Art3D({ kind, variant, locked, w, h, top, label }) {
  const ref = useRef();
  useEffect(() => {
    const { env, sprite } = boot(); const sc = makeScene(kind, variant, !!locked, env, sprite);
    const it = { el: ref.current, top: !!top, hx: 0, hy: 0, ...sc }; register(it); return () => unregister(it);
  }, [kind, variant, locked, top]);
  return <div ref={ref} className="art3d" role="img" aria-label={label} style={{ width: w, height: h }} />;
}
