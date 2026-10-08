/**
 * D2c: builds the served art from the originals in /art-source (which is not served).
 *   node scripts/build-art.mjs
 * Images: AVIF and WebP at responsive widths into public/art (sharp, which Next.js already installs).
 * Audio: re-encoded to about 96 kbps MP3 into public/audio (needs ffmpeg on the machine; skipped if missing).
 */
import { mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const SRC = "art-source";
const OUT = "public/art";
mkdirSync(OUT, { recursive: true });
mkdirSync("public/audio", { recursive: true });

const jobs = [
  // The glass sculpture, cropped to the sculpture (it sits right of the headline), with its dark ground kept.
  { name: "hero-sculpture", src: "hero-glass-sculpture.webp", crop: { left: 900, top: 40, width: 1060, height: 1060 }, widths: [480, 720, 960, 1060], avif: 52, webp: 74 },
  // The topographic lines: a full-bleed background layer. Served up to its native 2000 px (never upscaled).
  { name: "texture-topo", src: "texture-topographic.webp", widths: [800, 1280, 1600, 2000], avif: 45, webp: 68 },
  // The glass panels, pulled into our palette: desaturated, tinted toward Frozen, darkened.
  { name: "card-glass", src: "card-glass-panels.webp", widths: [640, 960, 1280, 1600, 2000], avif: 50, webp: 72,
    tone: (img) => img.modulate({ saturation: 0.25, brightness: 0.62 }).tint({ r: 160, g: 189, b: 219 }) },
];

for (const j of jobs) {
  for (const w of j.widths) {
    let img = sharp(`${SRC}/${j.src}`);
    if (j.crop) img = img.extract(j.crop);
    if (j.tone) img = j.tone(img);
    img = img.resize({ width: w });
    await img.clone().avif({ quality: j.avif, effort: 6 }).toFile(`${OUT}/${j.name}-${w}.avif`);
    await img.clone().webp({ quality: j.webp, effort: 6 }).toFile(`${OUT}/${j.name}-${w}.webp`);
    const a = statSync(`${OUT}/${j.name}-${w}.avif`).size, b = statSync(`${OUT}/${j.name}-${w}.webp`).size;
    console.log(`${j.name}-${w}: avif ${(a / 1024).toFixed(0)} KB, webp ${(b / 1024).toFixed(0)} KB`);
  }
}

// The soundtracks (app/ui/sound/tracks.ts lists them): each re-encoded to 96 kbps stereo MP3, metadata stripped.
const TRACKS = [["ambient-loop.mp3", "ambient-loop.mp3"], ["focus.mp3", "focus.mp3"], ["deep-study.mp3", "deep-study.mp3"], ["night.mp3", "night.mp3"]];
try {
  for (const [from, to] of TRACKS) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${SRC}/${from}`, "-codec:a", "libmp3lame", "-b:a", "96k", "-ac", "2", "-ar", "44100", "-map_metadata", "-1", `public/audio/${to}`]);
    console.log(`${to}: ${(statSync(`public/audio/${to}`).size / 1024).toFixed(0)} KB`);
  }
} catch {
  console.log("ffmpeg not found: audio not rebuilt");
}
