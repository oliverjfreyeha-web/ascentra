/**
 * D2d · Procedural frost map. Writes public/art/frost.webp (768 px, under 150 KB): a seamless grayscale map (white = frost) made only
 * in code: branching fern-like ice crystals (hexagonal, like window frost), soft fractal noise and a few faint hairline
 * cracks. The page decides where frost shows (edges and corners) with a mask; this map is uniform and tiles.
 * Run: node scripts/build-frost.mjs   (deterministic: the same seed gives the same file)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const N = 1024;
let seed = 20261007;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const crystals = new Float32Array(N * N);
const cracks = new Float32Array(N * N);
const wrap = (v) => ((v % N) + N) % N;

/** Splat a soft dot at (x, y), wrapping around the edges so the map tiles. */
function dot(buf, x, y, r, a) {
  const R = Math.ceil(r * 2);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const px = Math.floor(x) + dx, py = Math.floor(y) + dy;
    const d2 = (px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2;
    const w = Math.exp(-d2 / (2 * r * r)) * a;
    if (w < 0.004) continue;
    const i = wrap(py) * N + wrap(px);
    buf[i] = Math.max(buf[i], w);
  }
}
function line(buf, x0, y0, x1, y1, r, a0, a1) {
  const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(2, Math.ceil(len * 2));
  for (let s = 0; s <= steps; s++) { const t = s / steps; dot(buf, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, a0 + (a1 - a0) * t); }
}

/** A fern-like crystal arm: a spine with side branches at ±60°, each branch a smaller arm. */
function arm(x, y, ang, len, width, alpha, depth) {
  const segs = Math.max(3, Math.round(len / 7));
  let cx = x, cy = y, a = ang;
  for (let s = 0; s < segs; s++) {
    a += (rnd() - 0.5) * 0.07;
    const step = len / segs, nx = cx + Math.cos(a) * step, ny = cy + Math.sin(a) * step;
    const fade = 1 - s / segs;
    line(crystals, cx, cy, nx, ny, width * (0.55 + 0.45 * fade), alpha * (0.6 + 0.4 * fade), alpha * (0.6 + 0.4 * (1 - (s + 1) / segs)));
    if (depth > 0 && s > 0 && rnd() < (depth > 1 ? 0.8 : 0.55)) {
      const sub = len * (0.42 - 0.3 * (s / segs)) * (0.6 + rnd() * 0.5);
      if (sub > 3) {
        arm(nx, ny, a + Math.PI / 3 + (rnd() - 0.5) * 0.1, sub, width * 0.7, alpha * 0.85, depth - 1);
        arm(nx, ny, a - Math.PI / 3 + (rnd() - 0.5) * 0.1, sub * (0.8 + rnd() * 0.3), width * 0.7, alpha * 0.85, depth - 1);
      }
    }
    cx = nx; cy = ny;
  }
}

// Ferns: long feathery arms growing from scattered nuclei, plus small six-armed stars (snowflakes).
for (let i = 0; i < 30; i++) {
  const x = rnd() * N, y = rnd() * N, base = rnd() * Math.PI * 2, arms = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < arms; k++) arm(x, y, base + (k * Math.PI * 2) / arms + (rnd() - 0.5) * 0.6, 90 + rnd() * 170, 0.9 + rnd() * 0.4, 0.55 + rnd() * 0.35, 3);
}
for (let i = 0; i < 40; i++) {
  const x = rnd() * N, y = rnd() * N, base = rnd() * Math.PI, len = 8 + rnd() * 22;
  for (let k = 0; k < 6; k++) arm(x, y, base + (k * Math.PI) / 3, len, 0.7, 0.5 + rnd() * 0.3, 1);
}

// Hairline cracks: a few long, nearly straight, very faint lines.
for (let i = 0; i < 7; i++) {
  let x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2;
  const len = 250 + rnd() * 400;
  for (let s = 0; s < len; s += 4) {
    a += (rnd() - 0.5) * 0.18;
    const nx = x + Math.cos(a) * 4, ny = y + Math.sin(a) * 4;
    line(cracks, x, y, nx, ny, 0.45, 0.35, 0.35);
    if (rnd() < 0.02) { const b = a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6); line(cracks, nx, ny, nx + Math.cos(b) * 30, ny + Math.sin(b) * 30, 0.4, 0.3, 0); }
    x = nx; y = ny;
  }
}

// Tileable fractal value noise (the soft haze between crystals).
function valueNoise(freq, s) {
  const g = new Float32Array(freq * freq);
  for (let i = 0; i < g.length; i++) g[i] = ((Math.sin(i * 12.9898 + s * 78.233) * 43758.5453) % 1 + 1) % 1;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x / N) * freq, fy = (y / N) * freq, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (a, b) => g[(b % freq) * freq + (a % freq)];
    const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx, bot = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
    out[y * N + x] = top * (1 - sy) + bot * sy;
  }
  return out;
}
const octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [64, 0.1]].map(([f, w], k) => [valueNoise(f, k + 1), w]);

const px = Buffer.alloc(N * N);
for (let i = 0; i < N * N; i++) {
  let n = 0;
  for (const [o, w] of octaves) n += o[i] * w;
  const haze = Math.max(0, n - 0.45) * 0.35; // a little haze, never a flat grey veil
  const v = Math.min(1, crystals[i] * 0.92 + cracks[i] * 0.55 + haze * (0.4 + crystals[i] * 0.6));
  px[i] = Math.round(Math.pow(v, 0.9) * 255);
}

mkdirSync("public/art", { recursive: true });
const info = await sharp(px, { raw: { width: N, height: N, channels: 1 } }).resize(768, 768, { kernel: "lanczos3" }).webp({ quality: 60, effort: 6 }).toFile("public/art/frost.webp");
console.log("frost.webp", Math.round(info.size / 1024), "KB");
