/**
 * D5 · Environments: builds the four wallpapers from the Owner-provided originals in /art-source (not served).
 *   node scripts/d5-env-assets.mjs
 * Two WebP sizes each into public/env: 1920 px wide (quality about 78) and 1080 px wide (about 72). Windows under
 * 900 px get the 1080 file, so nothing is upscaled. If a file is over its budget (300 KB / 160 KB), quality steps
 * down a little until it fits or reaches a floor.
 */
import { mkdirSync, statSync } from "node:fs";
import sharp from "sharp";

const SCENES = { reef: "env-reef.webp", lake: "env-lake.webp", mist: "env-mist.webp", sun: "env-sun.webp" };
const SIZES = [{ w: 1920, q: 78, max: 300 * 1024, floor: 66 }, { w: 1080, q: 72, max: 160 * 1024, floor: 60 }];
mkdirSync("public/env", { recursive: true });
for (const [name, src] of Object.entries(SCENES)) {
  for (const s of SIZES) {
    const out = `public/env/${name}-${s.w}.webp`;
    let q = s.q;
    for (;;) {
      await sharp(`art-source/${src}`).resize({ width: s.w, withoutEnlargement: true }).webp({ quality: q, effort: 6 }).toFile(out);
      if (statSync(out).size <= s.max || q <= s.floor) break;
      q -= 3;
    }
    const m = await sharp(out).metadata();
    console.log(`${out}: ${m.width}×${m.height}, q${q}, ${(statSync(out).size / 1024).toFixed(0)} KB`);
  }
}
