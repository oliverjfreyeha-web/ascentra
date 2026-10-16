/* Apple-style liquid glass lens for Chromium: an SVG displacement map (edge-based, convex bezel) plus per-channel
   dispersion, applied through backdrop-filter: url(#id). Other browsers keep the CSS-only glass. */
let host, n = 0; const NS = "http://www.w3.org/2000/svg";
const supported = () => typeof navigator !== "undefined" && !!navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand));
function ensureHost() { if (host) return host; host = document.createElementNS(NS, "svg"); host.setAttribute("width", "0"); host.setAttribute("height", "0"); host.style.cssText = "position:absolute;pointer-events:none"; host.setAttribute("aria-hidden", "true"); document.body.appendChild(host); return host; }
export function makeMap(w, h, r, bezel) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"), img = x.createImageData(w, h), d = img.data;
  const hx = w / 2, hy = h / 2, bx = hx - r, by = hy - r;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = i + .5 - hx, py = j + .5 - hy, qx = Math.abs(px) - bx, qy = Math.abs(py) - by;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r; // <0 inside
    const depth = -sdf; let nx = 0, ny = 0, mag = 0;
    if (depth > 0 && depth < bezel) {
      const t = depth / bezel; mag = Math.pow(1 - t, 2.4);
      let gx, gy; if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; gx = qx / l; gy = qy / l; } else if (qx > qy) { gx = 1; gy = 0; } else { gx = 0; gy = 1; }
      nx = -gx * Math.sign(px); ny = -gy * Math.sign(py);
    }
    const k = (j * w + i) * 4; d[k] = 128 + 127 * nx * mag; d[k + 1] = 128 + 127 * ny * mag; d[k + 2] = 128; d[k + 3] = 255;
  }
  x.putImageData(img, 0, 0); return c.toDataURL("image/png");
}
const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
export function attachLens(node, o = {}) {
  if (!supported() || node.__lens) return; const id = "lens" + n++; const f = el("filter", { id, x: 0, y: 0, "color-interpolation-filters": "sRGB" });
  ensureHost().appendChild(f); node.__lens = { id, f };
  const update = () => {
    const w = node.offsetWidth, h = node.offsetHeight; if (w < 24 || h < 24 || (node.__lw === w && node.__lh === h)) return; node.__lw = w; node.__lh = h;
    const cs = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 20, r = Math.min(cs, w / 2, h / 2), bezel = Math.min(o.bezel ?? 26, Math.min(w, h) * .4), s = o.scale ?? 32;
    f.replaceChildren(); f.setAttribute("filterUnits", "userSpaceOnUse"); f.setAttribute("primitiveUnits", "userSpaceOnUse"); f.setAttribute("width", w); f.setAttribute("height", h);
    f.appendChild(el("feImage", { href: makeMap(w, h, r, bezel), x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map0" }));
    f.appendChild(el("feComponentTransfer", { in: "map0", result: "map" })); const ct = f.lastChild; ["R", "G"].forEach((c) => ct.appendChild(el("feFunc" + c, { type: "linear", slope: 1, intercept: -0.5 / 255 })));
    [["R", s, "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"], ["G", s * .96, "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"], ["B", s * .92, "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"]].forEach(([c, sc, m]) => {
      f.appendChild(el("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale: sc, xChannelSelector: "R", yChannelSelector: "G", result: "d" + c }));
      f.appendChild(el("feColorMatrix", { in: "d" + c, type: "matrix", values: m, result: "c" + c }));
    });
    f.appendChild(el("feBlend", { in: "cR", in2: "cG", mode: "screen", result: "rg" })); f.appendChild(el("feBlend", { in: "rg", in2: "cB", mode: "screen" }));
    const v = `blur(${o.blur ?? 5}px) url(#${id}) saturate(${o.sat ?? 1.5}) brightness(${o.bright ?? 1.08})`; node.style.backdropFilter = v; node.style.webkitBackdropFilter = v;
  };
  const ro = new ResizeObserver(update); ro.observe(node); node.__lens.ro = ro; update();
}
export function scanLens(root = document, all = false) {
  if (!supported()) return; root.querySelectorAll(all ? "[data-lens],.g,.stats" : "[data-lens]").forEach((n) => { if (all && !n.hasAttribute("data-lens")) { n.setAttribute("data-lens", ""); n.__auto = 1; } attachLens(n); });
  if (host) { const live = new Set([...document.querySelectorAll("[data-lens]")].map((n) => n.__lens?.id)); for (const f of [...host.children]) if (!live.has(f.id)) f.remove(); }
}
export function clearLens() {
  if (!host) return; document.querySelectorAll("[data-lens]").forEach((n) => {
    if (n.__lens) { n.__lens.ro.disconnect(); n.style.backdropFilter = ""; n.style.webkitBackdropFilter = ""; delete n.__lens; n.__lw = n.__lh = 0; }
    if (n.__auto) { n.removeAttribute("data-lens"); delete n.__auto; } }); host.replaceChildren();
}
export const lensSupported = supported;
