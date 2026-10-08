/**
 * D4 · The Hall: builds the landing scene's served assets from the two originals in /art-source (not served).
 *   node scripts/d4-assets.mjs
 * Run once; only its outputs are committed. Coordinates are for the 1344×752 originals (scaled if they ever change).
 *   a) hall          public/art/hall-{640,1344}.{avif,webp}           the photo (the LCP image)
 *   b) sky mask      public/art/hall-sky-mask.png (672×376)            alpha 255 = sky; masks the replacement sky layer
 *   c) foliage       public/art/hall-foliage.{avif,webp}              hedges and small trees cut from the photo, drawn
 *                                                                     above the window lights so lights sit behind them
 *   d) fireflies     public/art/fireflies-sheet.webp + app/landing/hall/fireflies.json   graded glows packed into one sheet
 * Everything uses sharp (already installed by Next.js) and plain pixel loops; nothing is downloaded.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const SRC = "art-source";
const OUT = "public/art";
const W = 1344, H = 752;
mkdirSync(OUT, { recursive: true });

const kb = (f) => `${(statSync(f).size / 1024).toFixed(1)} KB`;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function rgb(file, width = W) {
  const { data, info } = await sharp(file).resize({ width }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (width === W && (info.width !== W || info.height !== H)) throw new Error(`${file}: expected ${W}×${H}, got ${info.width}×${info.height}`);
  return { data, w: info.width, h: info.height };
}

/** 3×3 minimum (erode) on a single-channel buffer. */
function minFilter3(a, w, h) {
  const out = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
      m = Math.min(m, a[yy * w + xx]);
    }
    out[y * w + x] = m;
  }
  return out;
}

/** Separable Gaussian blur on a single-channel float/uint buffer. */
function gauss(a, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
    out[y * w + x] = v;
  }
  return out;
}

/** Point-in-polygon (even-odd). */
function inside(px, py, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ── a) the hall photo ─────────────────────────────────────────────────────────────────────────────────
for (const w of [640, 1344]) {
  const img = sharp(`${SRC}/hall.webp`).resize({ width: w });
  await img.clone().avif({ quality: 62, effort: 7 }).toFile(`${OUT}/hall-${w}.avif`);
  await img.clone().webp({ quality: 80, effort: 6 }).toFile(`${OUT}/hall-${w}.webp`);
  console.log(`hall-${w}: avif ${kb(`${OUT}/hall-${w}.avif`)}, webp ${kb(`${OUT}/hall-${w}.webp`)}`);
}

// ── b) the sky mask (672×376) ─────────────────────────────────────────────────────────────────────────
const SKY = [[0, 470], [372, 470], [372, 326], [465, 288], [556, 324], [572, 302], [572, 243], [607, 243], [607, 285], [640, 278], [835, 196],
    [1027, 268], [1068, 272], [1068, 233], [1110, 233], [1110, 272], [1132, 300], [1132, 322], [1222, 287], [1312, 322], [1312, 290], [1344, 290],
    [1344, 0], [0, 0]];
{
  const mw = 672, mh = 376, s = W / mw;
  const { data } = await rgb(`${SRC}/hall.webp`, mw);
  const a = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const X = (x + 0.5) * s, Y = (y + 0.5) * s, i = (y * mw + x) * 3;
    const tree = Y >= 290 && lum(data[i], data[i + 1], data[i + 2]) < 24;
    a[y * mw + x] = inside(X, Y, SKY) && !tree ? 255 : 0;
  }
  const blurred = gauss(minFilter3(a, mw, mh), mw, mh, 1);
  const px = Buffer.alloc(mw * mh * 4);
  for (let i = 0; i < mw * mh; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255; px[i * 4 + 3] = Math.round(Math.min(255, Math.max(0, blurred[i]))); }
  await sharp(px, { raw: { width: mw, height: mh, channels: 4 } }).png({ compressionLevel: 9, palette: true }).toFile(`${OUT}/hall-sky-mask.png`);
  console.log(`hall-sky-mask: ${kb(`${OUT}/hall-sky-mask.png`)}`);
}

// ── c) the foliage layer (y 285..552) ─────────────────────────────────────────────────────────────────
{
  const Y0 = 285, Y1 = 552, fh = Y1 - Y0;
  const { data } = await rgb(`${SRC}/hall.webp`);
  const strips = [[250, 506, 1344, 549], [0, 300, 150, 549], [1308, 285, 1344, 549]]; // x0,y0,x1,y1
  const ellipses = [[377, 476, 13], [618, 472, 14], [646, 476, 14], [1015, 470, 14], [1041, 474, 14], [1298, 470, 14]]; // cx, top, halfWidth (height 110)
  // Two exclusions, so the layers agree: anything the sky layer paints (inside the sky polygon and not a dark tree edge)
  // is never foliage, and the front door (lit by its own layer) is never covered by its own dark pixels.
  const isSky = (x, y, l) => inside(x, y, SKY) && !(y >= 290 && l < 24);
  const isDoor = (x, y) => x >= 808 && x < 856 && y < 522;
  const inRegion = (x, y) =>
    strips.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1) ||
    ellipses.some(([cx, top, hw]) => { const cy = top + 55, dx = (x - cx) / hw, dy = (y - cy) / 55; return dx * dx + dy * dy <= 1; });
  const alpha = new Float32Array(W * fh);
  for (let y = 0; y < fh; y++) for (let x = 0; x < W; x++) {
    const Y = y + Y0, i = (Y * W + x) * 3;
    const l = lum(data[i], data[i + 1], data[i + 2]);
    if (!inRegion(x + 0.5, Y + 0.5) || isSky(x + 0.5, Y + 0.5, l) || isDoor(x, Y)) continue;
    alpha[y * W + x] = Math.min(1, Math.max(0, (60 - l) / 22)) * 255;
  }
  const soft = gauss(alpha, W, fh, 0.6);
  const px = Buffer.alloc(W * fh * 4);
  for (let y = 0; y < fh; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, i = ((y + Y0) * W + x) * 3;
    px[o] = data[i]; px[o + 1] = data[i + 1]; px[o + 2] = data[i + 2]; px[o + 3] = Math.round(Math.min(255, soft[y * W + x]));
  }
  const img = sharp(px, { raw: { width: W, height: fh, channels: 4 } });
  await img.clone().avif({ quality: 60, effort: 7 }).toFile(`${OUT}/hall-foliage.avif`);
  await img.clone().webp({ quality: 78, alphaQuality: 85, effort: 6 }).toFile(`${OUT}/hall-foliage.webp`);
  console.log(`hall-foliage (${W}×${fh}, top ${Y0}): avif ${kb(`${OUT}/hall-foliage.avif`)}, webp ${kb(`${OUT}/hall-foliage.webp`)}`);
}

// ── d) fireflies: grade, find each glow, pack into one sheet ─────────────────────────────────────────
{
  const { data } = await rgb(`${SRC}/fireflies.png`);
  const g = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], gr = data[i * 3 + 1], b = data[i * 3 + 2];
    g[i * 3] = Math.min(255, r * 0.8); g[i * 3 + 1] = gr; g[i * 3 + 2] = Math.min(255, b * 0.9 + gr * 0.12);
  }
  let on = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) on[i] = Math.max(g[i * 3], g[i * 3 + 1], g[i * 3 + 2]) > 22 ? 1 : 0;
  // dilate by 3 px (a 7×7 square) so a glow and its faint tail join into one part
  const dil = new Uint8Array(W * H), R = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!on[y * W + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) dil[yy * W + xx] = 1;
    }
  }
  on = dil;
  // label connected parts (8-connected), keep bounding boxes
  const lab = new Int32Array(W * H), boxes = [];
  for (let s = 0; s < W * H; s++) {
    if (!on[s] || lab[s]) continue;
    const stack = [s]; lab[s] = boxes.length + 1;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p - x) / W;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, q = yy * W + xx;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && on[q] && !lab[q]) { lab[q] = lab[s]; stack.push(q); }
      }
    }
    boxes.push([x0, y0, x1, y1]);
  }
  const PAD = 6;
  const found = boxes
    .map(([x0, y0, x1, y1]) => { const x = Math.max(0, x0 - PAD), y = Math.max(0, y0 - PAD); return [x, y, Math.min(W, x1 + PAD + 1) - x, Math.min(H, y1 + PAD + 1) - y]; })
    .filter(([, , w, h]) => w >= 16 && h >= 16) // specks smaller than a padded 4 px dot are noise, not fireflies
    .sort((a, b) => b[3] - a[3] || b[2] - a[2]);
  // shelf-pack into one sheet, 2 px apart
  const SHEET = 512;
  let cx = 0, cy = 0, row = 0;
  const placed = found.map(([x, y, w, h]) => {
    if (cx + w > SHEET) { cx = 0; cy += row + 2; row = 0; }
    const at = [cx, cy, w, h, x, y];
    cx += w + 2; row = Math.max(row, h);
    return at;
  });
  const sh = cy + row;
  const sheet = Buffer.alloc(SHEET * sh * 3);
  for (const [sx, sy, w, h, x, y] of placed)
    for (let yy = 0; yy < h; yy++) g.copy(sheet, ((sy + yy) * SHEET + sx) * 3, ((y + yy) * W + x) * 3, ((y + yy) * W + x + w) * 3);
  await sharp(sheet, { raw: { width: SHEET, height: sh, channels: 3 } }).webp({ quality: 82, effort: 6 }).toFile(`${OUT}/fireflies-sheet.webp`);
  const list = placed.map(([sx, sy, w, h]) => [sx, sy, w, h]);
  mkdirSync("app/landing/hall", { recursive: true });
  writeFileSync("app/landing/hall/fireflies.json", JSON.stringify({ sheet: "/art/fireflies-sheet.webp", width: SHEET, height: sh, boxes: list }) + "\n");
  console.log(`fireflies: ${list.length} glows (${list.filter(([, , w, h]) => w >= 60 && h >= 60).length} bokeh), sheet ${SHEET}×${sh} ${kb(`${OUT}/fireflies-sheet.webp`)}`);
}
